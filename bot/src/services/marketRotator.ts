
import axios from 'axios';
import { supabase } from './supabase';
import { Logger } from '../utils/logger';

/**
 * MarketRotator
 * 
 * Responsibilities:
 * 1. Query Gamma API for LIVE BTC 15-minute markets.
 * 2. Select the best candidate (nearest future expiry).
 * 3. Update Supabase: Enable target, Disable others.
 */

// Internal throttle state
let lastCheckTime = 0;
const CHECK_INTERVAL_MS = 30000; // 30 seconds

export async function ensureLiveBtc15mMarket(): Promise<void> {
    const now = Date.now();
    if (now - lastCheckTime < CHECK_INTERVAL_MS) return;
    lastCheckTime = now;

    try {
        // 1. Query Gamma Markets
        // We look for active, open markets matching the 15m pattern.
        // Using the 'markets' endpoint as requested, which returns individual market objects.
        // We fetch a batch to ensure we catch the right one.
        const url = "https://gamma-api.polymarket.com/markets";
        const params = {
            active: true,
            closed: false,
            limit: 20,
            order: "endDate",
            ascending: true,
            // "Bitcoin Up or Down" is the standard naming convention for 15m markets
            query: "Bitcoin Up or Down" 
        };

        const { data } = await axios.get(url, { params, timeout: 5000 });

        if (!Array.isArray(data)) {
            Logger.warn("[ROTATOR] Unexpected API response format");
            return;
        }

        // 2. Filter Candidates
        const candidates = data.filter((m: any) => {
            // A. Basic Existence Checks
            if (!m.slug || !m.endDate) return false;

            // B. Slug Pattern Check
            // Prompt asked for 'btc-updown-15m-' but Live API uses 'bitcoin-up-or-down-'
            // We check for both to ensure robust operation in Live & Paper modes.
            const slug = m.slug.toLowerCase();
            const validPattern = slug.includes("bitcoin-up-or-down") || slug.includes("btc-updown");
            if (!validPattern) return false;

            // C. Expiry Check (Must be in future)
            const endMs = new Date(m.endDate).getTime();
            if (endMs <= now) return false;

            // D. Operational Check
            if (m.acceptingOrders === false) return false;

            return true;
        });

        if (candidates.length === 0) {
            Logger.warn("[ROTATOR] No active BTC 15m markets found.");
            return;
        }

        // 3. Sort by Expiry (Soonest First)
        // (API sort param helps, but we enforce strictly here)
        candidates.sort((a: any, b: any) => 
            new Date(a.endDate).getTime() - new Date(b.endDate).getTime()
        );

        // Pick the best one
        const target = candidates[0];
        const targetSlug = target.slug;
        const targetExpiry = target.endDate;

        // 4. Upsert Target into Supabase
        // First, check if it exists to get ID
        const { data: existing } = await supabase
            .from('markets')
            .select('id')
            .eq('polymarket_market_id', targetSlug)
            .maybeSingle();

        let targetId = existing?.id;

        if (!targetId) {
            // Insert New Market
            const { data: inserted, error: insertError } = await supabase.from('markets').insert({
                polymarket_market_id: targetSlug,
                asset: 'BTC', // Derived asset
                direction: 'UP', // Default placeholder
                enabled: true,
                max_exposure: 100, // Default safe exposure
                t_open: target.startDate, // Gamma usually provides this
                t_expiry: target.endDate,
                baseline_price: 0 // Will be hydrated by EdgeEngine
            }).select('id').single();

            if (insertError) {
                Logger.error(`[ROTATOR] Failed to insert ${targetSlug}`, insertError);
                return;
            }
            targetId = inserted.id;
            Logger.info(`[ROTATOR] Discovered & Inserted: ${targetSlug} (Expires: ${targetExpiry})`);
        } else {
            // Enable Existing
            await supabase.from('markets').update({
                enabled: true,
                t_expiry: targetExpiry
            }).eq('id', targetId);
            
            // Log less frequently for existing updates, mostly just Debug level if we had one
            // Logger.info(`[ROTATOR] Confirmed Active: ${targetSlug}`);
        }

        // 5. Disable Others (Atomic Switch)
        // We disable any BTC market that is ENABLED but is NOT our target
        if (targetId) {
            const { error: disableError } = await supabase.from('markets')
                .update({ enabled: false })
                .eq('enabled', true)
                .eq('asset', 'BTC')
                .neq('id', targetId);

            if (disableError) {
                Logger.error("[ROTATOR] Failed to disable stale markets", disableError);
            } else {
                // If we want to be noisy only on changes, we could check row count, 
                // but standard operation implies we just ensure purity here.
            }
        }

    } catch (err: any) {
        Logger.error("[ROTATOR] Discovery Failed", err.message);
    }
}
