
import { Market, MarketStateRow } from '../types/tables';
import { Logger } from '../utils/logger';
import { ENV } from '../config/env';
import { DEFAULTS } from '../config/defaults';
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
  
  // ROLLING STATE
  private priceHistory: { price: number, time: number }[] = [];
  private signalHistory: boolean[] = []; // true = high confidence hit
  private lastTradeTime: number = 0; 
  
  // CONSTANTS
  private readonly STABILITY_WINDOW = 10; // M ticks
  private readonly STABILITY_REQUIRED = 7; // K hits
  private readonly HISTORY_WINDOW_MS = 60000; // 60s for vol calc

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
        this.signalHistory = [];
        this.priceHistory = [];
        this.lastRunId = run.id;
        this.lastTradeTime = 0;
        await supabase.from('market_state').update({ exposure: 0 }).eq('market_id', this.market.id);
    }

    try {
      // 1. Observe (Pass History + Trade Size)
      const tradeSize = run.params?.tradeSize || DEFAULTS.DEFAULT_BET_SIZE;
      
      const observation = await this.edgeEngine.observe(
          this.market, 
          this.priceHistory,
          tradeSize
      );

      if (!observation) return;

      // 2. Update Rolling Price History
      this.priceHistory.push({ price: observation.spot.price, time: observation.timestamp });
      // Prune old history > 60s
      const cutoff = Date.now() - this.HISTORY_WINDOW_MS;
      this.priceHistory = this.priceHistory.filter(p => p.time > cutoff);

      // 3. M-of-N Stability Check
      const threshold = run.params?.confidenceThreshold || 0.6;
      const isHighConf = observation.confidence > threshold;
      
      this.signalHistory.push(isHighConf);
      if (this.signalHistory.length > this.STABILITY_WINDOW) {
          this.signalHistory.shift();
      }

      const hitCount = this.signalHistory.filter(h => h).length;
      const isStable = hitCount >= this.STABILITY_REQUIRED;

      let status: 'WATCHING' | 'OPPORTUNITY' | 'LOCKED' = 'WATCHING';
      
      if (!observation.isSafeToTrade) {
          status = 'LOCKED';
      } else if (isStable && isHighConf) { // Must be currently high conf AND stable
          status = 'OPPORTUNITY';
      }

      // 4. PACING (Dynamic Cooldown)
      const cooldown = run.params?.cooldown || DEFAULTS.DEFAULT_COOLDOWN_MS;
      const now = Date.now();
      const onCooldown = (now - this.lastTradeTime) < cooldown;

      if (status === 'OPPORTUNITY' && !onCooldown) {
         Logger.info(`[OPPORTUNITY] ${this.market.asset} ${observation.direction} (Model: ${(observation.calculatedProbability!*100).toFixed(1)}%, Stable: ${hitCount}/${this.STABILITY_WINDOW})`);
         
         const result = await executionService.attemptTrade(this.market, observation, this.currentExposure);
         
         if (result.executed) {
            this.currentExposure = result.newExposure;
            this.lastTradeTime = now;
         }
      }

      // 5. State Persistence
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
