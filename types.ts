export type BotStatus = 'STOPPED' | 'STARTING' | 'RUNNING' | 'ERROR';

export interface MarketConfig {
  id: string; // The internal UUID for our config
  marketSlug: string; // The user-facing Polymarket slug or ID
  isActive: boolean;
  maxExposure: number; // Max $ amount to risk on this specific market
  minPriceDelta: number; // Deviation required to trigger
  maxEntryPrice: number; // Safety ceiling (e.g. 0.95)
}

export interface BotState {
  status: BotStatus;
  lastHeartbeat: number; // Unix timestamp of last ping from VPS
  activeMarkets: number;
  totalExposure: number; // Sum of all open positions
  globalKillSwitch: boolean; // If true, bot stops ALL trades immediately
  logs: string[];
}

export interface ControlCommand {
  type: 'START_BOT' | 'STOP_BOT' | 'ADD_MARKET' | 'REMOVE_MARKET' | 'UPDATE_MARKET';
  payload?: any;
  timestamp: number;
}

// Placeholder for Supabase Row structures
export interface SupabaseMarketRow {
  id: string;
  created_at: string;
  slug: string;
  is_active: boolean;
  config_json: any;
}

export interface PricePoint {
  timestamp: number;
  sourcePrice: number;
  targetPrice: number;
  delta: number;
}

export interface TradeLog {
  id: string;
  timestamp: number;
  type: string;
  asset: string;
  entryPrice: number;
  marketPrice: number;
  amount: number;
  status: string;
}

export interface BotConfig {
  triggerThreshold: number;
  betSize: number;
}