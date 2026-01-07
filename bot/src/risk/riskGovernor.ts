/**
 * risk/riskGovernor.ts
 * 
 * Responsibilities:
 * 1. The "Veto" power. It must approve EVERY trade before execution.
 * 2. Track global exposure (Total $ at risk across all markets).
 * 3. Enforce the "Kill Switch" (Stop all trading immediately).
 * 
 * CRITICAL: This module operates independently of the strategy.
 */

import { RiskConfig } from '../types';

export class RiskGovernor {
  private currentExposure: number = 0;
  private config: RiskConfig;

  constructor(config: RiskConfig) {
    this.config = config;
  }

  public requestTradeApproval(amount: number): boolean {
    if (this.config.killSwitch) {
      console.warn("Trade rejected: Kill Switch is ACTIVE.");
      return false;
    }

    if (this.currentExposure + amount > this.config.globalMaxExposure) {
      console.warn("Trade rejected: Global Exposure Limit Exceeded.");
      return false;
    }

    return true;
  }
}
