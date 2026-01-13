
import { Market } from '../types/tables';
import { Logger } from '../utils/logger';
import { supabase } from '../services/supabase';
import { ENV } from '../config/env';
import { IsolatedMarketAccount } from '../types/accounts';

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
 * 2. Per-Account Bankroll Check (Isolated)
 * 3. Per-Account Max Exposure Check (Isolated)
 * 4. Time-Based Exposure Decay
 */
export class RiskGovernor {
  
  // Time Decay Constants (15-Minute Markets)
  private readonly MARKET_DURATION_MS = 15 * 60 * 1000; // 900s
  private readonly ENTRY_CUTOFF_MS = 3 * 60 * 1000;     // 180s (Hard Stop)
  private readonly MAX_RISK_PER_TRADE = 0.05;           // 5% of Account Bankroll

  /**
   * PURE FUNCTION: Calculates decay metrics based on expiry time.
   */
  public calculateTimeMetrics(expiryIso?: string): TimeMetrics {
      if (!expiryIso) {
          return { timeRemainingMs: this.MARKET_DURATION_MS, decayFactor: 1.0, isCutoff: false };
      }

      const now = Date.now();
      const expiry = new Date(expiryIso).getTime();
      const timeRemainingMs = Math.max(0, expiry - now);

      const isCutoff = timeRemainingMs <= this.ENTRY_CUTOFF_MS;

      const rawRatio = timeRemainingMs / this.MARKET_DURATION_MS;
      const decayFactor = Math.max(0, Math.min(1, rawRatio));

      return { timeRemainingMs, decayFactor, isCutoff };
  }

  /**
   * Helper to reduce trade size based on time remaining.
   */
  public applySizeDecay(baseSize: number, expiryIso?: string): number {
      const { decayFactor } = this.calculateTimeMetrics(expiryIso);
      return baseSize * decayFactor;
  }

  /**
   * Checks if a trade is safe to execute within the context of an Isolated Market Account.
   */
  public async requestApproval(
      market: Market, 
      account: IsolatedMarketAccount, // REQUIRED: Context
      amountUSDC: number
    ): Promise<boolean> {
    
    // 1. Check Global Kill Switch (Live DB Check)
    const { data: control, error } = await supabase.from('bot_control').select('desired_state').eq('id', 1).single();
    
    if (error || control?.desired_state !== 'running') {
      Logger.warn(`[RISK] VETO: Global Kill Switch is ACTIVE (State: ${control?.desired_state})`);
      return false;
    }

    // 2. TIME-BASED RISK CONTROLS
    const { isCutoff, decayFactor, timeRemainingMs } = this.calculateTimeMetrics(market.t_expiry);

    if (isCutoff) {
        Logger.warn(`[RISK] VETO: Entry Cutoff Active. Time Remaining: ${(timeRemainingMs/1000).toFixed(0)}s`);
        return false;
    }

    // 3. ISOLATED ACCOUNT CHECKS
    
    // A. Bankroll Solvency
    // Cannot bet more than current bankroll
    if (amountUSDC > account.bankroll) {
         Logger.warn(`[RISK] VETO: Insufficient Bankroll in ${account.marketKey}. Need $${amountUSDC}, Have $${account.bankroll}`);
         return false;
    }

    // B. Decayed Max Exposure (Per Account)
    const dynamicMaxExposure = account.maxExposure * decayFactor;
    
    // Check if adding this bet exceeds the dynamic max exposure for this SPECIFIC account
    if (account.currentExposure + amountUSDC > dynamicMaxExposure) {
        Logger.warn(`[RISK] VETO: Account Exposure Limit Hit for ${account.marketKey}`, {
            current: account.currentExposure,
            add: amountUSDC,
            limit: dynamicMaxExposure.toFixed(2),
            decayFactor: decayFactor.toFixed(2)
        });
        return false;
    }

    return true;
  }

  /**
   * Calculates safe bet size based on the specific account's bankroll.
   */
  public calculateBetSize(account: IsolatedMarketAccount): number {
    const fractionalSize = account.bankroll * this.MAX_RISK_PER_TRADE; 
    const hardCap = 100; // Absolute max per clip regardless of bankroll size
    return Math.min(fractionalSize, hardCap);
  }
}

export const riskGovernor = new RiskGovernor();
