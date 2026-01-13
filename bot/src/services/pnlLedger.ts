
import { supabase } from './supabase';
import { Logger } from '../utils/logger';
import { TradeLedgerRow } from '../types/tables';
import { accountManager } from './accountManager'; // NEW IMPORT

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
         
         // Fetch open trades
         // We need to fetch 'metadata' to know which account it belongs to if we stored it there.
         // Or infer from 'market_id' -> 'market' -> 'asset'.
         // Ideally, we fetch market details too, but we can do a second lookup.
         
         const { data: trades } = await supabase
            .from('trade_ledger')
            .select('*, markets(asset)')
            .eq('run_id', runId)
            .eq('market_id', marketId)
            .eq('status', 'OPEN');

         if (!trades || trades.length === 0) return;

         const exitTimestamp = new Date().toISOString();

         for (const trade of trades) {
             let exitPrice = trade.metadata?.last_mark_price || trade.entry_price; 
             exitPrice = exitPrice * 0.99; // Slippage penalty

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
            
            // CRITICAL: UPDATE ISOLATED ACCOUNT PnL
            // We need asset and direction.
            // Asset comes from join (markets(asset)) if supabase supports it, or we rely on metadata
            const asset = (trade as any).markets?.asset || trade.metadata?.asset || 'BTC'; // Fallback needs to be robust
            
            // Direction: If side is YES, direction is UP. If NO, direction is DOWN.
            // Assumption: This mapping holds for standard markets.
            const direction = trade.side === 'YES' ? 'UP' : 'DOWN';
            
            // 1. Update PnL & Bankroll
            accountManager.updatePnL(asset, direction, realizedPnl);
            
            // 2. Reduce Exposure (Free up the cost basis)
            // When we close, we remove the Cost Basis from Current Exposure.
            accountManager.updateExposure(asset, direction, -trade.size_usd);
         }
    }

    /**
     * Settles all OPEN trades upon expiration.
     */
    public async settleMarket(marketId: string, runId: string, finalPriceYes: number, source: string = 'UNKNOWN') {
        const { data: trades, error } = await supabase
            .from('trade_ledger')
            .select('*, markets(asset)')
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
            
            // CRITICAL: UPDATE ISOLATED ACCOUNT PnL
            const asset = (trade as any).markets?.asset || 'BTC'; 
            const direction = trade.side === 'YES' ? 'UP' : 'DOWN';

            accountManager.updatePnL(asset, direction, realizedPnl);
            accountManager.updateExposure(asset, direction, -trade.size_usd);
        }
    }
}

export const pnlLedger = new PnLLedgerService();
