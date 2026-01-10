
export interface PriceData {
  price: number;
  timestamp: number;
  source: string;
}

export interface MarketObservation {
  chainlink: PriceData;
  spot: PriceData;
  
  // Delta is now (Spot - Baseline) for 15m markets
  delta: number;
  
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
  confidence: number; // 0.0 to 1.0 (Probabilistic)
  timestamp: number;

  // New Probabilistic Fields
  impliedProbability?: number;   // From Order Book Best Ask
  calculatedProbability?: number; // From Gaussian Model
  timeToExpiryMs?: number;       // Remaining milliseconds
  isSafeToTrade?: boolean;       // True if outside No-Trade Zone
}
