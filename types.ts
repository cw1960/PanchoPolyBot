
export type BotStatus = 'STOPPED' | 'STARTING' | 'RUNNING' | 'ERROR';

// Maps directly to the 'markets' table in Supabase
export interface MarketConfig {
  id: string; // UUID from Supabase
  polymarket_market_id: string; // The slug or ID
  asset: string; // 'BTC', 'ETH' (derived from slug usually)
  direction: 'UP' | 'DOWN'; // (derived or configured)
  enabled: boolean;
  max_exposure: number;
  min_price_delta: number;
  max_entry_price: number;
  created_at?: string;
}

// Maps directly to the 'bot_control' table
export interface GlobalBotState {
  desired_state: 'running' | 'stopped';
  updated_at: string;
}

// Maps to 'market_state' table
export interface MarketStatusRow {
  market_id: string;
  status: string;
  exposure: number;
  confidence: number;
  last_update: string;
}

export interface BotState {
  status: BotStatus;
  lastHeartbeat: number;
  activeMarkets: number;
  totalExposure: number;
  globalKillSwitch: boolean;
  logs: string[];
}

export interface ControlCommand {
  type: 'START_BOT' | 'STOP_BOT' | 'ADD_MARKET' | 'REMOVE_MARKET' | 'UPDATE_MARKET';
  payload?: any;
  timestamp: number;
}

// UI Type: Merges Config + Live State
export interface MarketWithState extends MarketConfig {
  liveState?: MarketStatusRow;
}

// Simulation Types (Deprecated for Production UI but kept for ref)
export interface PricePoint {
  timestamp: number;
  sourcePrice: number;
  targetPrice: number;
  delta: number;
}

export interface TradeLog {
  id: string;
  timestamp: number;
  type: 'BUY_YES' | 'BUY_NO';
  asset: string;
  entryPrice: number;
  marketPrice: number;
  amount: number;
  status: 'OPEN' | 'CLOSED' | 'WON' | 'LOST';
}

export interface BotConfig {
  triggerThreshold: number;
  betSize: number;
}
