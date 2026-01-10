
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
  
  // STABILITY GATING
  private stabilityCounter: number = 0;
  private lastDirection: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
  private readonly STABILITY_THRESHOLD = 3; // Must hold signal for 3 ticks

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
    
    const run = this.market._run;
    if (!run || run.status !== 'RUNNING') return; 

    // DETECT EXPERIMENT RESET
    if (this.lastRunId !== run.id) {
        Logger.info(`[EXPERIMENT] Detected New Run: ${run.name}. Resetting.`);
        this.currentExposure = 0;
        this.stabilityCounter = 0;
        this.lastRunId = run.id;
        await supabase.from('market_state').update({ exposure: 0 }).eq('market_id', this.market.id);
    }

    try {
      // 1. Observe
      const observation = await this.edgeEngine.observe(this.market);

      if (!observation) return;

      // 2. Stability Gating
      // We only consider it a valid signal if direction matches and confidence > threshold
      const threshold = run.params?.confidenceThreshold || 0.6;
      const isHighConf = observation.confidence > threshold;
      
      if (isHighConf && observation.direction === this.lastDirection) {
          this.stabilityCounter++;
      } else {
          this.stabilityCounter = 0;
          this.lastDirection = observation.direction;
      }

      // 3. Status Determination
      let status: 'WATCHING' | 'OPPORTUNITY' | 'LOCKED' = 'WATCHING';
      
      if (!observation.isSafeToTrade) {
          status = 'LOCKED'; // No Trade Zone
      } else if (isHighConf && this.stabilityCounter >= this.STABILITY_THRESHOLD) {
          status = 'OPPORTUNITY';
      }

      // 4. Attempt Trade (Accumulation Pacing is handled by loop frequency)
      if (status === 'OPPORTUNITY') {
         Logger.info(`[EDGE] ${this.market.asset} Prob: ${(observation.calculatedProbability! * 100).toFixed(1)}% Implied: ${(observation.impliedProbability! * 100).toFixed(1)}%`);
         
         const result = await executionService.attemptTrade(this.market, observation, this.currentExposure);
         if (result.executed) {
            this.currentExposure = result.newExposure;
         }
      }

      // 5. Write State
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
