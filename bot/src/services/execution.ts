
import { Market } from '../types/tables';
import { MarketObservation } from '../types/marketEdge';
import { Logger } from '../utils/logger';
import { riskGovernor } from '../risk/riskGovernor';
import { polymarket } from './polymarket';
import { supabase } from './supabase'; // Using raw insert for events
import { ENV } from '../config/env';
import { feeModel } from './feeModel';

/**
 * Execution Engine (The Hands)
 */
export class ExecutionService {
  
  private static readonly CONFIDENCE_THRESHOLD = 0.60; // Adjusted from log
  private static readonly MAX_ENTRY_PRICE_DEFAULT = 0.95;

  /**
   * Attempts a trade.
   * @returns { executed: boolean, newExposure: number } - Returns new exposure state to update the Loop
   */
  public async attemptTrade(market: Market, obs: MarketObservation, currentExposure: number): Promise<{ executed: boolean, newExposure: number }> {
    const contextId = `EXEC-${Date.now()}`;
    const mode = ENV.DRY_RUN ? 'DRY_RUN' : 'LIVE';
    
    // Prepare Data for Logging
    const betSizeUSDC = riskGovernor.calculateBetSize(); 
    // Entry prob is derived from the observation/market data. 
    // In a real limit order, this is our limit price. 
    // For now, we assume the observation delta implies a target entry.
    // Let's use spot/chainlink or the 'spot' price as a proxy for decision context, 
    // BUT typically we need the OrderBook price. 
    // Since this is called *after* an Edge is found, let's assume market.max_entry_price is the limit.
    const entryProb = market.max_entry_price || ExecutionService.MAX_ENTRY_PRICE_DEFAULT;
    
    // Calculate Metrics
    const metrics = feeModel.calculateMetrics(entryProb, obs.confidence, betSizeUSDC);
    
    const baseLogData = {
      market_id: market.id,
      polymarket_market_id: market.polymarket_market_id,
      mode: mode,
      side: obs.direction,
      stake_usd: betSizeUSDC,
      entry_prob: entryProb,
      confidence: obs.confidence,
      buy_fee_pct: metrics.buyFeePct,
      sell_fee_pct: metrics.sellFeePct,
      edge_after_fees_pct: metrics.edgePct,
      ev_after_fees_usd: metrics.evUsd,
      notes: { delta: obs.delta, chainlink: obs.chainlink, spot: obs.spot }
    };

    // 1. CONFIDENCE CHECK
    if (obs.confidence < ExecutionService.CONFIDENCE_THRESHOLD) {
      this.logEventAsync({ ...baseLogData, decision_reason: 'CONFIDENCE_TOO_LOW', status: 'SKIPPED', outcome: 'OPEN' });
      return { executed: false, newExposure: currentExposure };
    }

    // 2. CONFIG CHECK
    if (!market.enabled) {
      this.logEventAsync({ ...baseLogData, decision_reason: 'MARKET_DISABLED', status: 'SKIPPED', outcome: 'OPEN' });
      return { executed: false, newExposure: currentExposure };
    }

    const sideToBuy = obs.direction === 'UP' ? 'UP' : 'DOWN';

    // 3. RISK APPROVAL
    const approved = await riskGovernor.requestApproval(market, betSizeUSDC, currentExposure);
    if (!approved) {
      await this.logSkip(market.polymarket_market_id, "Risk Governor Veto");
      this.logEventAsync({ ...baseLogData, decision_reason: 'RISK_VETO', status: 'SKIPPED', outcome: 'OPEN' });
      return { executed: false, newExposure: currentExposure };
    }

    // 4. PREPARE
    const tokens = await polymarket.getTokens(market.polymarket_market_id);
    if (!tokens) {
      Logger.error(`[${contextId}] FAILED: Could not resolve tokens for ${market.polymarket_market_id}`);
      this.logEventAsync({ ...baseLogData, decision_reason: 'TOKEN_RESOLVE_FAIL', status: 'SKIPPED', outcome: 'OPEN' });
      return { executed: false, newExposure: currentExposure };
    }
    const tokenId = sideToBuy === 'UP' ? tokens.up : tokens.down;
    const shares = Number((betSizeUSDC / entryProb).toFixed(2));

    Logger.info(`[${contextId}] EXECUTING: BUY ${sideToBuy} $${betSizeUSDC} @ <${entryProb} (EV: $${metrics.evUsd.toFixed(3)}) ${ENV.DRY_RUN ? '(DRY RUN)' : ''}`);

    try {
      let orderId = 'DRY-RUN-ID';

      // 5. EXECUTE (Real or Dry)
      if (!ENV.DRY_RUN) {
        orderId = await polymarket.placeOrder(tokenId, 'BUY', entryProb, shares);
      } else {
        await new Promise(r => setTimeout(r, 500)); // Simulate latency
      }
      
      Logger.info(`[${contextId}] SUCCESS: Order ${orderId}`);
      
      // Log Success
      this.logEventAsync({ 
        ...baseLogData, 
        decision_reason: 'EXECUTED', 
        status: 'EXECUTED', 
        outcome: 'OPEN',
        notes: { ...baseLogData.notes, orderId } 
      });

      const newExposure = currentExposure + betSizeUSDC;

      // 6. UPDATE DB (Exposure State)
      try {
        await supabase.from('market_state').upsert({
          market_id: market.id,
          exposure: newExposure,
          last_update: new Date().toISOString()
        });
      } catch (dbErr) {
        Logger.error(`[${contextId}] CRITICAL: Order succeeded but DB update failed! Local state desync risk.`, dbErr);
      }

      return { executed: true, newExposure };

    } catch (err: any) {
      // Order Placement Failed
      Logger.error(`[${contextId}] FAILED: ${err.message}`);
      this.logEventAsync({ ...baseLogData, decision_reason: `EXECUTION_ERROR: ${err.message}`, status: 'SKIPPED', outcome: 'OPEN' });
      return { executed: false, newExposure: currentExposure };
    }
  }

  private async logSkip(marketId: string, reason: string) {
    Logger.warn(`[EXEC] SKIPPED ${marketId}: ${reason}`);
  }

  // Non-blocking fire-and-forget logging
  private async logEventAsync(payload: any) {
    try {
        const { error } = await supabase.from('trade_events').insert(payload);
        if (error) console.error("Failed to log trade_event:", error.message);
    } catch (e) {
        console.error("Failed to log trade_event:", e);
    }
  }
}

export const executionService = new ExecutionService();
