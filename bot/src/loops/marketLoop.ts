import { Market, MarketStateRow } from '../types/tables';
import { Logger } from '../utils/logger';
import { ENV } from '../config/env';
import { EdgeEngine } from '../services/edgeEngine';
import { executionService } from '../services/execution';
import { supabase } from '../services/supabase';

export class MarketLoop {
  private active: boolean = false;
  private intervalId: any | null = null;
  public market: Market; // Public to allow updates
  private edgeEngine: EdgeEngine;
  private currentExposure: number = 0; // Local tracking
  private lastRunId: string | undefined = undefined;

  constructor(market: Market) {
    this.market = market;
    this.edgeEngine = new EdgeEngine();
  }

  public async start() {
    if (this.active) return;
    
    // Initial Exposure Load
    await this.refreshExposure();

    this.active = true;
    Logger.info(`Starting Market Loop for ${this.market.polymarket_market_id}`);

    // Poll at defined interval
    this.intervalId = setInterval(() => {
      this.tick();
    }, ENV.POLL_INTERVAL_MS);
  }

  private async refreshExposure() {
      // Load existing exposure from DB
      const { data, error } = await supabase
        .from('market_state')
        .select('exposure')
        .eq('market_id', this.market.id)
        .maybeSingle();

      if (data) {
          this.currentExposure = data.exposure || 0;
          Logger.info(`[${this.market.asset}] Sync exposure: $${this.currentExposure}`);
      }
  }

  public stop() {
    if (!this.active) return;
    this.active = false;
    if (this.intervalId) clearInterval(this.intervalId);
    Logger.info(`Stopped Market Loop for ${this.market.polymarket_market_id}`);
  }

  public updateConfig(newConfig: Market) {
    this.market = newConfig; 
  }

  private async tick() {
    if (!this.active) return;
    
    // --- EXPERIMENT CONTROL CHECK ---
    const run = this.market._run;
    
    // 1. If no active experiment or experiment is NOT running, just idle.
    if (!run || run.status !== 'RUNNING') {
        // We log sparingly to avoid spam, or update state to 'WATCHING'/IDLE
        return; 
    }

    // 2. DETECT EXPERIMENT RESET/SWITCH
    if (this.lastRunId !== run.id) {
        Logger.info(`[EXPERIMENT] Detected New Run: ${run.name} (ID: ${run.id}). Resetting Exposure.`);
        this.currentExposure = 0; // MEMORY RESET
        this.lastRunId = run.id;
        
        // Ensure DB is reset too (Double safety, though Dashboard does it)
        await supabase.from('market_state').update({ exposure: 0 }).eq('market_id', this.market.id);
    }

    try {
      // 3. Observe Market Edge
      const observation = await this.edgeEngine.observe(this.market);

      if (!observation) return;

      // 4. Determine UI Status based on confidence
      let status: 'WATCHING' | 'OPPORTUNITY' = 'WATCHING';
      
      // Use Experiment Threshold if available, else default 0.6
      const threshold = run.params?.confidenceThreshold || 0.6;
      if (observation.confidence > threshold) status = 'OPPORTUNITY';

      // 5. Attempt Trade (If Opportunity)
      if (status === 'OPPORTUNITY') {
         Logger.info(`[EDGE] ${this.market.asset} Delta: $${observation.delta.toFixed(2)} Conf: ${(observation.confidence * 100).toFixed(0)}%`);
         
         const result = await executionService.attemptTrade(this.market, observation, this.currentExposure);
         if (result.executed) {
            this.currentExposure = result.newExposure;
         }
      }

      // 6. Write State to DB (Heartbeat)
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

      await supabase.from('market_state').upsert(stateRow);

    } catch (err) {
      Logger.error(`Error in MarketLoop ${this.market.polymarket_market_id}`, err);
    }
  }
}
