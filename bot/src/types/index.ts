/**
 * types/index.ts
 * 
 * Central hub for all shared TypeScript interfaces.
 * Defines the contract between the Config, the Market State, and the Execution Engine.
 */

// Placeholder for Market configuration (loaded from Supabase)
export interface MarketConfig {
  id: string;
  slug: string;
  maxExposure: number;
}

// Placeholder for runtime Market state
export interface MarketState {
  marketId: string;
  currentPrice: number | null;
  lastUpdated: number;
}

// Placeholder for Risk limits
export interface RiskConfig {
  globalMaxExposure: number;
  killSwitch: boolean;
}
