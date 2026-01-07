import { Market } from '../types/tables';
import { Logger } from '../utils/logger';
import { ENV } from '../config/env';

/**
 * Represents a running worker for a specific market.
 * In Step 5, this will hold the Logic for price checking and trading.
 * In Step 4, it just logs its existence.
 */
export class MarketLoop {
  private active: boolean = false;
  private intervalId: any | null = null;
  public readonly market: Market;

  constructor(market: Market) {
    this.market = market;
  }

  public start() {
    if (this.active) return;
    this.active = true;
    Logger.info(`Starting Market Loop for ${this.market.polymarket_market_id}`);

    this.intervalId = setInterval(() => {
      this.tick();
    }, ENV.POLL_INTERVAL_MS);
  }

  public stop() {
    if (!this.active) return;
    this.active = false;
    if (this.intervalId) clearInterval(this.intervalId);
    Logger.info(`Stopped Market Loop for ${this.market.polymarket_market_id}`);
  }

  public updateConfig(newConfig: Market) {
    // Used if parameters change while running
    // (We treat this as read-only for now in this generic loop)
    // In future steps, we update risk params here.
  }

  private async tick() {
    if (!this.active) return;
    
    // PLACEHOLDER: Future Trading Logic Here
    // 1. Get Polymarket Orderbook
    // 2. Get Binance Price
    // 3. Compare & Execute
    
    // For now, minimal logging to prove concurrency
    Logger.info(`[MARKET_LOOP_ACTIVE] Processing: ${this.market.polymarket_market_id}`);
  }
}