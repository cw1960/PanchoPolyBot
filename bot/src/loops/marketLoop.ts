
import { Market, MarketStateRow } from '../types/tables';
import { Logger } from '../utils/logger';
import { ENV } from '../config/env';
import { EdgeEngine } from '../services/edgeEngine';
import { executionService } from '../services/execution';
import { supabase } from '../services/supabase';

export class MarketLoop {
  private active: boolean = false;
  private intervalId: any | null = null;
  public market: Market; 
  private edgeEngine: EdgeEngine;
  private currentExposure: number = 0; 
  private lastRunId: string | undefined = undefined;
  
  // STABILITY & PACING
  private stabilityCounter: number = 0;
  private lastDirection: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
  private readonly STABILITY_THRESHOLD = 3; 
  private lastTradeTime: number = 0; // For Cooldown

  constructor(market: Market) {
    this.market = market;
    this.edgeEngine = new EdgeEngine();
  }

  public async start() {
    if (this.active) return;
    await this.refreshExposure();
    this.active = true;
    Logger.info(`Starting Loop: ${this.market.polymarket_market_id}`);

    this.intervalId = setInterval(() => {
      this.tick();
    }, ENV.POLL_INTERVAL_MS);
  }

  private async refreshExposure() {
      const { data } = await supabase
        .from('market_state')
        .select('exposure')
        .eq('market_id', this.market.id)
        .maybeSingle();
      if (data) this.currentExposure = data.exposure || 0;
  }

  public stop() {
    if (!this.active) return;
    this.active = false;
    if (this.intervalId) clearInterval(this.intervalId);
    Logger.info(`Stopped Loop: ${this.market.polymarket_market_id}`);
  }

  public updateConfig(newConfig: Market) {
    this.market = newConfig; 
  }

  private async tick() {
    if (!this.active) return;
    const run = this.market._run;
    if (!run || run.status !== 'RUNNING') return; 

    // Reset on new run
    if (this.lastRunId !== run.id) {
        this.currentExposure = 0;
        this.stabilityCounter = 0;
        this.lastRunId = run.id;
        this.lastTradeTime = 0;
        await supabase.from('market_state').update({ exposure: 0 }).eq('market_id', this.market.id);
    }

    try {
      const observation = await this.edgeEngine.observe(this.market);
      if (!observation) return;

      const threshold = run.params?.confidenceThreshold || 0.6;
      const cooldown = run.params?.cooldown || 5000;
      
      const isHighConf = observation.confidence > threshold;
      
      // STABILITY LOGIC: Reset if signal flickers or direction changes
      if (isHighConf && observation.direction === this.lastDirection && observation.direction !== 'NEUTRAL') {
          this.stabilityCounter++;
      } else {
          this.stabilityCounter = 0;
          this.lastDirection = observation.direction;
      }

      let status: 'WATCHING' | 'OPPORTUNITY' | 'LOCKED' = 'WATCHING';
      
      if (!observation.isSafeToTrade) {
          status = 'LOCKED';
      } else if (this.stabilityCounter >= this.STABILITY_THRESHOLD) {
          status = 'OPPORTUNITY';
      }

      // PACING: Check cooldown
      const now = Date.now();
      const onCooldown = (now - this.lastTradeTime) < cooldown;

      if (status === 'OPPORTUNITY' && !onCooldown) {
         Logger.info(`[OPPORTUNITY] ${this.market.asset} ${observation.direction} (Model: ${(observation.calculatedProbability!*100).toFixed(1)}%)`);
         
         const result = await executionService.attemptTrade(this.market, observation, this.currentExposure);
         
         if (result.executed) {
            this.currentExposure = result.newExposure;
            this.lastTradeTime = now;
         }
      }

      // State Persistence
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
      Logger.error(`Tick Error ${this.market.polymarket_market_id}`, err);
    }
  }
}
