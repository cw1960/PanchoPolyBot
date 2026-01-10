import { Market } from '../types/tables';
import { Logger } from '../utils/logger';
import { supabase } from '../services/supabase';
import { ENV } from '../config/env';

/**
 * The Risk Governor is the final authority. 
 * It operates independently of the strategy to prevent catastrophic loss.
 * 
 * Rules:
 * 1. Global Kill Switch check
 * 2. Per-Market Hard Cap
 * 3. Global Hard Cap (Sum of all markets)
 */
export class RiskGovernor {
  // Step 6 Constants
  public static readonly GLOBAL_MAX_EXPOSURE = 10000; // Hard limit $10,000 (Bumped for testing)
  public static readonly MAX_PER_MARKET = 2000;       // Hard limit $2,000 per market
  public static readonly MAX_RISK_PER_TRADE = 0.05;   // 5% of Bankroll
  public static readonly VIRTUAL_BANKROLL = 5000;     // Assumed bankroll for sizing

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

    // 2. DRY RUN: Bypass Exposure Limits (CRITICAL FOR TESTING)
    if (ENV.DRY_RUN) {
      // We explicitly log this only once in a while or verbose to confirm it's working
      // Logger.info(`[RISK] DRY_RUN bypass active. Ignoring limits.`);
      return true;
    }

    // 3. Check Market Hard Cap
    if (currentExposure + amountUSDC > RiskGovernor.MAX_PER_MARKET) {
      Logger.warn(`[RISK] VETO: Hard Cap Reached ($${RiskGovernor.MAX_PER_MARKET}) for ${market.polymarket_market_id}.`);
      return false;
    }

    // 4. Check Configured Market Exposure Limit
    if (currentExposure + amountUSDC > market.max_exposure) {
      Logger.warn(`[RISK] VETO: User Budget Limit Reached ($${market.max_exposure}).`);
      return false;
    }

    // 5. Check Global Exposure (Strict Scoping)
    const { data: enabledMarkets } = await supabase
        .from('markets')
        .select('id, active_run_id')
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

    for (const state of activeStates) {
        const marketConfig = enabledMarkets.find(m => m.id === state.market_id);
        if (marketConfig && marketConfig.active_run_id && state.run_id === marketConfig.active_run_id) {
            currentGlobalExposure += (state.exposure || 0);
        }
    }
    
    // Check if adding the new bet would breach the Global Max
    if (currentGlobalExposure + amountUSDC > RiskGovernor.GLOBAL_MAX_EXPOSURE) {
      Logger.warn(`[RISK] GLOBAL_CAP_REACHED: Current $${currentGlobalExposure} + Bet $${amountUSDC} > Max $${RiskGovernor.GLOBAL_MAX_EXPOSURE}`);
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