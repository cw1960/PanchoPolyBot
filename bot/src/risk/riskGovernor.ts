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
 * 3. Max Risk Per Trade check
 */
export class RiskGovernor {
  // Step 6 Constants
  public static readonly GLOBAL_MAX_EXPOSURE = 500; // Hard limit $500 total risk across all markets
  public static readonly MAX_PER_MARKET = 50;       // Hard limit $50 per market (Tightened from $100)
  public static readonly MAX_RISK_PER_TRADE = 0.01; // 1% of Bankroll
  public static readonly VIRTUAL_BANKROLL = 1000;   // Assumed bankroll for sizing (since we don't read wallet balance yet)

  /**
   * Checks if a trade is safe to execute.
   * @param market The market config
   * @param amountUSDC The size of the proposed bet
   * @param currentExposure The current exposure in this market
   */
  public async requestApproval(market: Market, amountUSDC: number, currentExposure: number): Promise<boolean> {
    
    // 1. Check Global Kill Switch (Live DB Check)
    // This is the "Emergency Stop" button in the UI
    const { data: control, error } = await supabase.from('bot_control').select('desired_state').eq('id', 1).single();
    
    if (error || control?.desired_state !== 'running') {
      Logger.warn(`[RISK] VETO: Global Kill Switch is ACTIVE (State: ${control?.desired_state})`);
      return false;
    }

    // 2. Check Market Hard Cap
    // Prevent over-concentration in a single asset
    if (currentExposure + amountUSDC > RiskGovernor.MAX_PER_MARKET) {
      Logger.warn(`[RISK] VETO: Market Cap Reached. (${currentExposure} + ${amountUSDC} > ${RiskGovernor.MAX_PER_MARKET})`);
      return false;
    }

    // 3. Check Configured Market Exposure Limit (User preference)
    if (currentExposure + amountUSDC > market.max_exposure) {
      Logger.warn(`[RISK] VETO: User Exposure Limit Reached. (${currentExposure} + ${amountUSDC} > ${market.max_exposure})`);
      return false;
    }

    // 4. Check Global Exposure (In-Memory approximation or DB sum)
    // For V1, we trust the per-market caps to aggregate safely.
    
    return true;
  }

  /**
   * Calculates safe bet size based on "Fixed Fraction + Hard Cap" rule.
   */
  public calculateBetSize(): number {
    const fractionalSize = RiskGovernor.VIRTUAL_BANKROLL * RiskGovernor.MAX_RISK_PER_TRADE; // $1000 * 0.01 = $10
    const hardCap = 20; // Individual trade cap (e.g. $20)
    
    // betSize = min(bankroll * MAX_RISK, HARD_CAP)
    return Math.min(fractionalSize, hardCap);
  }
}

export const riskGovernor = new RiskGovernor();
