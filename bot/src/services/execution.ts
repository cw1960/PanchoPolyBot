
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
}

export class ExecutionService {
  
  private static readonly MAX_ENTRY_PRICE_DEFAULT = 0.95;

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
        
        // Fallback constraint: If maker price calculation fails or book is crossed, default to aggressive cap or abort?
        // Logic: if makerPrice >= bestAsk, we are crossing spread (Taking).
        // Since we wanted PASSIVE, we should ideally back off, but for now we clamp to (BestAsk - tick) if possible.
        if (makerPrice < bestAsk) {
            executionPrice = makerPrice;
            isMaker = true;
        } else {
            // Safety: If spread is closed, we cannot be passive.
            // Since mode was requested as PASSIVE, we should technically SKIP.
            // However, to ensure execution flow in simple bot, we might clip it.
            // Strict Maker Rule:
            Logger.info(`[EXEC] Passive mode requested but spread too tight (Bid:${bestBid} Ask:${bestAsk}). Skipping.`);
            return { executed: false, newExposure: currentExposure };
        }
    } else {
        // AGGRESSIVE: Marketable Limit Order (Best Ask or Limit)
        // We stick to entryLimitPrice (Max willingness to pay), enabling Taker fill if BestAsk < entryLimitPrice
        if (obs.orderBook && obs.orderBook.bestAsk > entryLimitPrice) {
            // Price is too high even for Taker
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
          // If Passive/Maker, we must simulate fill probability.
          if (executionMode === 'PASSIVE') {
               // Probabilistic Fill Simulation
               // Factors: Spread tightness, volatility (regime), and random luck.
               // Simple Heuristic: 40% chance of fill per tick if improving bid.
               const fillRoll = Math.random();
               const fillThreshold = 0.40; // 40% chance
               
               if (fillRoll > fillThreshold) {
                   Logger.info(`[DRY_RUN] Passive Order NOT Filled (Roll: ${fillRoll.toFixed(2)} > ${fillThreshold})`);
                   // Return FALSE execution so MarketLoop knows it failed
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

      // We bump exposure immediately even for Maker orders because funds are locked
      return { executed: true, newExposure: currentExposure + betSizeUSDC };

    } catch (err: any) {
      Logger.error(`[${contextId}] EXEC FAIL`, err);
      TradeLogger.log({ ...eventPayload, status: 'SKIPPED', decision_reason: 'EXECUTION_ERROR', error: err.message });
      return { executed: false, newExposure: currentExposure };
    }
  }

  /**
   * Calculates a Passive Price (Maker).
   * Strategy: Improve Best Bid by 1 tick (0.001), but do not cross Spread.
   */
  private calculateMakerPrice(bestBid: number, bestAsk: number): number {
      const TICK_SIZE = 0.001; // Conservative tick
      const target = bestBid + TICK_SIZE;
      
      // Ensure we don't match/cross the ask (which would be Taker)
      if (target >= bestAsk) {
          return bestBid; // Just join the bid if spread is 1 tick
      }
      return target;
  }
}

export const executionService = new ExecutionService();
