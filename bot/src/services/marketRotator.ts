
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
                this.logDecision('SKIPPED', 'NO_MASTER_RUN_ID');
                return;
            }

            // 2. Calculate Current Bucket (Strict Alignment)
            // bucketStart = floor(now / 15min) * 15min
            // bucketEnd = bucketStart + 15min
            const bucketDuration = 15 * 60 * 1000;
            const bucketStartMs = Math.floor(now / bucketDuration) * bucketDuration;
            const bucketEndMs = bucketStartMs + bucketDuration;
            
            const bucketStartIso = new Date(bucketStartMs).toISOString();
            const bucketEndIso = new Date(bucketEndMs).toISOString();

            // Goal 1: Verify 15-minute bucket alignment (NO off-by-one errors)
            Logger.info(`[ROTATOR_CHECK] now=${new Date(now).toISOString()} bucketStart=${bucketStartIso} bucketEnd=${bucketEndIso}`);

            // 3. Process Each Asset
            for (const asset of ENV.ROTATION_ASSETS) {
                if (this.shouldTradeBucket(asset, bucketStartMs, bucketEndMs)) {
                     await this.ensureMarketForBucket(asset, bucketEndIso, bucketStartIso);
                } else {
                     this.logDecision('SKIPPED', `BUCKET_FILTER_REJECTED_${asset}`);
                }
            }

        } catch (err) {
            Logger.error("[ROTATOR] Unexpected Error", err);
        }
    }

    private logDecision(action: string, reason: string, details?: any) {
        Logger.info(`[ROTATOR_DECISION] ${action} reason=${reason}`, details);
    }

    // Optional Hook: Future extensibility for skipping buckets (e.g. Low Volatility)
    private shouldTradeBucket(asset: string, startMs: number, endMs: number): boolean {
        return true; 
    }

    private async ensureMasterRun() {
        // Idempotent check for a run named "AUTO-ROTATION-MASTER"
        
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

    private async ensureMarketForBucket(asset: string, expiryIso: string, startIso: string) {
        // Goal 2: Safety Assertion (DRY_RUN only) - One active market per asset
        if (ENV.DRY_RUN) {
             const { data: activeMarkets } = await supabase
                .from('markets')
                .select('id, t_expiry, polymarket_market_id')
                .eq('asset', asset)
                .eq('enabled', true);
             
             if (activeMarkets && activeMarkets.length > 0) {
                 // Check if the active market is DIFFERENT from target expiry
                 const conflict = activeMarkets.find(m => m.t_expiry !== expiryIso);
                 if (conflict) {
                     Logger.warn(`[ROTATOR_SAFETY] Overlap detected! Active: ${conflict.polymarket_market_id} (${conflict.t_expiry}). Target: ${expiryIso}`);
                     this.logDecision('SKIPPED', 'SAFETY_OVERLAP_DETECTED', { asset, conflictId: conflict.id });
                     return;
                 }
             }
        }

        // 1. Check if we already have this market in DB
        // We query by t_expiry to match our bucket target
        const { data: existing } = await supabase
            .from('markets')
            .select('id, polymarket_market_id, enabled, active_run_id, t_open, t_expiry')
            .eq('asset', asset)
            .eq('t_expiry', expiryIso)
            .maybeSingle();

        if (existing) {
            // Alignment Verification
            if (existing.t_expiry !== expiryIso) {
                 // This theoretically shouldn't happen due to the query, but good for sanity
                 this.logDecision('SKIPPED', 'DB_METADATA_MISMATCH', { id: existing.id });
                 return;
            }

            // It exists. Ensure it's enabled and linked to our run.
            if (!existing.enabled || existing.active_run_id !== this.activeRunId) {
                Logger.info(`[ROTATOR] Re-enabling existing market: ${existing.polymarket_market_id}`);
                await supabase.from('markets').update({
                    enabled: true,
                    active_run_id: this.activeRunId
                }).eq('id', existing.id);
                this.logDecision('ENABLED', 'REACTIVATED_EXISTING', { slug: existing.polymarket_market_id });
            } else {
                this.logDecision('SKIPPED', 'MARKET_ALREADY_ACTIVE');
            }
            return;
        }

        // 2. Discovery Phase (If not in DB)
        Logger.info(`[ROTATOR] Discovering ${asset} market for ${expiryIso}...`);
        const marketData = await polymarket.findMarketForAssetAndExpiry(asset, expiryIso);

        if (!marketData) {
            this.logDecision('SKIPPED', 'API_DISCOVERY_FAILED', { asset, expiryIso });
            // Logger.warn(`[ROTATOR] No market found for ${asset} @ ${expiryIso}. Retrying next tick.`);
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
            this.logDecision('ENABLED', 'REGISTERED_BY_SLUG', { slug });
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
            this.logDecision('ENABLED', 'INSERTED_NEW', { slug });
        }
    }
}
