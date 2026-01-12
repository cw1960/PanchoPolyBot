
import { supabase } from './supabase';
import { Logger } from '../utils/logger';
import { polymarket } from './polymarket';
import { ENV } from '../config/env';

/**
 * MarketRotator
 * 
 * Responsibilities:
 * 1. Identify the current 15-minute time bucket (e.g., 12:00-12:15).
 * 2. Discover the corresponding Polymarket market for target assets (BTC, ETH).
 * 3. Ensure the market is registered in the DB and ENABLED.
 * 4. Ensure a continuous "Auto-Rotation" test run is active.
 * 
 * It DOES NOT trade. It only sets the stage for the MarketLoop.
 */
export class MarketRotator {
    private lastCheckTime: number = 0;
    private readonly CHECK_INTERVAL_MS = 15000; // Check every 15s
    private activeRunId: string | null = null;

    public async tick() {
        if (!ENV.AUTO_ROTATION) return;
        
        const now = Date.now();
        if (now - this.lastCheckTime < this.CHECK_INTERVAL_MS) return;
        this.lastCheckTime = now;

        try {
            // 1. Ensure Master Run Exists
            await this.ensureMasterRun();
            if (!this.activeRunId) {
                Logger.warn("[ROTATOR] Skipping tick - Could not establish Master Run ID.");
                return;
            }

            // 2. Calculate Current Bucket
            // A 15m market expiring at 12:15 covers 12:00-12:15.
            // If it is 12:01, we want the market expiring at 12:15.
            // If it is 12:14, we want the market expiring at 12:15.
            // Formula: Next quarter hour.
            const bucketDuration = 15 * 60 * 1000;
            const nextExpiryMs = Math.ceil(now / bucketDuration) * bucketDuration;
            const nextExpiryIso = new Date(nextExpiryMs).toISOString();

            Logger.info(`[ROTATOR] Tick. Target Bucket Expiry: ${nextExpiryIso}`);

            // 3. Process Each Asset
            for (const asset of ENV.ROTATION_ASSETS) {
                await this.ensureMarketForBucket(asset, nextExpiryIso);
            }

        } catch (err) {
            Logger.error("[ROTATOR] Unexpected Error", err);
        }
    }

    private async ensureMasterRun() {
        // Idempotent check for a run named "AUTO-ROTATION-MASTER"
        // If it exists and is COMPLETED, we restart it? 
        // Prompt says "One continuous DRY_RUN".
        
        // 1. Check local cache first
        if (this.activeRunId) return;

        // 2. Find existing active master run
        const { data: existing } = await supabase
            .from('test_runs')
            .select('id')
            .eq('name', 'AUTO-ROTATION-MASTER')
            .eq('status', 'RUNNING')
            .maybeSingle();
        
        if (existing) {
            this.activeRunId = existing.id;
            return;
        }

        // 3. Create if missing
        Logger.info("[ROTATOR] Creating new AUTO-ROTATION-MASTER run...");
        const { data: newRun, error } = await supabase.from('test_runs').insert({
            name: 'AUTO-ROTATION-MASTER',
            status: 'RUNNING',
            hypothesis: 'Continuous Auto-Rotation Service',
            start_at: new Date().toISOString(),
            params: {
                direction: 'BOTH',
                tradeSize: 10, // Default sizing, RiskGovernor overrides cap
                maxExposure: 200, // Budget per market
                confidenceThreshold: 0.60
            }
        }).select('id').single();

        if (error || !newRun) {
            Logger.error("[ROTATOR] Failed to create Master Run", error);
            return;
        }

        this.activeRunId = newRun.id;
        Logger.info(`[ROTATOR] Master Run Established: ${this.activeRunId}`);
    }

    private async ensureMarketForBucket(asset: string, expiryIso: string) {
        // 1. Check if we already have this market in DB
        // We query by t_expiry to match our bucket target
        const { data: existing } = await supabase
            .from('markets')
            .select('id, polymarket_market_id, enabled, active_run_id')
            .eq('asset', asset)
            .eq('t_expiry', expiryIso)
            .maybeSingle();

        if (existing) {
            // It exists. Ensure it's enabled and linked to our run.
            if (!existing.enabled || existing.active_run_id !== this.activeRunId) {
                Logger.info(`[ROTATOR] Re-enabling existing market: ${existing.polymarket_market_id}`);
                await supabase.from('markets').update({
                    enabled: true,
                    active_run_id: this.activeRunId
                }).eq('id', existing.id);
            } else {
                // Already running fine
                // Logger.info(`[ROTATOR] Market active: ${existing.polymarket_market_id}`);
            }
            return;
        }

        // 2. Discovery Phase (If not in DB)
        Logger.info(`[ROTATOR] Discovering ${asset} market for ${expiryIso}...`);
        const marketData = await polymarket.findMarketForAssetAndExpiry(asset, expiryIso);

        if (!marketData) {
            Logger.warn(`[ROTATOR] No market found for ${asset} @ ${expiryIso}. Retrying next tick.`);
            return;
        }

        // 3. Registration Phase
        const slug = marketData.slug;
        Logger.info(`[ROTATOR] Found new market: ${slug}. Registering...`);

        // We check slug existence just in case t_expiry query missed it (e.g. slight time drift on insert)
        const { data: slugCheck } = await supabase
            .from('markets')
            .select('id')
            .eq('polymarket_market_id', slug)
            .maybeSingle();

        if (slugCheck) {
            // Just update metadata
             await supabase.from('markets').update({
                enabled: true,
                active_run_id: this.activeRunId,
                t_expiry: marketData.endDate,
                t_open: marketData.startDate,
                asset: asset
            }).eq('id', slugCheck.id);
        } else {
            // Insert new
            await supabase.from('markets').insert({
                polymarket_market_id: slug,
                asset: asset,
                direction: 'UP', // Default
                enabled: true,
                max_exposure: 200, // Default budget
                active_run_id: this.activeRunId,
                t_open: marketData.startDate,
                t_expiry: marketData.endDate,
                baseline_price: 0 // Will be hydrated by EdgeEngine
            });
        }
    }
}
