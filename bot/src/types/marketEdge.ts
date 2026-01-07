export interface PriceData {
  price: number;
  timestamp: number;
  source: string;
}

export interface MarketObservation {
  chainlink: PriceData;
  spot: PriceData;
  delta: number;
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
  confidence: number; // 0.0 to 1.0
  timestamp: number;
}
