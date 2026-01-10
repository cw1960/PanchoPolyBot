
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
  private signalHistory: boolean[] = []; 
  private lastTradeTime: number = 0; 
  
  // CONSTANTS
  private readonly STABILITY_WINDOW = 10; 
  private readonly STABILITY_REQUIRED = 7; 
  private readonly HISTORY_WINDOW_MS = 60000; 

  constructor(market: Market) {
    this.market = market;
    this.edgeEngine = new EdgeEngine();
  }

  public async start() {
    if (this.active) return;
    
    // Fetch initial exposure, scoped to the current run if possible
    // Note: The tick() method handles the authoritative reset if run_id mismatches.
    await this.refreshExposure();
    
    this.active = true;
    Logger.info(`[EXPOSURE] INIT run=${this.market.active_run_id} market=${this.market.polymarket_market_id} used=${this.currentExposure}`);

    this.intervalId = setInterval(() => {
      this.tick();
    }, ENV.POLL_INTERVAL_MS);
  }

  private async refreshExposure() {
      // Safely fetch exposure from DB. 
      // If the DB has exposure but no run_id, or wrong run_id, tick() will correct it.
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

    // 1. Exposure Scope Enforcement & Natural Reset
    if (this.lastRunId !== run.id) {
        Logger.info(`[LOOP] New Run Detected: ${run.id}. Resetting Local State.`);
        this.currentExposure = 0; // Natural Reset
        this.signalHistory = [];
        this.priceHistory = [];
        this.lastRunId = run.id;
        this.lastTradeTime = 0;
        
        // Persist clean state with new run_id
        await supabase.from('market_state').upsert({
            market_id: this.market.id,
            exposure: 0,
            run_id: run.id,
            status: 'WATCHING',
            last_update: new Date().toISOString()
        });
        
        Logger.info(`[EXPOSURE] INIT run=${run.id} market=${this.market.polymarket_market_id} used=0`);
    }

    // 2. Invariant Guardrail: Exposure Hallucination Check
    // If we think we have exposure, verify against the Ledger (trade_events)
    if (this.currentExposure > 0) {
       const { count, error } = await supabase
        .from('trade_events')
        .select('*', { count: 'exact', head: true })
        .eq('test_run_id', run.id)
        .eq('market_id', this.market.id)
        .eq('status', 'EXECUTED'); // Only count actual executions

       if (!error && count === 0) {
           Logger.error(`[EXPOSURE_BUG] INVARIANT VIOLATED! Local exposure ${this.currentExposure} but 0 trades in DB for run ${run.id}. Halting.`);
           this.stop();
           return;
       }
    }

    // 3. Log Exposure Check
    const max = run.params?.maxExposure || this.market.max_exposure || 50;
    Logger.info(`[EXPOSURE] CHECK run=${run.id} market=${this.market.polymarket_market_id} used=${this.currentExposure} remaining=${max - this.currentExposure}`);

    try {
      // 4. Observe
      const tradeSize = run.params?.tradeSize || DEFAULTS.DEFAULT_BET_SIZE;
      const observation = await this.edgeEngine.observe(
          this.market, 
          this.priceHistory,
          tradeSize
      );

      if (!observation) {
          Logger.info(`[EXPOSURE] NO_CHANGE reason=OBSERVATION_NULL`);
          return;
      }

      // Update History
      this.priceHistory.push({ price: observation.spot.price, time: observation.timestamp });
      const cutoff = Date.now() - this.HISTORY_WINDOW_MS;
      this.priceHistory = this.priceHistory.filter(p => p.time > cutoff);

      // Stability Check
      const threshold = run.params?.confidenceThreshold || 0.6;
      const isHighConf = observation.confidence > threshold;
      
      this.signalHistory.push(isHighConf);
      if (this.signalHistory.length > this.STABILITY_WINDOW) this.signalHistory.shift();

      const hitCount = this.signalHistory.filter(h => h).length;
      const isStable = hitCount >= this.STABILITY_REQUIRED;

      let status: 'WATCHING' | 'OPPORTUNITY' | 'LOCKED' = 'WATCHING';
      let skipReason = '';

      if (!observation.isSafeToTrade) {
          status = 'LOCKED';
          skipReason = 'NO_TRADE_ZONE';
      } else if (isStable && isHighConf) {
          status = 'OPPORTUNITY';
      } else {
          skipReason = 'NO_SIGNAL';
      }

      // 5. Execution Logic
      const cooldown = run.params?.cooldown || DEFAULTS.DEFAULT_COOLDOWN_MS;
      const now = Date.now();
      const onCooldown = (now - this.lastTradeTime) < cooldown;

      if (status === 'OPPORTUNITY') {
         if (!onCooldown) {
            Logger.info(`[OPPORTUNITY] ${this.market.asset} ${observation.direction} (Model: ${(observation.calculatedProbability!*100).toFixed(1)}%)`);
            
            // ATTEMPT TRADE
            // Note: attemptTrade returns the new exposure, it does NOT mutate global state directly.
            const result = await executionService.attemptTrade(this.market, observation, this.currentExposure);
            
            if (result.executed) {
                this.currentExposure = result.newExposure; // MUTATION POINT
                this.lastTradeTime = now;
            } else {
                Logger.info(`[EXPOSURE] NO_CHANGE reason=EXECUTION_SKIPPED`);
            }
         } else {
             Logger.info(`[EXPOSURE] NO_CHANGE reason=COOLDOWN`);
         }
      } else {
          // If not an opportunity, log no change occasionally or via the generic CHECK log
      }

      // 6. State Persistence (With Run ID)
      const stateRow: MarketStateRow = {
        market_id: this.market.id,
        run_id: run.id, // Scoped
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
