
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
        for (const trade of trades) {
            let currentPrice = currentPriceYes;
            
            // If we hold 'NO', the price is (1 - YES)
            if (trade.side === 'NO') {
                currentPrice = 1 - currentPriceYes;
            }

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

    /**
     * Settles all OPEN trades for a market upon expiration (DRY_RUN).
     * Calculates final Realized PnL based on the settlement price.
     * IDEMPOTENT: Only affects trades with status='OPEN'.
     */
    public async settleMarket(marketId: string, runId: string, finalPriceYes: number, source: string = 'UNKNOWN') {
        // 1. Fetch OPEN trades
        const { data: trades, error } = await supabase
            .from('trade_ledger')
            .select('*')
            .eq('run_id', runId)
            .eq('market_id', marketId)
            .eq('status', 'OPEN');

        if (error) {
            Logger.error(`[PNL] Settlement fetch failed for ${marketId}`, error);
            return;
        }

        if (!trades || trades.length === 0) {
            // No open trades to settle. This is fine/expected on subsequent calls.
            return;
        }

        Logger.info(`[PNL_SETTLE] Closing ${trades.length} trades. Market=${marketId} Price=${finalPriceYes.toFixed(3)} Source=${source}`);

        // 2. Close each trade
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
                .eq('status', 'OPEN'); // Double-check safety
        }
    }
}

export const pnlLedger = new PnLLedgerService();
