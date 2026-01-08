import { Market } from '../types/tables';
import { Logger } from '../utils/logger';
import { supabase } from '../services/supabase';

/**
 * The Risk Governor is the final authority. 
 * It operates independently of the strategy to prevent catastrophic loss.
 */
export class RiskGovernor {
  private static GLOBAL_MAX_EXPOSURE = 500; // Hard limit $500 total risk
  private static MAX_PER_MARKET = 100;      // Hard limit $100 per market

  /**
   * Checks if a trade is safe to execute.
   * @param market The market config
   * @param amountUSDC The size of the proposed bet
   * @param currentExposure The current exposure in this market (from DB/State)
   */
  public async requestApproval(market: Market, amountUSDC: number, currentExposure: number): Promise<boolean> {
    
    // 1. Check Market Limits
    if (currentExposure + amountUSDC > market.max_exposure) {
      Logger.warn(`[RISK] Rejected: Market limit reached. (${currentExposure} + ${amountUSDC} > ${market.max_exposure})`);
      return false;
    }

    if (currentExposure + amountUSDC > RiskGovernor.MAX_PER_MARKET) {
      Logger.warn(`[RISK] Rejected: Hard cap per market reached.`);
      return false;
    }

    // 2. Check Global Kill Switch (Live DB Check)
    const { data: control } = await supabase.from('bot_control').select('desired_state').eq('id', 1).single();
    if (control?.desired_state !== 'running') {
      Logger.warn(`[RISK] Rejected: Global Kill Switch is ACTIVE.`);
      return false;
    }

    // 3. (Optional) Global Exposure Check could go here by summing all market_states
    
    return true;
  }
}

export const riskGovernor = new RiskGovernor();
