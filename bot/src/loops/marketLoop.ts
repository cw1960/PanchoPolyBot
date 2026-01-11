
import { Market, MarketStateRow } from '../types/tables';
import { Logger } from '../utils/logger';
import { ENV } from '../config/env';
import { DEFAULTS } from '../config/defaults';
import { EdgeEngine } from '../services/edgeEngine';
import { executionService } from '../services/execution';
import { supabase } from '../services/supabase';
import { polymarket } from '../services/polymarket';
import { pnlLedger } from '../services/pnlLedger';

export class MarketLoop {
  private active: boolean = false;
  private intervalId: any | null = null;
  public market: Market; 
  private edgeEngine: EdgeEngine;
  private currentExposure: number = 0; 
  private lastRunId: string | undefined = undefined;
  
  // To handle external resets
  private lastWriteTime: number = 0;
  private lastLogTime: number = 0; // Throttle idle logs
  private lastPnlSyncTime: number = 0; // Throttle PnL checks
  
  // ROLLING STATE
  private priceHistory: { price: number, time: number }[] = [];
  private signalHistory: boolean[] = []; 
  private lastTradeTime: number = 0; 
  
  // CONSTANTS
  private readonly STABILITY_WINDOW = 10; 
  private readonly STABILITY_REQUIRED = 7; 
  private readonly HISTORY_WINDOW_MS = 60000; 
  private readonly PNL_SYNC_INTERVAL_MS = 10000; // 10s PnL Sync

  constructor(market: Market) {
    this.market = market;
    this.edgeEngine = new EdgeEngine();
    this.lastWriteTime = Date.now();
  }

  public async start() {
    if (this.active) return;
    
    // Fetch initial exposure, scoped to the current run if possible
    await this.refreshExposure();
    
    this.active = true;
    Logger.info(`[EXPOSURE_INIT] Market: ${this.market.polymarket_market_id} | Found existing usage: $${this.currentExposure}`);

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

    // 1. Exposure Scope Enforcement & Natural Reset
    if (this.lastRunId !== run.id) {
        Logger.info(`[LOOP] New Run Detected: ${run.id}. Resetting Local State.`);
        this.currentExposure = 0; 
        this.signalHistory = [];
        this.priceHistory = [];
        this.lastRunId = run.id;
        this.lastTradeTime = 0;
        
        await supabase.from('market_state').upsert({
            market_id: this.market.id,
            exposure: 0,
            run_id: run.id,
            status: 'WATCHING',
            last_update: new Date().toISOString()
        });
        
        Logger.info(`[EXPOSURE_RESET] Run=${run.id} | Usage reset to $0`);
    }

    // 2. EXTERNAL RESET DETECTION
    if (this.currentExposure > 0) {
        const { data: remoteState } = await supabase
           .from('market_state')
           .select('exposure, last_update')
           .eq('market_id', this.market.id)
           .single();

        if (remoteState && remoteState.last_update) {
            const remoteTime = new Date(remoteState.last_update).getTime();
            if (remoteState.exposure === 0 && remoteTime > this.lastWriteTime) {
                Logger.info(`[LOOP] External Exposure Reset Detected. Local: ${this.currentExposure} -> 0`);
                this.currentExposure = 0;
            }
        }
    }

    // 3. Invariant Guardrail
    if (this.currentExposure > 0) {
       const { count, error } = await supabase
        .from('trade_events')
        .select('*', { count: 'exact', head: true })
        .eq('test_run_id', run.id)
        .eq('market_id', this.market.id)
        .eq('status', 'EXECUTED'); 

       if (!error && count === 0) {
           Logger.error(`[EXPOSURE_BUG] INVARIANT VIOLATED! Local exposure ${this.currentExposure} but 0 trades in DB for run ${run.id}. Halting.`);
           this.stop();
           return;
       }
    }

    try {
      // 4. Observe
      const tradeSize = run.params?.tradeSize || DEFAULTS.DEFAULT_BET_SIZE;
      const observation = await this.edgeEngine.observe(
          this.market, 
          this.priceHistory,
          tradeSize
      );

      // 5. Check Expiration / Settlement (DRY RUN ONLY)
      if (this.market.t_expiry) {
          const expiryTime = new Date(this.market.t_expiry).getTime();
          if (Date.now() >= expiryTime) {
             Logger.info(`[LOOP] Market Expired: ${this.market.polymarket_market_id}`);
             
             if (ENV.DRY_RUN && run) {
                 // Determine Settlement Price
                 // 1. Try Implied (Book)
                 // 2. Try Calculated (Model)
                 // 3. Default 0.5 (Unresolved/Coinflip)
                 let settlePrice = 0.5;
                 if (observation && observation.impliedProbability > 0) {
                     settlePrice = observation.impliedProbability;
                 } else if (observation && observation.calculatedProbability > 0) {
                     settlePrice = observation.calculatedProbability;
                 }
                 
                 Logger.info(`[LOOP] Triggering Settlement @ ${settlePrice.toFixed(2)}`);
                 await pnlLedger.settleMarket(this.market.id, run.id, settlePrice);
             }
             
             this.stop();
             return;
          }
      }

      if (!observation) {
          const now = Date.now();
          if (now - this.lastLogTime > 10000) {
              Logger.info(`[LOOP] Waiting for Data/Hydration... (${this.market.polymarket_market_id})`);
              this.lastLogTime = now;
          }
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

      if (!observation.isSafeToTrade) {
          status = 'LOCKED';
      } else if (isStable && isHighConf) {
          status = 'OPPORTUNITY';
      }

      // 6. PnL Sync (Event Sourced / Mark-to-Market)
      const now = Date.now();
      if (ENV.DRY_RUN && (now - this.lastPnlSyncTime > this.PNL_SYNC_INTERVAL_MS)) {
           this.lastPnlSyncTime = now;
           const tokens = await polymarket.getTokens(this.market.polymarket_market_id);
           if (tokens && tokens.up) {
               const midPriceYes = await polymarket.getMidPrice(tokens.up);
               if (midPriceYes !== null) {
                   await pnlLedger.updateUnrealizedPnL(this.market.id, run.id, midPriceYes);
               }
           }
      }

      // 7. Execution Logic
      const cooldown = run.params?.cooldown || DEFAULTS.DEFAULT_COOLDOWN_MS;
      const onCooldown = (now - this.lastTradeTime) < cooldown;

      if (status === 'OPPORTUNITY') {
         if (!onCooldown) {
            Logger.info(`[OPPORTUNITY] ${this.market.asset} ${observation.direction} (Model: ${(observation.calculatedProbability!*100).toFixed(1)}%)`);
            const result = await executionService.attemptTrade(this.market, observation, this.currentExposure);
            
            if (result.executed) {
                this.currentExposure = result.newExposure; 
                this.lastTradeTime = now;
            } else if (result.simulated) {
                Logger.info(`[DRY_RUN] Simulated trade — exposure unchanged`);
                this.lastTradeTime = now; 
            }
         }
      } 

      // 8. State Persistence
      const nowTs = new Date().toISOString();
      const stateRow: MarketStateRow = {
        market_id: this.market.id,
        run_id: run.id,
        status: status as any,
        chainlink_price: observation.chainlink.price,
        spot_price_median: observation.spot.price,
        delta: observation.delta,
        direction: observation.direction,
        confidence: observation.confidence,
        exposure: this.currentExposure,
        last_update: nowTs
      };

      await supabase.from('market_state').upsert(stateRow);
      this.lastWriteTime = Date.now(); 

    } catch (err) {
      Logger.error(`Tick Error ${this.market.polymarket_market_id}`, err);
    }
  }
}
