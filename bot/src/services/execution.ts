import { Market } from '../types/tables';
import { MarketObservation } from '../types/marketEdge';
import { Logger } from '../utils/logger';
import { riskGovernor } from '../risk/riskGovernor';
import { polymarket } from './polymarket';
import { ENV } from '../config/env';
import { feeModel } from './feeModel';
import { supabase } from './supabase';

/**
 * Execution Engine (The Hands)
 */
export class ExecutionService {
  
  private static readonly MAX_ENTRY_PRICE_DEFAULT = 0.95;

  /**
   * Attempts a trade.
   * @returns { executed: boolean, newExposure: number }
   */
  public async attemptTrade(market: Market, obs: MarketObservation, currentExposure: number): Promise<{ executed: boolean, newExposure: number }> {
    const contextId = `EXEC-${Date.now()}`;
    const mode = ENV.DRY_RUN ? 'DRY_RUN' : 'LIVE';
    
    // --- EXPERIMENT PARAMETERS ---
    const run = market._run;
    const expParams = run?.params || {};
    
    const betSizeUSDC = expParams.tradeSize || riskGovernor.calculateBetSize(); 
    const maxExposure = expParams.maxExposure || market.max_exposure || 50;
    const directionMode = expParams.direction || 'BOTH';
    const confidenceThreshold = expParams.confidenceThreshold || 0.60;
    
    // 1. Metrics & Payload
    const entryProb = market.max_entry_price || ExecutionService.MAX_ENTRY_PRICE_DEFAULT;
    const metrics = feeModel.calculateMetrics(entryProb, obs.confidence, betSizeUSDC);
    
    const eventPayload = {
      test_run_id: market.active_run_id, 
      market_id: market.id,
      polymarket_market_id: market.polymarket_market_id,
      asset: market.asset,
      mode: mode,
      side: obs.direction,
      stake_usd: betSizeUSDC,
      entry_prob: entryProb,
      confidence: obs.confidence,
      edge_after_fees_pct: metrics.edgePct,
      ev_after_fees_usd: metrics.evUsd,
      fees: {
        buy_fee_pct: metrics.buyFeePct,
        sell_fee_pct: metrics.sellFeePct
      },
      signals: {
        delta: obs.delta,
        chainlink: obs.chainlink,
        spot: obs.spot
      },
      status: 'INTENDED',
      decision_reason: 'ANALYZING',
      outcome: 'OPEN'
    };

    // 2. DIRECTION CHECK
    const sideToBuy = obs.direction === 'UP' ? 'UP' : 'DOWN';
    if (directionMode !== 'BOTH' && directionMode !== sideToBuy) {
        // Silently skip filter
        return { executed: false, newExposure: currentExposure };
    }

    // 3. CONFIDENCE CHECK
    if (obs.confidence < confidenceThreshold) {
      this.log({ ...eventPayload, status: 'SKIPPED', decision_reason: 'CONFIDENCE_TOO_LOW', dry_run: ENV.DRY_RUN });
      return { executed: false, newExposure: currentExposure };
    }

    // 4. EXPERIMENT EXPOSURE CHECK
    if (currentExposure + betSizeUSDC > maxExposure) {
      this.log({ ...eventPayload, status: 'SKIPPED', decision_reason: 'EXP_MAX_EXPOSURE', dry_run: ENV.DRY_RUN });
      return { executed: false, newExposure: currentExposure };
    }

    // 5. GLOBAL RISK APPROVAL
    const approved = await riskGovernor.requestApproval(market, betSizeUSDC, currentExposure);
    if (!approved) {
      this.log({ ...eventPayload, status: 'SKIPPED', decision_reason: 'RISK_VETO', dry_run: ENV.DRY_RUN });
      return { executed: false, newExposure: currentExposure };
    }

    // 6. PREPARE EXECUTION
    const tokens = await polymarket.getTokens(market.polymarket_market_id);
    if (!tokens) {
      Logger.error(`[${contextId}] FAILED: Could not resolve tokens for ${market.polymarket_market_id}`);
      this.log({ ...eventPayload, status: 'SKIPPED', decision_reason: 'TOKEN_RESOLVE_FAIL', error: 'Tokens not found', dry_run: ENV.DRY_RUN });
      return { executed: false, newExposure: currentExposure };
    }
    const tokenId = sideToBuy === 'UP' ? tokens.up : tokens.down;
    const shares = Number((betSizeUSDC / entryProb).toFixed(2));

    Logger.info(`[${contextId}] EXECUTING: BUY ${sideToBuy} $${betSizeUSDC} @ <${entryProb} (EV: $${metrics.evUsd.toFixed(3)}) ${ENV.DRY_RUN ? '(DRY RUN)' : ''}`);

    try {
      let orderId = 'DRY-RUN-ID';

      // 7. EXECUTE (Real or Dry)
      if (!ENV.DRY_RUN) {
        orderId = await polymarket.placeOrder(tokenId, 'BUY', entryProb, shares);
      } else {
        await new Promise(r => setTimeout(r, 500)); // Simulate latency
      }
      
      Logger.info(`[${contextId}] SUCCESS: Order ${orderId}`);
      
      // 8. LOG SUCCESS (PERSIST TO DB)
      this.log({ 
        ...eventPayload, 
        status: 'EXECUTED', 
        decision_reason: 'EXECUTED',
        context: { orderId, shares },
        dry_run: ENV.DRY_RUN
      });

      // Update Exposure (Optimistic)
      return { executed: true, newExposure: currentExposure + betSizeUSDC };

    } catch (err: any) {
      Logger.error(`[${contextId}] FAILED: ${err.message}`);
      this.log({ 
          ...eventPayload, 
          status: 'SKIPPED', 
          decision_reason: 'EXECUTION_ERROR', 
          error: err.message,
          dry_run: ENV.DRY_RUN
      });
      return { executed: false, newExposure: currentExposure };
    }
  }

  /**
   * Private helper to log directly to Supabase trade_events.
   * Fire-and-forget to avoid blocking the tick loop.
   */
  private log(data: any) {
    Promise.resolve().then(async () => {
        const { error } = await supabase.from('trade_events').insert(data);
        if (error) {
            Logger.error("Failed to insert trade log", error);
        }
    });
  }
}

export const executionService = new ExecutionService();
