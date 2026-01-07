export interface BotControl {
  id: number;
  desired_state: 'running' | 'stopped';
  updated_at: string;
}

export interface Market {
  id: string; // UUID
  polymarket_market_id: string;
  asset: string; // 'BTC', 'ETH'
  direction: 'UP' | 'DOWN';
  enabled: boolean;
  max_exposure: number;
  min_price_delta: number;
  max_entry_price: number;
}

// The "Eyes" of the bot. Written by EdgeEngine, read by UI.
export interface MarketStateRow {
  market_id: string;
  status: 'WATCHING' | 'OPPORTUNITY' | 'LOCKED';
  chainlink_price: number;
  spot_price_median: number;
  delta: number;
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
  confidence: number;
  exposure: number;
  last_update: string;
}

export interface BotEvent {
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  meta?: any;
}
