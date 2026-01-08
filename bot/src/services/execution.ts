import { Market } from '../types/tables';
import { MarketObservation } from '../types/marketEdge';
import { Logger } from '../utils/logger';
import { riskGovernor } from '../risk/riskGovernor';
import { polymarket } from './polymarket';
import { supabase, logEvent } from './supabase';
import { ENV } from '../config/env';

/**
 * Execution Engine (The Hands)
 */
export class ExecutionService {
  
  private static readonly CONFIDENCE_THRESHOLD = 0.90;
  private static readonly MAX_ENTRY_PRICE_DEFAULT = 0.95;

  /**
   * Attempts a trade.
   * @returns { executed: boolean, newExposure: number } - Returns new exposure state to update the Loop
   */
  public async attemptTrade(market: Market, obs: MarketObservation, currentExposure: number): Promise<{ executed: boolean, newExposure: number }> {
    const contextId = `EXEC-${Date.now()}`;

    // 1. CONFIDENCE CHECK
    if (obs.confidence < ExecutionService.CONFIDENCE_THRESHOLD) {
      return { executed: false, newExposure: currentExposure };
    }

    // 2. CONFIG CHECK
    if (!market.enabled) {
      return { executed: false, newExposure: currentExposure };
    }

    const sideToBuy = obs.direction === 'UP' ? 'UP' : 'DOWN';
    const betSizeUSDC = riskGovernor.calculateBetSize(); 

    // 3. RISK APPROVAL
    const approved = await riskGovernor.requestApproval(market, betSizeUSDC, currentExposure);
    if (!approved) {
      await this.logSkip(market.polymarket_market_id, "Risk Governor Veto");
      return { executed: false, newExposure: currentExposure };
    }

    // 4. PREPARE
    const tokens = await polymarket.getTokens(market.polymarket_market_id);
    if (!tokens) {
      Logger.error(`[${contextId}] FAILED: Could not resolve tokens for ${market.polymarket_market_id}`);
      return { executed: false, newExposure: currentExposure };
    }
    const tokenId = sideToBuy === 'UP' ? tokens.up : tokens.down;
    const maxPrice = market.max_entry_price || ExecutionService.MAX_ENTRY_PRICE_DEFAULT;
    const shares = Number((betSizeUSDC / maxPrice).toFixed(2));

    Logger.info(`[${contextId}] EXECUTING: BUY ${sideToBuy} $${betSizeUSDC} @ <${maxPrice} ${ENV.DRY_RUN ? '(DRY RUN)' : ''}`);

    try {
      let orderId = 'DRY-RUN-ID';

      // 5. EXECUTE (Real or Dry)
      if (!ENV.DRY_RUN) {
        orderId = await polymarket.placeOrder(tokenId, 'BUY', maxPrice, shares);
      } else {
        await new Promise(r => setTimeout(r, 500)); // Simulate latency
      }
      
      Logger.info(`[${contextId}] SUCCESS: Order ${orderId}`);
      await logEvent('INFO', `EXEC: BUY ${sideToBuy} | $${betSizeUSDC} | Delta: ${obs.delta.toFixed(2)} ${ENV.DRY_RUN ? '[DRY]' : ''}`);

      const newExposure = currentExposure + betSizeUSDC;

      // 6. UPDATE DB
      // CRITICAL: If this fails, we must still return { executed: true } because the money is spent.
      // If we return false, the bot will retry the order and spend MORE money (Double Spend).
      try {
        await supabase.from('market_state').upsert({
          market_id: market.id,
          exposure: newExposure,
          last_update: new Date().toISOString()
        });
      } catch (dbErr) {
        Logger.error(`[${contextId}] CRITICAL: Order succeeded but DB update failed! Local state desync risk.`, dbErr);
        // We do NOT re-throw. We prioritize marking the trade as executed.
      }

      // 7. RETURN UPDATED STATE (Critical for Loop Sync)
      return { executed: true, newExposure };

    } catch (err: any) {
      // Order Placement Failed
      Logger.error(`[${contextId}] FAILED: ${err.message}`);
      await logEvent('ERROR', `Trade Failed: ${err.message}`);
      return { executed: false, newExposure: currentExposure };
    }
  }

  private async logSkip(marketId: string, reason: string) {
    Logger.warn(`[EXEC] SKIPPED ${marketId}: ${reason}`);
  }
}

export const executionService = new ExecutionService();
