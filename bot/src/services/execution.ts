import { Market } from '../types/tables';
import { MarketObservation } from '../types/marketEdge';
import { Logger } from '../utils/logger';
import { riskGovernor } from '../risk/riskGovernor';
import { polymarket } from './polymarket';
import { ENV } from '../config/env';
import { feeModel } from './feeModel';
import { supabase } from './supabase';

export class ExecutionService {
  
  private static readonly MAX_ENTRY_PRICE_DEFAULT = 0.95;

  public async attemptTrade(market: Market, obs: MarketObservation, currentExposure: number): Promise<{ executed: boolean, simulated?: boolean, newExposure: number }> {
    const contextId = `EXEC-${Date.now()}`;
    const mode = ENV.DRY_RUN ? 'DRY_RUN' : 'LIVE';
    
    const run = market._run;
    const expParams = run?.params || {};
    
    const betSizeUSDC = expParams.tradeSize || riskGovernor.calculateBetSize(); 
    const maxExposure = expParams.maxExposure || market.max_exposure || 50;
    const directionMode = expParams.direction || 'BOTH';
    const confidenceThreshold = expParams.confidenceThreshold || 0.60;
    
    // Price at which we are willing to enter (limit price)
    const entryLimitPrice = market.max_entry_price || ExecutionService.MAX_ENTRY_PRICE_DEFAULT;
    
    // Calculate expected metrics
    const metrics = feeModel.calculateMetrics(entryLimitPrice, obs.confidence, betSizeUSDC);
    
    // COMPREHENSIVE SIGNAL LOGGING
    const signalSnapshot = {
        baseline_price: market.baseline_price,
        t_open: market.t_open,
        t_expiry: market.t_expiry,
        time_remaining_ms: obs.timeToExpiryMs,
        spot_price: obs.spot.price,
        delta: obs.delta,
        implied_probability: obs.impliedProbability,
        model_probability: obs.calculatedProbability,
        z_score: obs.calculatedProbability ? (obs.calculatedProbability - 0.5) * 2 : 0, 
        direction: obs.direction
    };

    const eventPayload = {
      test_run_id: market.active_run_id || null, 
      market_id: market.id,
      polymarket_market_id: market.polymarket_market_id,
      asset: market.asset,
      // Removed 'mode' from top level
      side: obs.direction,
      stake_usd: betSizeUSDC,
      entry_prob: entryLimitPrice,
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
      outcome: 'OPEN'
    };

    // 1. DIRECTION CHECK
    const sideToBuy = obs.direction === 'UP' ? 'UP' : 'DOWN';
    if (directionMode !== 'BOTH' && directionMode !== sideToBuy) {
        return { executed: false, newExposure: currentExposure };
    }

    // 2. CONFIDENCE CHECK
    if (obs.confidence < confidenceThreshold) {
      this.log({ 
          ...eventPayload, 
          status: 'SKIPPED', 
          decision_reason: 'CONFIDENCE_TOO_LOW', 
          context: { mode: mode, dry_run: ENV.DRY_RUN }
      });
      return { executed: false, newExposure: currentExposure };
    }

    // 3. EXPOSURE CHECK
    if (currentExposure + betSizeUSDC > maxExposure) {
      this.log({ 
          ...eventPayload, 
          status: 'SKIPPED', 
          decision_reason: 'MAX_EXPOSURE_HIT', 
          context: { mode: mode, dry_run: ENV.DRY_RUN }
      });
      return { executed: false, newExposure: currentExposure };
    }

    // 4. RISK APPROVAL
    const approved = await riskGovernor.requestApproval(market, betSizeUSDC, currentExposure);
    if (!approved) {
      this.log({ 
          ...eventPayload, 
          status: 'SKIPPED', 
          decision_reason: 'RISK_VETO', 
          context: { mode: mode, dry_run: ENV.DRY_RUN } 
      });
      return { executed: false, newExposure: currentExposure };
    }

    // 5. RESOLVE TOKENS
    const tokens = await polymarket.getTokens(market.polymarket_market_id);
    if (!tokens) {
      this.log({ 
          ...eventPayload, 
          status: 'SKIPPED', 
          decision_reason: 'TOKEN_RESOLVE_FAIL', 
          error: 'Tokens not found', 
          context: { mode: mode, dry_run: ENV.DRY_RUN } 
      });
      return { executed: false, newExposure: currentExposure };
    }
    const tokenId = sideToBuy === 'UP' ? tokens.up : tokens.down;
    const shares = Number((betSizeUSDC / entryLimitPrice).toFixed(2));

    Logger.info(`[${contextId}] EXEC ${sideToBuy}: ${betSizeUSDC} USDC @ ${entryLimitPrice} | Model: ${(obs.calculatedProbability!*100).toFixed(1)}%`);

    try {
      if (ENV.DRY_RUN) {
          await new Promise(r => setTimeout(r, 200)); 
          
          this.log({ 
            ...eventPayload, 
            status: 'EXECUTED', 
            decision_reason: 'DRY_RUN_EXEC',
            context: { orderId: 'DRY-RUN-ID', shares, filledPrice: entryLimitPrice, mode: mode, dry_run: true }
          });

          // DO NOT LOG EXPOSURE CONSUME
          return { executed: false, simulated: true, newExposure: currentExposure };
      }

      // LIVE EXECUTION
      const orderId = await polymarket.placeOrder(tokenId, 'BUY', entryLimitPrice, shares);
      
      this.log({ 
        ...eventPayload, 
        status: 'EXECUTED', 
        decision_reason: 'EXECUTED',
        context: { orderId, shares, filledPrice: entryLimitPrice, mode: mode, dry_run: false }
      });
      
      // LOG CRITICAL EXPOSURE CONSUMPTION
      Logger.info(`[EXPOSURE] CONSUME run=${market.active_run_id} market=${market.polymarket_market_id} +${betSizeUSDC}`);

      return { executed: true, newExposure: currentExposure + betSizeUSDC };

    } catch (err: any) {
      Logger.error(`[${contextId}] EXEC FAIL`, err);
      this.log({ 
          ...eventPayload, 
          status: 'SKIPPED', 
          decision_reason: 'EXECUTION_ERROR', 
          error: err.message,
          context: { mode: mode, dry_run: ENV.DRY_RUN }
      });
      return { executed: false, newExposure: currentExposure };
    }
  }

  private log(data: any) {
    // Sanitization: Ensure no rogue fields leak in that aren't columns
    const { mode, ...cleanData } = data;

    Promise.resolve().then(async () => {
        const { error } = await supabase.from('trade_events').insert(cleanData);
        if (error) {
            Logger.error("DB Log Fail", error);
        }
    });
  }
}

export const executionService = new ExecutionService();
