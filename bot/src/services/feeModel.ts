

export interface FeeConfig {
  taker_fee_pct: number;
  maker_fee_pct: number;
  slippage_assumption_bps: number;
}

export const DEFAULT_FEE_CONFIG: FeeConfig = {
  taker_fee_pct: 0.02, // 2% Taker Fee (Standard CTF)
  maker_fee_pct: 0.00, // 0% Maker Fee (Standard CTF, sometimes rebate)
  slippage_assumption_bps: 10 // 10bps conservative slippage estimate
};

export class FeeModel {
  private config: FeeConfig;

  constructor(config: FeeConfig = DEFAULT_FEE_CONFIG) {
    this.config = config;
  }

  /**
   * Calculates Expected Value (EV) and Edge after fees and slippage.
   * 
   * @param entryProb The market price/probability at entry (0..1)
   * @param confidence The bot's estimated probability of winning (0..1)
   * @param stake The gross amount intended to bet (e.g., $10)
   * @param isMaker Whether we intend to post a Limit order (Maker) or Market (Taker)
   */
  public calculateMetrics(
      entryProb: number, 
      confidence: number, 
      stake: number, 
      isMaker: boolean = false
    ) {
    
    // 1. Fee Rate Selection
    const exchangeFeePct = isMaker ? this.config.maker_fee_pct : this.config.taker_fee_pct;
    
    // 2. Slippage (Only applies to Taker usually, but modeled for safety on both)
    const slippagePct = isMaker ? 0 : (this.config.slippage_assumption_bps / 10000);
    
    const totalCostRate = exchangeFeePct + slippagePct;

    // 3. Effective Entry Price (Price + Cost)
    // If we buy at 0.60, effectively we pay 0.60 * (1 + fee) ? 
    // Actually fee is taken from balance usually.
    // For calculation, we assume we pay `stake` and get `stake * (1-fee)` worth of shares.
    
    const netStake = stake * (1 - totalCostRate);
    const shares = netStake / entryProb;

    // 4. EV Calculation
    // Win: shares * $1.00
    // Loss: 0
    const grossPayout = shares * 1.0;
    
    // Note: Polymarket typically takes fee on Match. 
    // Some structures take redemption fees. We assume 0 redemption fee for CTF here.
    const netPayout = grossPayout; 

    // EV = (WinProb * NetPayout) - Cost
    const ev = (confidence * netPayout) - stake;
    
    // Edge = EV / Stake
    const edgePct = (ev / stake) * 100;

    return {
      feePct: exchangeFeePct,
      slippagePct,
      evUsd: ev,
      edgePct,
      // The probability at which EV is 0
      breakEvenProb: stake / (netPayout / confidence) // Approx
    };
  }
}

export const feeModel = new FeeModel();
