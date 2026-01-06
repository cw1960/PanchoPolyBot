export interface PricePoint {
  timestamp: number;
  sourcePrice: number; // e.g., Binance BTC
  targetPrice: number; // e.g., Polymarket Implied Probability converted to Price
  delta: number;
}

export interface TradeLog {
  id: string;
  timestamp: number;
  type: 'BUY_YES' | 'BUY_NO' | 'BUY_UP' | 'BUY_DOWN';
  asset: string;
  entryPrice: number;
  marketPrice: number; // The leading indicator price at time of trade
  amount: number;
  status: 'OPEN' | 'WON' | 'LOST';
  profit?: number;
}

export interface BotConfig {
  sourceExchange: 'Binance' | 'Coinbase';
  targetMarket: string;
  triggerThreshold: number; // % deviation to trigger trade
  betSize: number;
  maxDailyLoss: number;
  latencyBufferMs: number;
}

export enum AppState {
  PLANNING = 'PLANNING',
  DASHBOARD = 'DASHBOARD'
}
