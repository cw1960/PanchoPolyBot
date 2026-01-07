import { Market } from '../types/tables';
import { MarketLoop } from '../loops/marketLoop';
import { Logger } from '../utils/logger';
import { logEvent } from './supabase';

/**
 * Registry ensures that:
 * 1. Only enabled markets are running.
 * 2. No more than 5 markets run at once.
 * 3. Configuration updates are applied.
 */
export class MarketRegistry {
  private activeLoops: Map<string, MarketLoop> = new Map();
  private readonly MAX_MARKETS = 5;

  public async sync(markets: Market[]) {
    const validMarketIds = new Set(markets.map(m => m.id));

    // 1. Remove markets that are no longer in the list or are disabled
    for (const [id, loop] of this.activeLoops) {
      if (!validMarketIds.has(id)) {
        loop.stop();
        this.activeLoops.delete(id);
        await logEvent('INFO', `Registry removed market: ${loop.market.polymarket_market_id}`);
      }
    }

    // 2. Add or Update markets
    for (const market of markets) {
      if (!market.enabled) continue; // Should be filtered by caller, but safety first

      if (this.activeLoops.has(market.id)) {
        // Update existing
        this.activeLoops.get(market.id)?.updateConfig(market);
      } else {
        // Create new
        if (this.activeLoops.size >= this.MAX_MARKETS) {
          Logger.warn(`Max markets (${this.MAX_MARKETS}) reached. Skipping ${market.polymarket_market_id}`);
          continue;
        }

        const newLoop = new MarketLoop(market);
        newLoop.start();
        this.activeLoops.set(market.id, newLoop);
        await logEvent('INFO', `Registry started market: ${market.polymarket_market_id}`);
      }
    }
  }

  public stopAll() {
    if (this.activeLoops.size === 0) return;
    
    Logger.info("Stopping all market loops...");
    for (const loop of this.activeLoops.values()) {
      loop.stop();
    }
    this.activeLoops.clear();
  }

  public getActiveCount(): number {
    return this.activeLoops.size;
  }
}
