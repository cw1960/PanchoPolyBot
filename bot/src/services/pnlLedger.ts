
import { supabase } from './supabase';
import { Logger } from '../utils/logger';
import { TradeLedgerRow } from '../types/tables';

export class PnLLedgerService {
    
    /**
     * Records a new trade in the ledger. 
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
     */
    public async updateUnrealizedPnL(marketId: string, runId: string, currentPriceYes: number) {
        const { data: trades, error } = await supabase
            .from('trade_ledger')
            .select('*')
            .eq('run_id', runId)
            .eq('market_id', marketId)
            .eq('status', 'OPEN');
        
        if (error || !trades || trades.length === 0) return;

        for (const trade of trades) {
            let currentPrice = currentPriceYes;
            if (trade.side === 'NO') {
                currentPrice = 1 - currentPriceYes;
            }

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

    /**
     * Helper to get total open shares for a run/market.
     * Used by Defensive Exit to determine how much to sell.
     */
    public async getNetPosition(runId: string, marketId: string): Promise<{ shares: number, avgEntry: number }> {
        const { data: trades } = await supabase
            .from('trade_ledger')
            .select('*')
            .eq('run_id', runId)
            .eq('market_id', marketId)
            .eq('status', 'OPEN');
        
        if (!trades || trades.length === 0) return { shares: 0, avgEntry: 0 };

        let totalShares = 0;
        let weightedSum = 0;

        for (const t of trades) {
            const s = t.size_usd / t.entry_price;
            totalShares += s;
            weightedSum += (s * t.entry_price);
        }

        return {
            shares: totalShares,
            avgEntry: totalShares > 0 ? weightedSum / totalShares : 0
        };
    }

    /**
     * Closes all OPEN positions for a market (Defensive Exit).
     * Assumes immediate exit at current market mid or bid.
     */
    public async closePosition(runId: string, marketId: string, reason: string, details: any) {
         // In DRY RUN, we assume we sold at current market value.
         // Since we don't have exact fill price passed easily here for every single trade without complexity,
         // We will assume a rough penalty (slippage) or use the last marked price.
         // For accuracy, ExecutionService should ideally pass the fill price, but closing all in bulk
         // usually implies using a single exit price.
         
         // Fetch open trades
         const { data: trades } = await supabase
            .from('trade_ledger')
            .select('*')
            .eq('run_id', runId)
            .eq('market_id', marketId)
            .eq('status', 'OPEN');

         if (!trades || trades.length === 0) return;

         // For DRY RUN simulation, we assume we exit at a "fair" but slightly punished price 
         // to simulate spread crossing.
         // Let's rely on the last updated mark price or use a generic "exit at 0.5" if unknown?
         // No, we should use metadata.
         
         const exitTimestamp = new Date().toISOString();

         for (const trade of trades) {
             // Use the last mark price as the exit price if available, else standard
             let exitPrice = trade.metadata?.last_mark_price || trade.entry_price; 
             
             // Apply slippage penalty for defensive exit (1%)
             exitPrice = exitPrice * 0.99;

             const shares = trade.size_usd / trade.entry_price;
             const finalValue = shares * exitPrice;
             const realizedPnl = finalValue - trade.size_usd;

             await supabase
                .from('trade_ledger')
                .update({
                    status: 'CLOSED',
                    exit_price: exitPrice,
                    realized_pnl: realizedPnl,
                    unrealized_pnl: 0,
                    closed_at: exitTimestamp,
                    metadata: {
                        ...(trade.metadata || {}),
                        exit_reason: reason,
                        exit_details: details
                    }
                })
                .eq('id', trade.id);
         }
    }

    /**
     * Settles all OPEN trades upon expiration.
     */
    public async settleMarket(marketId: string, runId: string, finalPriceYes: number, source: string = 'UNKNOWN') {
        const { data: trades, error } = await supabase
            .from('trade_ledger')
            .select('*')
            .eq('run_id', runId)
            .eq('market_id', marketId)
            .eq('status', 'OPEN');

        if (error || !trades || trades.length === 0) return;

        Logger.info(`[PNL_SETTLE] Closing ${trades.length} trades. Market=${marketId} Price=${finalPriceYes.toFixed(3)} Source=${source}`);

        for (const trade of trades) {
            let exitPrice = finalPriceYes;
            if (trade.side === 'NO') {
                exitPrice = 1 - finalPriceYes;
            }

            const shares = trade.size_usd / trade.entry_price;
            const finalValue = shares * exitPrice;
            const realizedPnl = finalValue - trade.size_usd;

            await supabase
                .from('trade_ledger')
                .update({
                    status: 'CLOSED',
                    exit_price: exitPrice,
                    realized_pnl: realizedPnl,
                    unrealized_pnl: 0,
                    closed_at: new Date().toISOString(),
                    metadata: {
                        ...(trade.metadata || {}),
                        settlement_reason: 'EXPIRY',
                        settlement_source: source,
                        final_mark_price: finalPriceYes
                    }
                })
                .eq('id', trade.id)
                .eq('status', 'OPEN'); 
        }
    }
}

export const pnlLedger = new PnLLedgerService();
