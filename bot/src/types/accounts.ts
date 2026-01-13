
export interface IsolatedMarketAccount {
  marketKey: string;          // e.g. "BTC_UP"
  asset: string;              // "BTC", "ETH", "SOL", "XRP"
  direction: "UP" | "DOWN";
  
  bankroll: number;           // starts at $500
  maxExposure: number;        // derived from bankroll (100% utilization allowed)
  currentExposure: number;
  
  realizedPnL: number;
  unrealizedPnL: number;
  
  isActive: boolean;
}
