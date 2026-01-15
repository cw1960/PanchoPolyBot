import { supabase } from './supabase';
import { Logger } from '../utils/logger';
import { autoDiscovery } from './autoDiscovery';

/**
 * MarketRotator (Single Market Edition)
 * 
 * Responsibilities:
 * 1. Polls for the current best BTC 15m market.
 * 2. Ensures that specific market is in the DB and ENABLED.
 * 3. Disables ALL other markets.
 */
export class MarketRotator {
    private lastCheckTime: number = 0;
    private readonly CHECK_INTERVAL_MS = 10000; // Check every 10s
    private currentSlug: string | null = null;

    public async ensureCurrentMarket() {
        const now = Date.now();
        if (now - this.lastCheckTime < this.CHECK_INTERVAL_MS) return;
        this.lastCheckTime = now;

        try {
            // 1. Ensure Global Config Run exists
            await this.ensureGlobalConfigRun();

            // 2. Discover the target market
            const target = await autoDiscovery.findCurrentBtc15mMarket();
            
            if (!target) {
                // No valid market found (maybe API down or gap in schedule)
                return;
            }

            // 3. Optimization: If we are already locked onto this market, skip DB writes
            if (this.currentSlug === target.slug) {
                // Double check it's enabled in DB just in case manual interference happened
                // (Skipping for performance, relying on ControlLoop to fetch)
                return;
            }

            Logger.info(`[ROTATOR] Rotation Event. New Target: ${target.slug}`);

            // 4. ATOMIC SWAP: Enable Target, Disable Others
            
            // A. Check if target exists in DB
            const { data: existing } = await supabase
                .from('markets')
                .select('id')
                .eq('polymarket_market_id', target.slug)
                .maybeSingle();

            let targetId = existing?.id;

            if (!targetId) {
                // Insert new
                const { data: inserted } = await supabase.from('markets').insert({
                    polymarket_market_id: target.slug,
                    asset: 'BTC',
                    direction: 'UP', // Direction is irrelevant for 15m logic now (handled by Edge), but DB requires constraint
                    enabled: true,
                    max_exposure: 500, // Default, will be clamped by RiskGovernor
                    t_open: target.startDate,
                    t_expiry: target.endDate,
                    baseline_price: 0 // EdgeEngine will hydrate
                }).select('id').single();
                targetId = inserted?.id;
            } else {
                // Enable existing
                await supabase.from('markets').update({
                    enabled: true,
                    t_expiry: target.endDate // Ensure fresh time
                }).eq('id', targetId);
            }

            // B. Disable ALL other markets
            if (targetId) {
                await supabase.from('markets')
                    .update({ enabled: false })
                    .neq('id', targetId);
                
                this.currentSlug = target.slug;
                Logger.info(`[ROTATOR] Switched active market to ${target.slug}`);
            }

        } catch (err) {
            Logger.error("[ROTATOR] Error", err);
        }
    }

    private async ensureGlobalConfigRun() {
        // Ensure the "AUTO_TRADER_GLOBAL_CONFIG" run exists.
        // The UI will update this row to change parameters dynamically.
        const { data } = await supabase
            .from('test_runs')
            .select('id')
            .eq('name', 'AUTO_TRADER_GLOBAL_CONFIG')
            .maybeSingle();

        if (!data) {
             await supabase.from('test_runs').insert({
                 name: 'AUTO_TRADER_GLOBAL_CONFIG',
                 status: 'RUNNING',
                 hypothesis: 'Persistent Global Configuration',
                 start_at: new Date().toISOString(),
                 params: {
                     direction: 'BOTH',
                     tradeSize: 10,
                     maxExposure: 100,
                     confidenceThreshold: 0.60
                 }
             });
             Logger.info("[ROTATOR] Created Global Config Run");
        }
    }
}

export const marketRotator = new MarketRotator();
