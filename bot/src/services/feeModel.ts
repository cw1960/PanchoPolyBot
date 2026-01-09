
export interface FeeConfig {
  buy_fee_peak_pct: number;
  buy_fee_peak_at_prob: number;
  sell_fee_peak_pct: number;
  sell_fee_peak_at_prob: number;
  min_fee_pct: number;
  shape_exponent: number;
}

export const DEFAULT_FEE_CONFIG: FeeConfig = {
  buy_fee_peak_pct: 0.016, // 1.6%
  buy_fee_peak_at_prob: 0.50,
  sell_fee_peak_pct: 0.037, // 3.7%
  sell_fee_peak_at_prob: 0.30,
  min_fee_pct: 0.002,      // 0.2%
  shape_exponent: 2.0
};

export class FeeModel {
  private config: FeeConfig;

  constructor(config: FeeConfig = DEFAULT_FEE_CONFIG) {
    this.config = config;
  }

  public updateConfig(newConfig: Partial<FeeConfig>) {
    this.config = { ...this.config, ...newConfig };
  }

  public getConfig(): FeeConfig {
    return this.config;
  }

  /**
   * Calculates the fee percentage based on the parametric bell-curve approximation.
   * 
   * Formula:
   * dist = abs(prob - peak_at)
   * normalized = min(1, dist / 0.5)
   * fee = min + (peak - min) * (1 - normalized^exponent)
   */
  public getFeePct(prob: number, isBuy: boolean): number {
    const peak = isBuy ? this.config.buy_fee_peak_pct : this.config.sell_fee_peak_pct;
    const peakAt = isBuy ? this.config.buy_fee_peak_at_prob : this.config.sell_fee_peak_at_prob;
    const min = this.config.min_fee_pct;
    const exponent = this.config.shape_exponent;

    // Distance from the peak probability (0.0 to 1.0 range usually)
    const dist = Math.abs(prob - peakAt);
    
    // Normalize distance. We assume the curve spans roughly 0.5 distance from peak.
    // If dist >= 0.5, we are at the floor.
    const normalizedDist = Math.min(1, dist / 0.5);

    // Calculate curve factor (1 at peak, 0 at floor)
    const curveFactor = 1 - Math.pow(normalizedDist, exponent);

    // Interpolate
    const fee = min + (peak - min) * curveFactor;

    // Clamp for safety
    return Math.max(min, Math.min(peak, fee));
  }

  /**
   * Calculates Expected Value (EV) and Edge after estimated fees.
   * 
   * @param entryProb The market price/probability at entry (0..1)
   * @param confidence The bot's estimated probability of winning (0..1)
   * @param stake The gross amount intended to bet (e.g., $10)
   */
  public calculateMetrics(entryProb: number, confidence: number, stake: number) {
    const buyFeePct = this.getFeePct(entryProb, true);
    // We assume exit probability is roughly entry probability for the sake of strict fee estimation 
    // unless a specific target is known. For "Edge", we often assume we hold to expiry or sell at similar levels.
    // Using entryProb for sell fee estimation is a safe conservative proxy for now.
    const sellFeePct = this.getFeePct(entryProb, false);

    // 1. Cost Paid = Stake
    const costPaid = stake;

    // 2. Net Effective Stake (amount that actually buys shares)
    // "Buy fee reduces effective stake"
    const stakeNet = stake * (1 - buyFeePct);

    // 3. Shares bought
    const shares = stakeNet / entryProb;

    // 4. Gross Payout if Win
    const grossPayout = shares * 1.0; // Pays out $1 per share

    // 5. Net Payout after Sell Fee (simulating exit cost or settlement fee friction)
    const netPayoutWin = grossPayout * (1 - sellFeePct);

    // 6. EV Calculation
    // EV = (ProbWin * PayoutWin) + (ProbLoss * PayoutLoss) - Cost
    // PayoutLoss is 0.
    const expectedReturn = confidence * netPayoutWin;
    const ev = expectedReturn - costPaid;

    // 7. Edge %
    // Edge = EV / Cost
    const edgePct = (ev / costPaid) * 100;

    return {
      buyFeePct,
      sellFeePct,
      evUsd: ev,
      edgePct,
      breakEvenProb: costPaid / (1 * (1 - buyFeePct) * (1 - sellFeePct)) // Approx BE
    };
  }
}

export const feeModel = new FeeModel();
