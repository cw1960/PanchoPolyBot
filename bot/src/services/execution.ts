
import { Market, TradeEventRow } from '../types/tables';
import { MarketObservation } from '../types/marketEdge';
import { Logger } from '../utils/logger';
import { riskGovernor } from '../risk/riskGovernor';
import { polymarket } from './polymarket';
import { ENV } from '../config/env';
import { feeModel } from './feeModel';
import { TradeLogger } from './tradeLogger';
import { pnlLedger } from './pnlLedger';
import { accountManager } from './accountManager'; 
import { EXECUTION_MODE } from '../config/executionMode';
import { LiveExecutionAdapter } from '../execution/liveAdapter';
import { PaperExecutionAdapter } from '../execution/paperAdapter';
import { ExecutionAdapter } from '../execution/adapter';

export type ExecutionMode = 'AGGRESSIVE' | 'PASSIVE';

export interface ScalingMetadata {
    tierLevel: number;
    clipIndex: number;
    scalingFactor: number;
    tradeSizeOverride: number;
    mode?: ExecutionMode; // Execution Mode request
    lockedDirection?: 'UP' | 'DOWN' | null; // SAFETY: Authoritative Lock from MarketLoop
}

// --- MAKER CONFIG ---
const ENABLE_MAKER_FIRST = true;
const MAKER_TIMEOUT_MS = 1500;
// --------------------

export class ExecutionService {
  
  private static readonly MAX_ENTRY_PRICE_DEFAULT = 0.95;
  private static readonly MIN_ORDER_SIZE_USD = 1.00; 

  /**
   * Executes a Defensive Exit (Panic Close) for the entire position.
   */
  public async defensiveExit(
      market: Market, 
      lockedDirection: 'UP' | 'DOWN', 
      reasonDetails: any
    ): Promise<{ executed: boolean }> {
      
      const contextId = `EXIT-${Date.now()}`;
      const mode = EXECUTION_MODE; // Use configured mode
      const logPrefix = `[${mode}] `;
      const runId = market.active_run_id;

      if (!runId) return { executed: false };

      // 1. Determine Position Size
      const position = await pnlLedger.getNetPosition(runId, market.id);
      
      if (position.shares <= 0) {
          throw new Error(`[INVARIANT_VIOLATION] Defensive exit attempted with zero/negative exposure: ${position.shares}`);
      }

      Logger.info(`${logPrefix}[${contextId}] DEFENSIVE EXIT ${lockedDirection} (${reasonDetails.reason}): Closing ${position.shares.toFixed(2)} shares.`);

      // 2. Resolve Tokens
      const tokens = await polymarket.getTokens(market.polymarket_market_id);
      if (!tokens) {
          Logger.error(`${logPrefix}[${contextId}] Tokens not found for exit.`);
          return { executed: false };
      }

      const sideToSell = lockedDirection === 'UP' ? 'UP' : 'DOWN';
      const tokenId = sideToSell === 'UP' ? tokens.up : tokens.down;

      // 3. Execution
      try {
          // SELECT ADAPTER
          const adapter: ExecutionAdapter = mode === 'LIVE' 
              ? new LiveExecutionAdapter() 
              : new PaperExecutionAdapter({
                  asset: market.asset,
                  marketId: market.id,
                  polymarketId: market.polymarket_market_id,
                  side: lockedDirection, // EXIT direction usually opposite of entry, but here we sell holding
                  runId: runId,
                  confidence: reasonDetails.confidence,
                  reason: `EXIT:${reasonDetails.reason}`,
                  oracle: { price: 0, timestamp: Date.now(), age: 0, source: 'EXIT_TRIGGER' }
              });

          // DRY_RUN legacy check (if someone forces dry run env var with Live mode - strict guard)
          if (ENV.DRY_RUN && mode === 'LIVE') {
             throw new Error("Invalid Configuration: DRY_RUN=true with EXECUTION_MODE=LIVE");
          }

          if (ENV.DRY_RUN) {
              // Legacy Dry Run Simulation (Mock services)
              // ... keep existing dry run block if needed, but PAPER mode supersedes it for production testing.
              // For strict compliance with prompt, PAPER is NOT DRY_RUN.
          }

          const depth = await polymarket.getMarketDepth(tokenId);
          const sellPrice = depth?.bestBid || 0.01; 

          if (sellPrice <= 0.01) {
              Logger.warn(`[${contextId}] Bid price too low (${sellPrice}). Cannot exit safely.`);
              return { executed: false };
          }

          const orderId = await adapter.placeOrder(tokenId, 'SELL', sellPrice, position.shares);

          TradeLogger.log({
              test_run_id: runId,
              market_id: market.id,
              polymarket_market_id: market.polymarket_market_id,
              asset: market.asset,
              side: lockedDirection,
              stake_usd: 0,
              entry_prob: sellPrice,
              confidence: reasonDetails.confidence,
              status: 'EXECUTED',
              decision_reason: `EXIT:${reasonDetails.reason}`,
              outcome: 'CLOSED',
              context: { 
                  mode: mode, 
                  orderId,
                  exitType: 'DEFENSIVE', 
                  sharesClosed: position.shares,
                  reasonDetails 
              }
          });

          // In PAPER mode, we also update ledger to reflect the exit
          if (mode === 'PAPER') {
               await pnlLedger.closePosition(runId, market.id, 'DEFENSIVE_EXIT', reasonDetails);
          } else if (mode === 'LIVE') {
               await pnlLedger.closePosition(runId, market.id, 'DEFENSIVE_EXIT', reasonDetails);
          }

          return { executed: true };

      } catch (err: any) {
          Logger.error(`[${contextId}] Exit Failed`, err);
          return { executed: false };
      }
  }

