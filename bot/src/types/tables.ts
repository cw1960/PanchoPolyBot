export interface BotControl {
  id: number;
  desired_state: 'running' | 'stopped';
  updated_at: string;
}

export interface Market {
  id: string; // UUID
  polymarket_market_id: string;
  asset: string;
  direction: 'UP' | 'DOWN';
  enabled: boolean;
  max_exposure: number;
  min_price_delta: number;
  max_entry_price: number;
}

export interface BotEvent {
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  meta?: any;
}
