import { Market, MarketStateRow } from '../types/tables';
import { Logger } from '../utils/logger';
import { ENV } from '../config/env';
import { EdgeEngine } from '../services/edgeEngine';
import { executionService } from '../services/execution';
import { supabase } from '../services/supabase';

export class MarketLoop {
  private active: boolean = false;
  private intervalId: any | null = null;
  public readonly market: Market;
  private edgeEngine: EdgeEngine;
  private currentExposure: number = 0; // Local tracking

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
    (this.market as any) = newConfig; 
  }

  private async tick() {
    if (!this.active) return;
    
    try {
      // 1. Observe Market Edge
      const observation = await this.edgeEngine.observe(this.market);

      if (!observation) {
        return;
      }

      // 2. Determine UI Status based on confidence
      let status: 'WATCHING' | 'OPPORTUNITY' = 'WATCHING';
      if (observation.confidence > 0.6) status = 'OPPORTUNITY';

      // 3. Log Significant Events
      if (status === 'OPPORTUNITY') {
         Logger.info(`[EDGE] ${this.market.asset} Delta: $${observation.delta.toFixed(2)} Conf: ${(observation.confidence * 100).toFixed(0)}%`);
         
         // 4. ATTEMPT TRADE (The Hands)
         // Only trade if confidence is high and we are in opportunity mode
         await executionService.attemptTrade(this.market, observation, this.currentExposure);
      }

      // 5. Write State to DB
      const stateRow: MarketStateRow = {
        market_id: this.market.id,
        status: status as any,
        chainlink_price: observation.chainlink.price,
        spot_price_median: observation.spot.price,
        delta: observation.delta,
        direction: observation.direction,
        confidence: observation.confidence,
        exposure: this.currentExposure,
        last_update: new Date().toISOString()
      };

      const { error } = await supabase
        .from('market_state')
        .upsert(stateRow);

      if (error) {
        Logger.error("Failed to update market_state", error);
      } else {
        // Sync exposure reading from DB in case other bots updated it
        // (For now, we trust our local optimistic + simple DB read next tick)
      }

    } catch (err) {
      Logger.error(`Error in MarketLoop ${this.market.polymarket_market_id}`, err);
    }
  }
}
