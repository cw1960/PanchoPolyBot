
import { Market, TradeEventRow } from '../types/tables';
import { MarketObservation } from '../types/marketEdge';
import { Logger } from '../utils/logger';
import { riskGovernor } from '../risk/riskGovernor';
import { polymarket } from './polymarket';
import { ENV } from '../config/env';
import { feeModel } from './feeModel';
import { TradeLogger } from './tradeLogger';

export class ExecutionService {
  
  private static readonly MAX_ENTRY_PRICE_DEFAULT = 0.95;

  public async attemptTrade(market: Market, obs: MarketObservation, currentExposure: number): Promise<{ executed: boolean, simulated?: boolean, newExposure: number }> {
    const contextId = `EXEC-${Date.now()}`;
    const mode = ENV.DRY_RUN ? 'DRY_RUN' : 'LIVE';
    
    const run = market._run;
    const expParams = run?.params || {};
    
    // PRIORITY: Experiment Param -> Risk Governor Default
    let betSizeUSDC: number;
    if (expParams.tradeSize && expParams.tradeSize > 0) {
        betSizeUSDC = expParams.tradeSize;
    } else {
        betSizeUSDC = riskGovernor.calculateBetSize();
        // Log this fallback so we know why it's happening
        if (run) Logger.warn(`[${contextId}] Fallback to Default Bet Size ($${betSizeUSDC}) - 'tradeSize' missing in run params.`);
    }

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

    const eventPayload: TradeEventRow = {
      test_run_id: market.active_run_id || undefined, 
      market_id: market.id,
      polymarket_market_id: market.polymarket_market_id,
      asset: market.asset,
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
      outcome: 'OPEN',
      context: { mode, dry_run: ENV.DRY_RUN }
    };

    // 1. DIRECTION CHECK
    const sideToBuy = obs.direction === 'UP' ? 'UP' : 'DOWN';
    if (directionMode !== 'BOTH' && directionMode !== sideToBuy) {
        return { executed: false, newExposure: currentExposure };
    }

    // 2. CONFIDENCE CHECK
    if (obs.confidence < confidenceThreshold) {
      TradeLogger.log({ 
          ...eventPayload, 
          status: 'SKIPPED', 
          decision_reason: 'CONFIDENCE_TOO_LOW' 
      });
      return { executed: false, newExposure: currentExposure };
    }

    // 3. EXPOSURE CHECK
    // In DRY_RUN, we bypass this local check to allow the RiskGovernor to log the bypass event.
    // In LIVE, we strictly enforce it here.
    if (!ENV.DRY_RUN && (currentExposure + betSizeUSDC > maxExposure)) {
      TradeLogger.log({ 
          ...eventPayload, 
          status: 'SKIPPED', 
          decision_reason: 'MAX_EXPOSURE_HIT' 
      });
      return { executed: false, newExposure: currentExposure };
    }

    // 4. RISK APPROVAL
    const approved = await riskGovernor.requestApproval(market, betSizeUSDC, currentExposure);
    if (!approved) {
      TradeLogger.log({ 
          ...eventPayload, 
          status: 'SKIPPED', 
          decision_reason: 'RISK_VETO' 
      });
      return { executed: false, newExposure: currentExposure };
    }

    // 5. RESOLVE TOKENS
    const tokens = await polymarket.getTokens(market.polymarket_market_id);
    if (!tokens) {
      TradeLogger.log({ 
          ...eventPayload, 
          status: 'SKIPPED', 
          decision_reason: 'TOKEN_RESOLVE_FAIL', 
          error: 'Tokens not found' 
      });
      return { executed: false, newExposure: currentExposure };
    }
    const tokenId = sideToBuy === 'UP' ? tokens.up : tokens.down;
    const shares = Number((betSizeUSDC / entryLimitPrice).toFixed(2));

    Logger.info(`[${contextId}] EXEC ${sideToBuy}: ${betSizeUSDC} USDC @ ${entryLimitPrice} | Model: ${(obs.calculatedProbability!*100).toFixed(1)}%`);

    try {
      if (ENV.DRY_RUN) {
          await new Promise(r => setTimeout(r, 200)); 
          
          TradeLogger.log({ 
            ...eventPayload, 
            status: 'EXECUTED', 
            decision_reason: 'DRY_RUN_EXEC',
            context: { orderId: 'DRY-RUN-ID', shares, filledPrice: entryLimitPrice, mode, dry_run: true }
          });

          // DO NOT LOG EXPOSURE CONSUME
          return { executed: false, simulated: true, newExposure: currentExposure };
      }

      // LIVE EXECUTION
      const orderId = await polymarket.placeOrder(tokenId, 'BUY', entryLimitPrice, shares);
      
      TradeLogger.log({ 
        ...eventPayload, 
        status: 'EXECUTED', 
        decision_reason: 'EXECUTED',
        context: { orderId, shares, filledPrice: entryLimitPrice, mode, dry_run: false }
      });
      
      // LOG CRITICAL EXPOSURE CONSUMPTION
      Logger.info(`[EXPOSURE] CONSUME run=${market.active_run_id} market=${market.polymarket_market_id} +${betSizeUSDC}`);

      return { executed: true, newExposure: currentExposure + betSizeUSDC };

    } catch (err: any) {
      Logger.error(`[${contextId}] EXEC FAIL`, err);
      TradeLogger.log({ 
          ...eventPayload, 
          status: 'SKIPPED', 
          decision_reason: 'EXECUTION_ERROR', 
          error: err.message
      });
      return { executed: false, newExposure: currentExposure };
    }
  }
}

export const executionService = new ExecutionService();
