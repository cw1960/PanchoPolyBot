
import { supabase } from './supabase';
import { Logger } from '../utils/logger';
import { TradeLedgerRow } from '../types/tables';

export class PnLLedgerService {
    
    /**
     * Records a new trade in the ledger. 
     * Used by ExecutionService for DRY_RUN (and eventually LIVE) trades.
     */
    public async recordOpenTrade(trade: TradeLedgerRow) {
        const { error } = await supabase.from('trade_ledger').insert(trade);
        if (error) {
            Logger.error('[PNL] Failed to record open trade', error);
        } else {
            Logger.info(`[PNL] Recorded OPEN ${trade.side} @ ${trade.entry_price.toFixed(3)} (${trade.mode})`);
        }
    }

    /**
     * Updates unrealized PnL for all OPEN trades in a specific run/market.
     * Uses the current mid-price of the 'YES' token as a reference.
     */
    public async updateUnrealizedPnL(marketId: string, runId: string, currentPriceYes: number) {
        // 1. Fetch OPEN trades for this run/market
        const { data: trades, error } = await supabase
            .from('trade_ledger')
            .select('*')
            .eq('run_id', runId)
            .eq('market_id', marketId)
            .eq('status', 'OPEN');
        
        if (error || !trades || trades.length === 0) return;

        // 2. Iterate and Update
        // Note: For performance, this loops individually. 
        // In a high-freq scenario, we would batch this.
        for (const trade of trades) {
            let currentPrice = currentPriceYes;
            
            // If we hold 'NO', the price is (1 - YES)
            // (Assuming binary complementary probability)
            if (trade.side === 'NO') {
                currentPrice = 1 - currentPriceYes;
            }

            // PnL Logic:
            // Value = Shares * CurrentPrice
            // Cost = Size (USD)
            // PnL = Value - Cost
            // Shares = Size / EntryPrice
            
            // Avoid division by zero
            if (trade.entry_price <= 0) continue;

            const shares = trade.size_usd / trade.entry_price;
            const currentValue = shares * currentPrice;
            const pnl = currentValue - trade.size_usd;

            await supabase
                .from('trade_ledger')
                .update({ 
                    unrealized_pnl: pnl,
                    metadata: { 
                        ...(trade.metadata || {}), 
                        last_mark_price: currentPrice, 
                        last_mark_at: new Date().toISOString() 
                    }
                 })
                .eq('id', trade.id);
        }
    }
}

export const pnlLedger = new PnLLedgerService();
