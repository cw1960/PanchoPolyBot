
import { supabase } from './supabase';
import { Logger } from '../utils/logger';
import { TradeLedgerRow } from '../types/tables';
import { accountManager } from './accountManager'; 

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
     * INVARIANT #2: Single-Shot Capital Release via Atomic DB Update
     */
    public async closePosition(runId: string, marketId: string, reason: string, details: any) {
         
         const exitTimestamp = new Date().toISOString();

         // 1. ATOMIC UPDATE: Fetch only the rows we successfully transition from OPEN -> CLOSED.
         const { data: closedTrades, error } = await supabase
            .from('trade_ledger')
            .update({
                status: 'CLOSED',
                closed_at: exitTimestamp,
                metadata: {
                    exit_reason: reason,
                    exit_details: details
                }
            })
            .eq('run_id', runId)
            .eq('market_id', marketId)
            .eq('status', 'OPEN') // Predicate: Must be OPEN
            .select();

         if (error) {
             Logger.error("[PNL_CLOSE] Atomic update failed", error);
             return;
         }

         if (!closedTrades || closedTrades.length === 0) {
             Logger.info(`[CAPITAL_RELEASE_SKIPPED_ALREADY_SETTLED] Defensive Exit for ${marketId} found 0 OPEN trades.`);
             return;
         }

         Logger.info(`[PNL_CLOSE] Atomically closed ${closedTrades.length} trades.`);

         for (const trade of closedTrades) {
             let exitPrice = trade.metadata?.last_mark_price || trade.entry_price; 
             exitPrice = exitPrice * 0.99; // Slippage penalty

             const shares = trade.size_usd / trade.entry_price;
             const finalValue = shares * exitPrice;
             const realizedPnl = finalValue - trade.size_usd;

             // Update calculated PnL values on the now-closed rows
             await supabase.from('trade_ledger').update({
                 exit_price: exitPrice,
                 realized_pnl: realizedPnl,
                 unrealized_pnl: 0,
             }).eq('id', trade.id);
            
            // CRITICAL: UPDATE ISOLATED ACCOUNT PnL
            const asset = (trade as any).markets?.asset || trade.metadata?.asset || 'BTC'; 
            const direction = trade.side === 'YES' ? 'UP' : 'DOWN';
            
            Logger.info(`[CAPITAL_RELEASED] ${asset}_${direction} | Released Exposure: $${trade.size_usd} | PnL: $${realizedPnl.toFixed(2)}`);

            // 1. Update PnL & Bankroll
            accountManager.updatePnL(asset, direction, realizedPnl);
            
            // 2. Reduce Exposure (Free up the cost basis)
            accountManager.updateExposure(asset, direction, -trade.size_usd);
         }
    }

    /**
     * Settles all OPEN trades upon expiration.
     * INVARIANT #2: Single-Shot Capital Release via Atomic DB Update
     */
    public async settleMarket(marketId: string, runId: string, finalPriceYes: number, source: string = 'UNKNOWN') {
        
        const { data: closedTrades, error } = await supabase
            .from('trade_ledger')
            .update({
                status: 'CLOSED',
                closed_at: new Date().toISOString(),
                metadata: {
                    settlement_reason: 'EXPIRY',
                    settlement_source: source,
                    final_mark_price: finalPriceYes
                }
            })
            .eq('run_id', runId)
            .eq('market_id', marketId)
            .eq('status', 'OPEN') // Predicate: Must be OPEN
            .select('*, markets(asset)'); // We need asset info

        if (error) {
             Logger.error("[PNL_SETTLE] Atomic update failed", error);
             return;
        }

        if (!closedTrades || closedTrades.length === 0) {
            Logger.info(`[CAPITAL_RELEASE_SKIPPED_ALREADY_SETTLED] Settlement for ${marketId} found 0 OPEN trades.`);
            return;
        }

        Logger.info(`[PNL_SETTLE] Closing ${closedTrades.length} trades. Market=${marketId} Price=${finalPriceYes.toFixed(3)} Source=${source}`);

        for (const trade of closedTrades) {
            let exitPrice = finalPriceYes;
            if (trade.side === 'NO') {
                exitPrice = 1 - finalPriceYes;
            }

            const shares = trade.size_usd / trade.entry_price;
            const finalValue = shares * exitPrice;
            const realizedPnl = finalValue - trade.size_usd;

            // Finalize PnL
            await supabase
                .from('trade_ledger')
                .update({
                    exit_price: exitPrice,
                    realized_pnl: realizedPnl,
                    unrealized_pnl: 0,
                })
                .eq('id', trade.id);
            
            // CRITICAL: UPDATE ISOLATED ACCOUNT PnL
            // Note: .select('*, markets(asset)') might return object structure. 
            // Supabase returns joined data as properties.
            const asset = (trade as any).markets?.asset || trade.metadata?.asset || 'BTC'; 
            const direction = trade.side === 'YES' ? 'UP' : 'DOWN';

            Logger.info(`[CAPITAL_RELEASED] ${asset}_${direction} | Released Exposure: $${trade.size_usd} | PnL: $${realizedPnl.toFixed(2)}`);

            accountManager.updatePnL(asset, direction, realizedPnl);
            accountManager.updateExposure(asset, direction, -trade.size_usd);
        }
    }
}

export const pnlLedger = new PnLLedgerService();
