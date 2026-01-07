/**
 * markets/marketManager.ts
 * 
 * Responsibilities:
 * 1. Hold the list of all currently active markets (from Supabase).
 * 2. Add/Remove markets dynamically without restarting the bot.
 * 3. Route price updates to the correct MarketState.
 */

import { MarketConfig } from '../types';

export class MarketManager {
  private markets: Map<string, any> = new Map();

  constructor() {
    // Intentionally empty
  }

  public syncMarkets(configs: MarketConfig[]) {
    // Logic to diff 'configs' vs 'this.markets'
    // Add new ones, remove old ones.
    console.log(`Syncing ${configs.length} markets...`);
  }

  public getMarket(id: string) {
    return this.markets.get(id);
  }
}
