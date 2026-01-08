import { Market } from '../types/tables';
import { MarketObservation } from '../types/marketEdge';
import { Logger } from '../utils/logger';
import { riskGovernor } from '../risk/riskGovernor';
import { polymarket } from './polymarket';
import { supabase, logEvent } from './supabase';

/**
 * Execution Engine (The Hands)
 * 
 * Responsibilities:
 * 1. Decide IF a trade should occur (Gating)
 * 2. Decide WHAT to buy (Direction)
 * 3. Decide HOW MUCH (Sizing)
 * 4. Execute and Log
 */
export class ExecutionService {
  
  // Strict Safety Defaults
  private static readonly CONFIDENCE_THRESHOLD = 0.90; // Only trade on 90%+ confidence
  private static readonly MAX_ENTRY_PRICE_DEFAULT = 0.95; // Never pay more than 95c

  public async attemptTrade(market: Market, obs: MarketObservation, currentExposure: number) {
    const contextId = `EXEC-${Date.now()}`;

    // --- 1. GATING: CHECK CONFIDENCE ---
    if (obs.confidence < ExecutionService.CONFIDENCE_THRESHOLD) {
      // Too noisy, skip silently (or debug log if close)
      if (obs.confidence > 0.7) {
         Logger.info(`[${contextId}] SKIPPED: Confidence ${obs.confidence.toFixed(2)} < ${ExecutionService.CONFIDENCE_THRESHOLD}`);
      }
      return;
    }

    // --- 2. GATING: CHECK MARKET STATE ---
    if (!market.enabled) {
      await logEvent('WARN', `SKIPPED: Market ${market.polymarket_market_id} is disabled in config.`);
      return;
    }

    // --- 3. DIRECTION LOGIC ---
    // If Delta > 0, Spot is higher than Chainlink. Chainlink will move UP. We Buy YES/UP.
    // If Delta < 0, Spot is lower than Chainlink. Chainlink will move DOWN. We Buy NO/DOWN.
    const sideToBuy = obs.direction === 'UP' ? 'UP' : 'DOWN';
    
    Logger.info(`[${contextId}] ANALYZING: ${market.asset} | Spot > CL? ${obs.delta > 0} | Signal: BUY ${sideToBuy}`);

    // --- 4. SIZING LOGIC ---
    const betSizeUSDC = riskGovernor.calculateBetSize(); // e.g., $10
    
    // --- 5. RISK GOVERNOR APPROVAL ---
    const approved = await riskGovernor.requestApproval(market, betSizeUSDC, currentExposure);
    if (!approved) {
      await this.logSkip(market.polymarket_market_id, "Risk Governor Veto");
      return;
    }

    // --- 6. PREPARE EXECUTION ---
    // Resolve Token ID
    const tokens = await polymarket.getTokens(market.polymarket_market_id);
    if (!tokens) {
      Logger.error(`[${contextId}] FAILED: Could not resolve tokens for ${market.polymarket_market_id}`);
      return;
    }
    const tokenId = sideToBuy === 'UP' ? tokens.up : tokens.down;

    // Price Protection
    const maxPrice = market.max_entry_price || ExecutionService.MAX_ENTRY_PRICE_DEFAULT;

    // --- 7. EXECUTE (HANDS) ---
    Logger.info(`[${contextId}] EXECUTING: BUY ${sideToBuy} $${betSizeUSDC} @ <${maxPrice}`);
    
    try {
      // Calculate shares: $10 / 0.95 = ~10.52 shares
      const shares = Number((betSizeUSDC / maxPrice).toFixed(2));

      // Attempt Order Placement
      const orderId = await polymarket.placeOrder(tokenId, 'BUY', maxPrice, shares);
      
      // --- 8. SUCCESS LOGGING ---
      Logger.info(`[${contextId}] SUCCESS: Order ${orderId}`);
      
      await logEvent('INFO', `EXEC: BUY ${sideToBuy} | $${betSizeUSDC} | Delta: ${obs.delta.toFixed(2)}`);

      // Optimistic State Update (prevents double-fire in next loop tick)
      await supabase.from('market_state').upsert({
        market_id: market.id,
        exposure: currentExposure + betSizeUSDC,
        last_update: new Date().toISOString()
      });

    } catch (err: any) {
      // --- 9. FAILURE HANDLING ---
      Logger.error(`[${contextId}] FAILED: ${err.message}`);
      await logEvent('ERROR', `Trade Failed: ${err.message}`);
    }
  }

  private async logSkip(marketId: string, reason: string) {
    // We log skips to DB only if they are significant errors, otherwise just console
    Logger.warn(`[EXEC] SKIPPED ${marketId}: ${reason}`);
    await logEvent('INFO', `Skipped: ${reason}`);
  }
}

export const executionService = new ExecutionService();
