import { Market } from '../types/tables';
import { MarketObservation } from '../types/marketEdge';
import { Logger } from '../utils/logger';
import { riskGovernor } from '../risk/riskGovernor';
import { polymarket } from './polymarket';
import { supabase, logEvent } from './supabase';

export class ExecutionService {
  
  public async attemptTrade(market: Market, obs: MarketObservation, currentExposure: number) {
    // 1. Filter Weak Signals
    if (obs.confidence < 0.7) return; // Only trade on 70%+ confidence

    // 2. Determine Logic
    // If Delta is Positive (Spot > Chainlink), Chainlink WILL go UP. We Buy YES/UP.
    const sideToBuy = obs.direction === 'UP' ? 'UP' : 'DOWN';
    
    // 3. Resolve Token ID
    const tokens = await polymarket.getTokens(market.polymarket_market_id);
    if (!tokens) {
      Logger.error(`Could not resolve tokens for ${market.polymarket_market_id}`);
      return;
    }
    const tokenId = sideToBuy === 'UP' ? tokens.up : tokens.down;

    // 4. Sizing (Fixed for now, can be dynamic later)
    const betSizeUSDC = 10; 
    
    // 5. Price Limit
    // We only buy if we can get it cheap (e.g. < 0.95) to allow profit
    const maxPrice = market.max_entry_price || 0.95; 

    // 6. Risk Check
    const approved = await riskGovernor.requestApproval(market, betSizeUSDC, currentExposure);
    if (!approved) return;

    // 7. EXECUTE
    Logger.info(`[EXEC] Placing BUY ${sideToBuy} on ${market.asset} for $${betSizeUSDC} @ <${maxPrice}`);
    
    try {
      // Calculate size in contracts: $10 / 0.95 = ~10.5 shares
      // For safety in Limit orders, we might bid at exactly maxPrice to get filled immediately if available
      const shares = Number((betSizeUSDC / maxPrice).toFixed(2));

      const orderId = await polymarket.placeOrder(tokenId, 'BUY', maxPrice, shares);
      
      Logger.info(`[EXEC] Success! Order ID: ${orderId}`);
      await logEvent('INFO', `Trade Executed: BUY ${sideToBuy} ${shares} shares @ ${maxPrice}`);

      // 8. Update DB with new exposure (Optimistic)
      // Real exposure syncing happens via order status, but we increment here to prevent double-betting
      await supabase.from('market_state').upsert({
        market_id: market.id,
        exposure: currentExposure + betSizeUSDC,
        last_update: new Date().toISOString()
      });

    } catch (err: any) {
      Logger.error(`[EXEC] Order Failed: ${err.message}`);
      await logEvent('ERROR', `Order Failed: ${err.message}`);
    }
  }
}

export const executionService = new ExecutionService();
