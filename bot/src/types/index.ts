/**
 * types/index.ts
 * 
 * Central hub for all shared TypeScript interfaces.
 * Defines the contract between the Config, the Market State, and the Execution Engine.
 */

// Mirrors the 'markets' table in Supabase
export interface MarketConfig {
  id: string; // UUID
  polymarket_market_id: string;
  asset: string;
  direction: 'UP' | 'DOWN';
  enabled: boolean;
  max_exposure: number;
}

// Mirrors the 'bot_control' table
export interface GlobalConfig {
  desired_state: 'running' | 'stopped';
}

// Placeholder for runtime Market state (internal use)
export interface RuntimeMarketState {
  marketId: string;
  currentPrice: number | null;
  lastUpdated: number;
  isLocked: boolean;
}

// Placeholder for Risk limits
export interface RiskConfig {
  globalMaxExposure: number;
  killSwitch: boolean;
}
