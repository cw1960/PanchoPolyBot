
import { Market } from '../types/tables';
import { Logger } from '../utils/logger';
import { supabase } from '../services/supabase';

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
  public static readonly GLOBAL_MAX_EXPOSURE = 500; // Hard limit $500 total risk across all markets
  public static readonly MAX_PER_MARKET = 50;       // Hard limit $50 per market
  public static readonly MAX_RISK_PER_TRADE = 0.01; // 1% of Bankroll
  public static readonly VIRTUAL_BANKROLL = 1000;   // Assumed bankroll for sizing

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

    // 2. Check Market Hard Cap
    if (currentExposure + amountUSDC > RiskGovernor.MAX_PER_MARKET) {
      Logger.warn(`[RISK] VETO: Market Cap Reached for ${market.polymarket_market_id}.`);
      return false;
    }

    // 3. Check Configured Market Exposure Limit
    if (currentExposure + amountUSDC > market.max_exposure) {
      Logger.warn(`[RISK] VETO: User Exposure Limit Reached.`);
      return false;
    }

    // 4. Check Global Exposure (Strict Scoping)
    // FIX: Only sum exposure for ENABLED markets in their ACTIVE run.
    
    const { data: enabledMarkets } = await supabase
        .from('markets')
        .select('id, active_run_id')
        .eq('enabled', true);
        
    if (!enabledMarkets) {
        Logger.warn("[RISK] Could not fetch enabled markets. Defaulting to Reject.");
        return false;
    }

    // Extract relevant IDs
    const marketIds = enabledMarkets.map(m => m.id);

    // Fetch states for these markets
    const { data: activeStates, error: stateError } = await supabase
        .from('market_state')
        .select('market_id, exposure, run_id') // Fetch run_id to verify scope
        .in('market_id', marketIds);
    
    if (stateError || !activeStates) {
      Logger.error("[RISK] FAILED to fetch global exposure. Defaulting to REJECT.", stateError);
      return false;
    }

    // Sum exposure ONLY where the state's run_id matches the market's active_run_id
    let currentGlobalExposure = 0;

    for (const state of activeStates) {
        const marketConfig = enabledMarkets.find(m => m.id === state.market_id);
        
        // Strict Scope Check: The state row must belong to the currently active run for this market
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

  /**
   * Calculates safe bet size based on "Fixed Fraction + Hard Cap" rule.
   */
  public calculateBetSize(): number {
    const fractionalSize = RiskGovernor.VIRTUAL_BANKROLL * RiskGovernor.MAX_RISK_PER_TRADE; // $1000 * 0.01 = $10
    const hardCap = 20; // Individual trade cap
    
    return Math.min(fractionalSize, hardCap);
  }
}

export const riskGovernor = new RiskGovernor();
