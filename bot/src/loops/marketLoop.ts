import { Market, MarketStateRow } from '../types/tables';
import { Logger } from '../utils/logger';
import { ENV } from '../config/env';
import { EdgeEngine } from '../services/edgeEngine';
import { supabase } from '../services/supabase';

export class MarketLoop {
  private active: boolean = false;
  private intervalId: any | null = null;
  public readonly market: Market;
  private edgeEngine: EdgeEngine;

  constructor(market: Market) {
    this.market = market;
    this.edgeEngine = new EdgeEngine();
  }

  public start() {
    if (this.active) return;
    this.active = true;
    Logger.info(`Starting Market Loop for ${this.market.polymarket_market_id}`);

    // Poll at defined interval
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
    // In strict TS, we can't just assign if readonly, but for this scaffold pattern:
    (this.market as any) = newConfig; 
  }

  private async tick() {
    if (!this.active) return;
    
    try {
      // 1. Observe Market Edge
      const observation = await this.edgeEngine.observe(this.market);

      if (!observation) {
        // Logger.warn(`No price data for ${this.market.asset}`);
        return;
      }

      // 2. Determine UI Status
      let status: 'WATCHING' | 'OPPORTUNITY' = 'WATCHING';
      if (observation.confidence > 0.6) status = 'OPPORTUNITY';

      // 3. Log Significant Events
      if (status === 'OPPORTUNITY') {
         Logger.info(`[EDGE DETECTED] ${this.market.asset} Delta: ${observation.delta.toFixed(2)} Conf: ${(observation.confidence * 100).toFixed(0)}%`);
      }

      // 4. Write State to DB (Eyes for the UI)
      const stateRow: MarketStateRow = {
        market_id: this.market.id,
        status: status as any, // Cast to match DB enum if needed
        chainlink_price: observation.chainlink.price,
        spot_price_median: observation.spot.price,
        delta: observation.delta,
        direction: observation.direction,
        confidence: observation.confidence,
        exposure: 0, // No trading yet
        last_update: new Date().toISOString()
      };

      const { error } = await supabase
        .from('market_state')
        .upsert(stateRow);

      if (error) {
        Logger.error("Failed to update market_state", error);
      }

    } catch (err) {
      Logger.error(`Error in MarketLoop ${this.market.polymarket_market_id}`, err);
    }
  }
}
