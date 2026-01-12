
import { Market, TradeEventRow } from '../types/tables';
import { MarketObservation } from '../types/marketEdge';
import { Logger } from '../utils/logger';
import { riskGovernor } from '../risk/riskGovernor';
import { polymarket } from './polymarket';
import { ENV } from '../config/env';
import { feeModel } from './feeModel';
import { TradeLogger } from './tradeLogger';
import { pnlLedger } from './pnlLedger';

export type ExecutionMode = 'AGGRESSIVE' | 'PASSIVE';

export interface ScalingMetadata {
    tierLevel: number;
    clipIndex: number;
    scalingFactor: number;
    tradeSizeOverride: number;
    mode?: ExecutionMode; // Execution Mode request
    lockedDirection?: 'UP' | 'DOWN' | null; // SAFETY: Authoritative Lock from MarketLoop
}

export class ExecutionService {
  
  private static readonly MAX_ENTRY_PRICE_DEFAULT = 0.95;

  /**
   * Executes a Defensive Exit (Panic Close) for the entire position.
   * This is an AGGRESSIVE Taker order to exit immediately.
   */
  public async defensiveExit(
      market: Market, 
      lockedDirection: 'UP' | 'DOWN', 
      reasonDetails: any
    ): Promise<{ executed: boolean }> {
      
      const contextId = `EXIT-${Date.now()}`;
      const mode = ENV.DRY_RUN ? 'DRY_RUN' : 'LIVE';
      const runId = market.active_run_id;

      if (!runId) return { executed: false };

      // 1. Determine Position Size (Shares)
      // Since we don't have a live portfolio sync, we sum up open trades from PnL Ledger.
      const position = await pnlLedger.getNetPosition(runId, market.id);
      
      // INVARIANT 2: NO ZERO EXPOSURE EXIT
      // If we attempt to exit with zero/negative shares, we are logic-drifting.
      // This invariant ensures we never "guess" or flip into a short/long accidentally.
      if (position.shares <= 0) {
          throw new Error(`[INVARIANT_VIOLATION] Defensive exit attempted with zero/negative exposure: ${position.shares}`);
      }

      Logger.info(`[${contextId}] DEFENSIVE EXIT ${lockedDirection} (${reasonDetails.reason}): Closing ${position.shares.toFixed(2)} shares.`);

      // 2. Resolve Tokens
      const tokens = await polymarket.getTokens(market.polymarket_market_id);
      if (!tokens) {
          Logger.error(`[${contextId}] Tokens not found for exit.`);
          return { executed: false };
      }

      const sideToSell = lockedDirection === 'UP' ? 'UP' : 'DOWN';
      const tokenId = sideToSell === 'UP' ? tokens.up : tokens.down;

      // 3. Execution (Market Sell / Limit at Bid)
      try {
          if (ENV.DRY_RUN) {
              await new Promise(r => setTimeout(r, 200));
              
              // Close the ledger positions
              await pnlLedger.closePosition(runId, market.id, 'DEFENSIVE_EXIT', reasonDetails);
              
              TradeLogger.log({
                  test_run_id: runId,
                  market_id: market.id,
                  polymarket_market_id: market.polymarket_market_id,
                  asset: market.asset,
                  side: lockedDirection,
                  stake_usd: 0, // Exit doesn't stake new money
                  entry_prob: 0,
                  confidence: reasonDetails.confidence,
                  status: 'EXECUTED',
                  decision_reason: `EXIT:${reasonDetails.reason}`,
                  outcome: 'CLOSED',
                  context: { 
                      mode: 'DRY_RUN', 
                      exitType: 'DEFENSIVE', 
                      sharesClosed: position.shares,
                      reasonDetails
                  }
              });

              return { executed: true };
          } 

          // LIVE EXECUTION
          // We need to SELL the position. 
          // Polymarket CLOB: Sell is a separate side? Or negative size?
          // Using clob-client: createOrder({ side: Side.SELL })
          
          // Get Market Bid Price for limit (aggressive marketable limit)
          const depth = await polymarket.getMarketDepth(tokenId);
          const sellPrice = depth?.bestBid || 0.01; // Sell into bid

          if (sellPrice <= 0.01) {
              Logger.warn(`[${contextId}] Bid price too low (${sellPrice}). Cannot exit safely.`);
              return { executed: false };
          }

          const orderId = await polymarket.placeOrder(tokenId, 'SELL', sellPrice, position.shares);

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
                  mode: 'LIVE', 
                  orderId,
                  exitType: 'DEFENSIVE', 
                  sharesClosed: position.shares,
                  reasonDetails 
              }
          });

          return { executed: true };

      } catch (err: any) {
          Logger.error(`[${contextId}] Exit Failed`, err);
          return { executed: false };
      }
  }

  public async attemptTrade(
      market: Market, 
      obs: MarketObservation, 
      currentExposure: number,
      scalingMeta?: ScalingMetadata
    ): Promise<{ executed: boolean, simulated?: boolean, newExposure: number }> {
    
    const contextId = `EXEC-${Date.now()}`;
    const mode = ENV.DRY_RUN ? 'DRY_RUN' : 'LIVE';
    
    const run = market._run;
    const expParams = run?.params || {};
    const executionMode: ExecutionMode = scalingMeta?.mode || 'AGGRESSIVE';

    // ------------------------------------------------------------------
    // 0. CRITICAL INVARIANT: PASSIVE DIRECTION SAFETY
    // ------------------------------------------------------------------
    if (executionMode === 'PASSIVE') {
        const lockedDir = scalingMeta?.lockedDirection;
        if (lockedDir && lockedDir !== obs.direction) {
             const errorMsg = `[INVARIANT_VIOLATION] PASSIVE order attempted on ${obs.direction} while lockedDirection=${lockedDir}`;
             Logger.error(errorMsg);
             throw new Error(errorMsg); // HARD STOP
        }
        if (lockedDir) {
             Logger.info(`[PASSIVE_GUARD_OK] market=${market.polymarket_market_id} locked=${lockedDir} order=${obs.direction}`);
        }
    }
    // ------------------------------------------------------------------

    // SIZE LOGIC
    let betSizeUSDC: number;
    if (scalingMeta) {
        betSizeUSDC = scalingMeta.tradeSizeOverride;
    } else if (expParams.tradeSize && expParams.tradeSize > 0) {
        betSizeUSDC = expParams.tradeSize;
    } else {
        betSizeUSDC = riskGovernor.calculateBetSize();
    }

    const maxExposure = expParams.maxExposure || market.max_exposure || 50;
    const confidenceThreshold = expParams.confidenceThreshold || 0.60;
    const entryLimitPrice = market.max_entry_price || ExecutionService.MAX_ENTRY_PRICE_DEFAULT;
    
    // PRICE LOGIC (Maker vs Taker)
    let executionPrice = entryLimitPrice;
    let isMaker = false;
    let spreadAtPlacement = 0;

    if (executionMode === 'PASSIVE' && obs.orderBook) {
        // Passive: Aim to join or improve best bid, but stay below best ask
        const { bestBid, bestAsk } = obs.orderBook;
        spreadAtPlacement = bestAsk - bestBid;

        const makerPrice = this.calculateMakerPrice(bestBid, bestAsk);
        
        if (makerPrice < bestAsk) {
            executionPrice = makerPrice;
            isMaker = true;
        } else {
            Logger.info(`[EXEC] Passive mode requested but spread too tight (Bid:${bestBid} Ask:${bestAsk}). Skipping.`);
            return { executed: false, newExposure: currentExposure };
        }
    } else {
        // AGGRESSIVE: Marketable Limit Order (Best Ask or Limit)
        if (obs.orderBook && obs.orderBook.bestAsk > entryLimitPrice) {
            Logger.info(`[EXEC] Price too high. BestAsk: ${obs.orderBook.bestAsk} > Limit: ${entryLimitPrice}`);
            return { executed: false, newExposure: currentExposure };
        }
    }
    
    const metrics = feeModel.calculateMetrics(executionPrice, obs.confidence, betSizeUSDC);
    
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
        buy_fee_pct: metrics.buyFeePct,
        sell_fee_pct: metrics.sellFeePct
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
           return { executed: false, newExposure: currentExposure };
       }
    }

    // 2. EXPOSURE CHECK
    if (!ENV.DRY_RUN && (currentExposure + betSizeUSDC > maxExposure)) {
      TradeLogger.log({ ...eventPayload, status: 'SKIPPED', decision_reason: 'MAX_EXPOSURE_HIT' });
      return { executed: false, newExposure: currentExposure };
    }

    // 3. RISK APPROVAL
    const approved = await riskGovernor.requestApproval(market, betSizeUSDC, currentExposure);
    if (!approved) {
      TradeLogger.log({ ...eventPayload, status: 'SKIPPED', decision_reason: 'RISK_VETO' });
      return { executed: false, newExposure: currentExposure };
    }

    // 4. RESOLVE TOKENS
    const tokens = await polymarket.getTokens(market.polymarket_market_id);
    if (!tokens) {
      TradeLogger.log({ ...eventPayload, status: 'SKIPPED', decision_reason: 'TOKEN_RESOLVE_FAIL', error: 'Tokens not found' });
      return { executed: false, newExposure: currentExposure };
    }
    const sideToBuy = obs.direction === 'UP' ? 'UP' : 'DOWN';
    const tokenId = sideToBuy === 'UP' ? tokens.up : tokens.down;
    const shares = Number((betSizeUSDC / executionPrice).toFixed(2));

    Logger.info(`[${contextId}] EXEC ${sideToBuy} (${executionMode}): ${betSizeUSDC} USDC @ ${executionPrice.toFixed(3)} (Tier ${scalingMeta?.tierLevel || 0})`);

    try {
      if (ENV.DRY_RUN) {
          // DRY RUN SIMULATION
          if (executionMode === 'PASSIVE') {
               const fillRoll = Math.random();
               const fillThreshold = 0.40; // 40% chance
               
               if (fillRoll > fillThreshold) {
                   Logger.info(`[DRY_RUN] Passive Order NOT Filled (Roll: ${fillRoll.toFixed(2)} > ${fillThreshold})`);
                   return { executed: false, newExposure: currentExposure };
               } else {
                   Logger.info(`[DRY_RUN] Passive Order FILLED (Simulated)`);
               }
          }

          await new Promise(r => setTimeout(r, 200)); 
          
          TradeLogger.log({ 
            ...eventPayload, 
            status: 'EXECUTED', 
            decision_reason: 'DRY_RUN_EXEC',
            context: { orderId: 'DRY-RUN-ID', shares, filledPrice: executionPrice, mode, dry_run: true, scaling: scalingMeta, executionMode, isMaker }
          });
          
          const ledgerSide = sideToBuy === 'UP' ? 'YES' : 'NO';
          if (market.active_run_id) {
              await pnlLedger.recordOpenTrade({
                  run_id: market.active_run_id,
                  market_id: market.id,
                  polymarket_market_id: market.polymarket_market_id,
                  mode: 'DRY_RUN',
                  side: ledgerSide,
                  size_usd: betSizeUSDC,
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
                      spreadAtPlacement
                  }
              });
          }

          return { executed: false, simulated: true, newExposure: currentExposure };
      }

      // LIVE EXECUTION
      const orderId = await polymarket.placeOrder(tokenId, 'BUY', executionPrice, shares);
      
      TradeLogger.log({ 
        ...eventPayload, 
        status: 'EXECUTED', 
        decision_reason: 'EXECUTED',
        context: { orderId, shares, filledPrice: executionPrice, mode, dry_run: false, scaling: scalingMeta, executionMode, isMaker }
      });
      
      Logger.info(`[EXPOSURE] CONSUME run=${market.active_run_id} market=${market.polymarket_market_id} +${betSizeUSDC}`);

      return { executed: true, newExposure: currentExposure + betSizeUSDC };

    } catch (err: any) {
      Logger.error(`[${contextId}] EXEC FAIL`, err);
      TradeLogger.log({ ...eventPayload, status: 'SKIPPED', decision_reason: 'EXECUTION_ERROR', error: err.message });
      return { executed: false, newExposure: currentExposure };
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
