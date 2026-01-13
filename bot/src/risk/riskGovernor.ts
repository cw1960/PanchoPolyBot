
import { Market } from '../types/tables';
import { Logger } from '../utils/logger';
import { supabase } from '../services/supabase';
import { ENV } from '../config/env';

export interface TimeMetrics {
  timeRemainingMs: number;
  decayFactor: number;
  isCutoff: boolean;
}

/**
 * The Risk Governor is the final authority. 
 * It operates independently of the strategy to prevent catastrophic loss.
 * 
 * Rules:
 * 1. Global Kill Switch check
 * 2. Per-Market Hard Cap
 * 3. Global Hard Cap (Sum of all markets)
 * 4. Time-Based Exposure Decay (New)
 */
export class RiskGovernor {
  // Step 6 Constants
  public static readonly GLOBAL_MAX_EXPOSURE = 10000; // Hard limit $10,000
  public static readonly MAX_PER_MARKET = 2000;       // Hard limit $2,000 per market
  public static readonly MAX_RISK_PER_TRADE = 0.05;   // 5% of Bankroll
  public static readonly VIRTUAL_BANKROLL = 5000;     // Assumed bankroll for sizing
  
  // Time Decay Constants (15-Minute Markets)
  private readonly MARKET_DURATION_MS = 15 * 60 * 1000; // 900s
  private readonly ENTRY_CUTOFF_MS = 3 * 60 * 1000;     // 180s (Hard Stop)

  /**
   * PURE FUNCTION: Calculates decay metrics based on expiry time.
   * decayFactor = Linear 1.0 -> 0.0 over 15 minutes.
   */
  public calculateTimeMetrics(expiryIso?: string): TimeMetrics {
      if (!expiryIso) {
          // If no expiry is known, we assume full risk is allowed (early lifecycle)
          // or block it. EdgeEngine handles hydration, so this is a fallback.
          return { timeRemainingMs: this.MARKET_DURATION_MS, decayFactor: 1.0, isCutoff: false };
      }

      const now = Date.now();
      const expiry = new Date(expiryIso).getTime();
      const timeRemainingMs = Math.max(0, expiry - now);

      // 1. Hard Cutoff Check
      const isCutoff = timeRemainingMs <= this.ENTRY_CUTOFF_MS;

      // 2. Linear Decay Calculation
      // Clamp between 0 and 1
      const rawRatio = timeRemainingMs / this.MARKET_DURATION_MS;
      const decayFactor = Math.max(0, Math.min(1, rawRatio));

      return { timeRemainingMs, decayFactor, isCutoff };
  }

  /**
   * Helper to reduce trade size based on time remaining.
   * Logic: effectiveSize = baseSize * decayFactor
   */
  public applySizeDecay(baseSize: number, expiryIso?: string): number {
      const { decayFactor } = this.calculateTimeMetrics(expiryIso);
      return baseSize * decayFactor;
  }

  /**
   * Checks if a trade is safe to execute.
   * @param market The market config
   * @param amountUSDC The size of the proposed bet
   * @param currentExposure The current exposure in this market
   */
  public async requestApproval(market: Market, amountUSDC: number, currentExposure: number): Promise<boolean> {
    
    // 1. Check Global Kill Switch (Live DB Check)
    const { data: control, error } = await supabase.from('bot_control').select('desired_state').eq('id', 1).single();
    
    if (error || control?.desired_state !== 'running') {
      Logger.warn(`[RISK] VETO: Global Kill Switch is ACTIVE (State: ${control?.desired_state})`);
      return false;
    }

    // 2. TIME-BASED RISK CONTROLS (Run in DRY_RUN too for simulation accuracy)
    const { isCutoff, decayFactor, timeRemainingMs } = this.calculateTimeMetrics(market.t_expiry);

    // A. Hard Time Cutoff
    if (isCutoff) {
        Logger.warn(`[RISK] VETO: Entry Cutoff Active. Time Remaining: ${(timeRemainingMs/1000).toFixed(0)}s < 180s`);
        return false;
    }

    // B. Decayed Max Exposure
    // As time -> 0, Allowed Exposure -> 0.
    // This forces the bot to stop adding risk and only hold or exit.
    const dynamicMaxExposure = market.max_exposure * decayFactor;
    
    if (currentExposure + amountUSDC > dynamicMaxExposure) {
        Logger.warn(`[RISK] VETO: Decayed Exposure Limit Hit.`, {
            current: currentExposure,
            add: amountUSDC,
            limit: dynamicMaxExposure.toFixed(2),
            decayFactor: decayFactor.toFixed(2)
        });
        return false;
    }

    // 3. DRY RUN: Bypass Global Caps (But keep time logic above for realism)
    if (ENV.DRY_RUN) {
      return true;
    }

    // ---------------------------------------------------------
    // LIVE MODE CHECKS BELOW
    // ---------------------------------------------------------

    // 4. Check Market Hard Cap
    if (currentExposure + amountUSDC > RiskGovernor.MAX_PER_MARKET) {
      Logger.warn(`[RISK] VETO: Hard Cap Reached ($${RiskGovernor.MAX_PER_MARKET}) for ${market.polymarket_market_id}.`);
      return false;
    }

    // 5. Check Global Exposure (Strict Scoping)
    const { data: enabledMarkets } = await supabase
        .from('markets')
        .select('id, polymarket_market_id, active_run_id')
        .eq('enabled', true);
        
    if (!enabledMarkets) {
        Logger.warn("[RISK] Could not fetch enabled markets. Defaulting to Reject.");
        return false;
    }

    const marketIds = enabledMarkets.map(m => m.id);

    const { data: activeStates, error: stateError } = await supabase
        .from('market_state')
        .select('market_id, exposure, run_id')
        .in('market_id', marketIds);
    
    if (stateError || !activeStates) {
      Logger.error("[RISK] FAILED to fetch global exposure. Defaulting to REJECT.", stateError);
      return false;
    }

    let currentGlobalExposure = 0;
    const debugContributors: any[] = [];

    for (const state of activeStates) {
        const marketConfig = enabledMarkets.find(m => m.id === state.market_id);
        
        // Strict Scope Check: The state row must belong to the currently active run for this market
        if (marketConfig && marketConfig.active_run_id && state.run_id === marketConfig.active_run_id) {
            const exp = state.exposure || 0;
            currentGlobalExposure += exp;
            
            // Collect debug info for logs if we hit the cap
            debugContributors.push({ 
                slug: marketConfig.polymarket_market_id.substring(0, 15) + '...', 
                run: state.run_id.split('-')[0], 
                exp 
            });
        }
    }
    
    // Check if adding the new bet would breach the Global Max
    if (currentGlobalExposure + amountUSDC > RiskGovernor.GLOBAL_MAX_EXPOSURE) {
      Logger.warn(`[RISK] GLOBAL_CAP_REACHED`, {
         mode: 'LIVE',
         currentExposure: currentGlobalExposure,
         betSize: amountUSDC,
         max: RiskGovernor.GLOBAL_MAX_EXPOSURE,
         contributors: debugContributors
      });
      return false;
    }
    
    return true;
  }

  public calculateBetSize(): number {
    const fractionalSize = RiskGovernor.VIRTUAL_BANKROLL * RiskGovernor.MAX_RISK_PER_TRADE; 
    const hardCap = 100;
    return Math.min(fractionalSize, hardCap);
  }
}

export const riskGovernor = new RiskGovernor();