  public async attemptTrade(
      market: Market, 
      obs: MarketObservation, 
      scalingMeta?: ScalingMetadata
    ): Promise<{ executed: boolean, simulated?: boolean, newExposure: number }> {
    
    const contextId = `EXEC-${Date.now()}`;
    const mode = EXECUTION_MODE;
    const logPrefix = `[${mode}] `;
    
    // ---------------------------------------------------------
    // INVARIANT 1: IMMUTABLE DIRECTION/ACCOUNT CHECK
    // ---------------------------------------------------------
    let direction: 'UP' | 'DOWN' | 'NEUTRAL' = obs.direction;
    
    if (scalingMeta?.lockedDirection) {
        direction = scalingMeta.lockedDirection;
    }
    
    if (direction === 'NEUTRAL') return { executed: false, newExposure: 0 };

    // RESOLVE ACCOUNT
    const account = accountManager.getAccount(market.asset, direction);
    Logger.info(`${logPrefix}[ACCOUNT_RESOLVED] ${account.marketKey} for Market ${market.polymarket_market_id}`);

    // HARD ASSERT: If locked, account must match lock
    if (scalingMeta?.lockedDirection) {
        if (account.direction !== scalingMeta.lockedDirection) {
            throw new Error(`[INVARIANT_VIOLATION] Account Resolved (${account.direction}) != Locked Direction (${scalingMeta.lockedDirection})`);
        }
    }
    // ---------------------------------------------------------

    const run = market._run;
    const expParams = run?.params || {};
    const executionMode: ExecutionMode = scalingMeta?.mode || 'AGGRESSIVE';

    // PASSIVE DIRECTION SAFETY
    if (executionMode === 'PASSIVE') {
        const lockedDir = scalingMeta?.lockedDirection;
        if (lockedDir && lockedDir !== obs.direction) {
             const errorMsg = `[INVARIANT_VIOLATION] PASSIVE order attempted on ${obs.direction} while lockedDirection=${lockedDir}`;
             Logger.error(errorMsg);
             throw new Error(errorMsg); 
        }
    }

    // SIZE LOGIC (BASE)
    let rawBetSize: number;
    if (scalingMeta && scalingMeta.tradeSizeOverride > 0) {
        rawBetSize = scalingMeta.tradeSizeOverride;
    } else if (expParams.tradeSize && expParams.tradeSize > 0) {
        rawBetSize = expParams.tradeSize;
    } else {
        rawBetSize = riskGovernor.calculateBetSize(account);
    }

    // SIZE LOGIC (DECAYED)
    const confidenceMultiplier = Math.max(0.5, obs.confidence); 
    const preDecaySize = rawBetSize * confidenceMultiplier;
    const betSizeUSDC = riskGovernor.applySizeDecay(preDecaySize, market.t_expiry);

    // MINIMUM SIZE CHECK
    if (betSizeUSDC < ExecutionService.MIN_ORDER_SIZE_USD) {
         Logger.info(`${logPrefix}[EXEC] Trade Size too small after decay. ${betSizeUSDC.toFixed(3)} < ${ExecutionService.MIN_ORDER_SIZE_USD}`);
         return { executed: false, newExposure: account.currentExposure };
    }

    const confidenceThreshold = expParams.confidenceThreshold || 0.60;
    const entryLimitPrice = market.max_entry_price || ExecutionService.MAX_ENTRY_PRICE_DEFAULT;
    
    // PRICE LOGIC (Maker vs Taker)
    let executionPrice = entryLimitPrice;
    let isMaker = false;
    let spreadAtPlacement = 0;

    if (executionMode === 'PASSIVE' && obs.orderBook) {
        const { bestBid, bestAsk } = obs.orderBook;
        spreadAtPlacement = bestAsk - bestBid;

        const makerPrice = this.calculateMakerPrice(bestBid, bestAsk);
        
        if (makerPrice < bestAsk) {
            executionPrice = makerPrice;
            isMaker = true;
        } else {
            return { executed: false, newExposure: account.currentExposure };
        }
    } else {
        if (obs.orderBook && obs.orderBook.bestAsk > entryLimitPrice) {
            return { executed: false, newExposure: account.currentExposure };
        }
    }
    
    const metrics = feeModel.calculateMetrics(executionPrice, obs.confidence, betSizeUSDC, isMaker);
    
    const signalSnapshot = {
        baseline_price: market.baseline_price,
        time_remaining_ms: obs.timeToExpiryMs,
        spot_price: obs.spot.price,
        delta: obs.delta,
        model_prob: obs.calculatedProbability,
        direction: obs.direction,
        regime: obs.regime,
        tier: scalingMeta?.tierLevel,
        clip: scalingMeta?.clipIndex,
        book_bid: obs.orderBook?.bestBid,
        book_ask: obs.orderBook?.bestAsk
    };

    const eventPayload: TradeEventRow = {
      test_run_id: market.active_run_id || undefined, 
      market_id: market.id,
      polymarket_market_id: market.polymarket_market_id,
      asset: market.asset,
      side: obs.direction,
      stake_usd: betSizeUSDC,
      entry_prob: executionPrice,
      confidence: obs.confidence,
      edge_after_fees_pct: metrics.edgePct,
      ev_after_fees_usd: metrics.evUsd,
      fees: {
        buy_fee_pct: metrics.feePct,
        sell_fee_pct: metrics.feePct
      },
      signals: signalSnapshot, 
      status: 'INTENDED',
      decision_reason: 'ANALYZING',
      outcome: 'OPEN',
      context: { mode, dry_run: ENV.DRY_RUN, scaling: scalingMeta, executionMode, isMaker }
    };

    // 1. CONFIDENCE CHECK
    if (obs.confidence < confidenceThreshold) {
       if (!scalingMeta) {
           TradeLogger.log({ ...eventPayload, status: 'SKIPPED', decision_reason: 'CONFIDENCE_TOO_LOW' });
           return { executed: false, newExposure: account.currentExposure };
       }
    }

    // 2. EXPOSURE CHECK
    
    // 3. RISK APPROVAL
    const approved = await riskGovernor.requestApproval(market, account, betSizeUSDC);
    if (!approved) {
      TradeLogger.log({ ...eventPayload, status: 'SKIPPED', decision_reason: 'RISK_VETO' });
      return { executed: false, newExposure: account.currentExposure };
    }

    // 4. RESOLVE TOKENS
    const tokens = await polymarket.getTokens(market.polymarket_market_id);
    if (!tokens) {
      TradeLogger.log({ ...eventPayload, status: 'SKIPPED', decision_reason: 'TOKEN_RESOLVE_FAIL', error: 'Tokens not found' });
      return { executed: false, newExposure: account.currentExposure };
    }
    const sideToBuy = direction === 'UP' ? 'UP' : 'DOWN';
    const tokenId = sideToBuy === 'UP' ? tokens.up : tokens.down;
    
    const sharesTotal = Number((betSizeUSDC / executionPrice).toFixed(2));
    let sharesRemaining = sharesTotal;
    
    Logger.info(`${logPrefix}[${contextId}] EXEC_REQ ${sideToBuy} (${executionMode}): $${betSizeUSDC.toFixed(2)} (${sharesTotal} shares)`);

    // SELECT ADAPTER
    const adapter: ExecutionAdapter = mode === 'LIVE' 
        ? new LiveExecutionAdapter() 
        : new PaperExecutionAdapter({
            asset: market.asset,
            marketId: market.id,
            polymarketId: market.polymarket_market_id,
            side: direction,
            runId: run?.id,
            confidence: obs.confidence,
            reason: `ENTER:${executionMode}`,
            oracle: { 
                price: obs.chainlink.price, 
                timestamp: obs.chainlink.timestamp, 
                age: (Date.now() - obs.chainlink.timestamp)/1000, 
                source: obs.chainlink.source 
            }
        });

    // =========================================================
    // MAKER-FIRST EXECUTION BLOCK
    // =========================================================
    let makerFilled = false;

    if (ENABLE_MAKER_FIRST && !ENV.DRY_RUN) {
        try {
            // A. Get Maker Price (Best Bid)
            const depth = await polymarket.getMarketDepth(tokenId);
            
            if (depth && depth.bestBid > 0) {
                const makerPrice = depth.bestBid;
                
                Logger.info(`[MAKER_ATTEMPT] market=${market.polymarket_market_id} side=${sideToBuy} size=${sharesTotal} price=${makerPrice}`);
                
                // B. Place Limit Order VIA ADAPTER
                const makerOrderId = await adapter.placeOrder(tokenId, 'BUY', makerPrice, sharesTotal);
                
                // C. Wait Timeout
                await new Promise(r => setTimeout(r, MAKER_TIMEOUT_MS));

                // D. Cancel & Check
                await adapter.cancelOrder(makerOrderId);
                const order = await adapter.getOrder(makerOrderId);
                
                if (order) {
                    const matchedSize = parseFloat(order.sizeMatched || '0');
                    if (matchedSize > 0) {
                        makerFilled = true;
                        
                        const makerUsdSpent = matchedSize * makerPrice;
                        sharesRemaining = sharesTotal - matchedSize;
                        
                        Logger.info(`[MAKER_FILLED] filled=${matchedSize} shares @ ${makerPrice}`);
                        
                        TradeLogger.log({ 
                            ...eventPayload, 
                            status: 'EXECUTED', 
                            decision_reason: 'MAKER_FILL',
                            entry_prob: makerPrice,
                            stake_usd: makerUsdSpent,
                            context: { ...eventPayload.context, type: 'MAKER', orderId: makerOrderId, shares: matchedSize }
                        });
                        
                        if (market.active_run_id) {
                            await pnlLedger.recordOpenTrade({
                                run_id: market.active_run_id,
                                market_id: market.id,
                                polymarket_market_id: market.polymarket_market_id,
                                mode: mode === 'PAPER' ? 'PAPER' : 'LIVE',
                                side: sideToBuy === 'UP' ? 'YES' : 'NO',
                                size_usd: makerUsdSpent,
                                entry_price: makerPrice,
                                status: 'OPEN',
                                realized_pnl: 0,
                                unrealized_pnl: 0,
                                opened_at: new Date().toISOString(),
                                metadata: { ...eventPayload.context, maker: true }
                            });
                            accountManager.updateExposure(market.asset, direction, makerUsdSpent);
                        }
                        
                        if (sharesRemaining <= 0) {
                            return { executed: true, newExposure: account.currentExposure };
                        }
                    }
                }
            }
        } catch (err) {
            Logger.warn(`[MAKER_ERROR] Fallback to Taker immediately`, err);
        }
    }

    // =========================================================
    // TAKER EXECUTION (FALLBACK / REMAINDER)
    // =========================================================
    
    if (makerFilled && sharesRemaining > 0) {
        const takerUsdNeeded = sharesRemaining * executionPrice;
        const reApproved = await riskGovernor.requestApproval(market, account, takerUsdNeeded);
        if (!reApproved) {
             Logger.warn(`[RISK_VETO_FALLBACK] Stopped Taker fill after partial Maker fill.`);
             return { executed: true, newExposure: account.currentExposure };
        }
    }

    try {
      if (ENV.DRY_RUN && mode === 'LIVE') {
          throw new Error("Misconfiguration: Legacy DRY_RUN path hit in ExecutionService");
      }

      // EXECUTE VIA ADAPTER
      const takerOrderId = await adapter.placeOrder(tokenId, 'BUY', executionPrice, sharesRemaining);
      const takerUsd = sharesRemaining * executionPrice;

      TradeLogger.log({ 
        ...eventPayload, 
        status: 'EXECUTED', 
        decision_reason: 'EXECUTED',
        stake_usd: takerUsd,
        context: { orderId: takerOrderId, shares: sharesRemaining, filledPrice: executionPrice, mode, dry_run: false, scaling: scalingMeta, executionMode, isMaker }
      });
      
      Logger.info(`[TAKER_EXECUTED] ${sharesRemaining} shares @ ${executionPrice}`);
      
      // CRITICAL: UPDATE ISOLATED ACCOUNT EXPOSURE (Paper Mode Included)
      if (market.active_run_id) {
           await pnlLedger.recordOpenTrade({
              run_id: market.active_run_id,
              market_id: market.id,
              polymarket_market_id: market.polymarket_market_id,
              mode: mode === 'PAPER' ? 'PAPER' : 'LIVE',
              side: sideToBuy === 'UP' ? 'YES' : 'NO',
              size_usd: takerUsd,
              entry_price: executionPrice,
              status: 'OPEN',
              realized_pnl: 0,
              unrealized_pnl: 0,
              opened_at: new Date().toISOString(),
              metadata: {
                  confidence: obs.confidence,
                  regime: obs.regime,
                  tier: scalingMeta?.tierLevel,
                  clip: scalingMeta?.clipIndex,
                  executionMode,
                  isMaker,
                  spreadAtPlacement,
                  isolatedAccount: account.marketKey
              }
          });
      }

      accountManager.updateExposure(market.asset, direction, takerUsd);

      return { executed: true, newExposure: account.currentExposure };

    } catch (err: any) {
      Logger.error(`[${contextId}] EXEC FAIL`, err);
      TradeLogger.log({ ...eventPayload, status: 'SKIPPED', decision_reason: 'EXECUTION_ERROR', error: err.message });
      return { executed: false, newExposure: account.currentExposure };
    }
  }

  private calculateMakerPrice(bestBid: number, bestAsk: number): number {
      const TICK_SIZE = 0.001; 
      const target = bestBid + TICK_SIZE;
      if (target >= bestAsk) return bestBid;
      return target;
  }
}

export const executionService = new ExecutionService();
