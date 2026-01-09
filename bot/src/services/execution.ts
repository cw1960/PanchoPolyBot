
import { Market } from '../types/tables';
import { MarketObservation } from '../types/marketEdge';
import { Logger } from '../utils/logger';
import { riskGovernor } from '../risk/riskGovernor';
import { polymarket } from './polymarket';
import { ENV } from '../config/env';
import { feeModel } from './feeModel';
import { TradeLogger } from './tradeLogger';

/**
 * Execution Engine (The Hands)
 */
export class ExecutionService {
  
  private static readonly CONFIDENCE_THRESHOLD = 0.60;
  private static readonly MAX_ENTRY_PRICE_DEFAULT = 0.95;

  /**
   * Attempts a trade.
   * @returns { executed: boolean, newExposure: number }
   */
  public async attemptTrade(market: Market, obs: MarketObservation, currentExposure: number): Promise<{ executed: boolean, newExposure: number }> {
    const contextId = `EXEC-${Date.now()}`;
    const mode = ENV.DRY_RUN ? 'DRY_RUN' : 'LIVE';
    
    // 1. Calculate Core Metrics
    const betSizeUSDC = riskGovernor.calculateBetSize(); 
    const entryProb = market.max_entry_price || ExecutionService.MAX_ENTRY_PRICE_DEFAULT;
    
    // Fee & EV Model
    const metrics = feeModel.calculateMetrics(entryProb, obs.confidence, betSizeUSDC);
    
    // Base Event Payload
    const eventPayload = {
      test_run_id: market.active_run_id, // Link to the specific dynamic test run from market config
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

    // 2. CONFIDENCE CHECK
    if (obs.confidence < ExecutionService.CONFIDENCE_THRESHOLD) {
      TradeLogger.log({ ...eventPayload, status: 'SKIPPED', decision_reason: 'CONFIDENCE_TOO_LOW' });
      return { executed: false, newExposure: currentExposure };
    }

    // 3. CONFIG CHECK
    if (!market.enabled) {
      TradeLogger.log({ ...eventPayload, status: 'SKIPPED', decision_reason: 'MARKET_DISABLED' });
      return { executed: false, newExposure: currentExposure };
    }

    const sideToBuy = obs.direction === 'UP' ? 'UP' : 'DOWN';

    // 4. RISK APPROVAL
    const approved = await riskGovernor.requestApproval(market, betSizeUSDC, currentExposure);
    if (!approved) {
      TradeLogger.log({ ...eventPayload, status: 'SKIPPED', decision_reason: 'RISK_VETO' });
      return { executed: false, newExposure: currentExposure };
    }

    // 5. PREPARE EXECUTION
    const tokens = await polymarket.getTokens(market.polymarket_market_id);
    if (!tokens) {
      Logger.error(`[${contextId}] FAILED: Could not resolve tokens for ${market.polymarket_market_id}`);
      TradeLogger.log({ ...eventPayload, status: 'SKIPPED', decision_reason: 'TOKEN_RESOLVE_FAIL', error: 'Tokens not found in cache/API' });
      return { executed: false, newExposure: currentExposure };
    }
    const tokenId = sideToBuy === 'UP' ? tokens.up : tokens.down;
    const shares = Number((betSizeUSDC / entryProb).toFixed(2));

    Logger.info(`[${contextId}] EXECUTING: BUY ${sideToBuy} $${betSizeUSDC} @ <${entryProb} (EV: $${metrics.evUsd.toFixed(3)}) ${ENV.DRY_RUN ? '(DRY RUN)' : ''}`);

    try {
      let orderId = 'DRY-RUN-ID';

      // 6. EXECUTE (Real or Dry)
      if (!ENV.DRY_RUN) {
        orderId = await polymarket.placeOrder(tokenId, 'BUY', entryProb, shares);
      } else {
        await new Promise(r => setTimeout(r, 500)); // Simulate latency
      }
      
      Logger.info(`[${contextId}] SUCCESS: Order ${orderId}`);
      
      // 7. LOG SUCCESS
      TradeLogger.log({ 
        ...eventPayload, 
        status: 'EXECUTED', 
        decision_reason: 'EXECUTED',
        context: { orderId, shares }
      });

      // Update Exposure (Optimistic)
      return { executed: true, newExposure: currentExposure + betSizeUSDC };

    } catch (err: any) {
      Logger.error(`[${contextId}] FAILED: ${err.message}`);
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
