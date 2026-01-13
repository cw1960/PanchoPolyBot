
import { Market, MarketStateRow } from '../types/tables';
import { Logger } from '../utils/logger';
import { ENV } from '../config/env';
import { DEFAULTS } from '../config/defaults';
import { EdgeEngine } from '../services/edgeEngine';
import { executionService, ExecutionMode } from '../services/execution';
import { supabase } from '../services/supabase';
import { polymarket } from '../services/polymarket';
import { pnlLedger } from '../services/pnlLedger';
import { defensiveExitEvaluator } from '../services/defensiveExit';
import { accountManager } from '../services/accountManager'; // Import Account Manager

interface TierConfig {
    level: number;
    minConf: number;
    persistenceSamples: number; // How many recent ticks must meet minConf
    windowSize: number;         // Lookback window size
    sizeMult: number;           // Multiplier of Base Bet Size
}

interface ScalingState {
    lockedDirection: 'UP' | 'DOWN' | null;
    entryRegime?: string;     
    entryConfidence?: number; 
    clipsPlaced: number;
    lastTierLevel: number;
    history: { conf: number; dir: string; ts: number }[];
}

export class MarketLoop {
  private active: boolean = false;
  private intervalId: any | null = null;
  public market: Market; 
  private edgeEngine: EdgeEngine;
  private lastRunId: string | undefined = undefined;
  
  // INVARIANT 1: TERMINAL STATE FLAG
  private hasExitedDefensively: boolean = false;

  private lastWriteTime: number = 0;
  private lastLogTime: number = 0; 
  private lastPnlSyncTime: number = 0; 
  private lastTradeTime: number = 0; 
  
  private priceHistory: { price: number, time: number }[] = [];
  
  private scalingState: ScalingState = {
      lockedDirection: null,
      clipsPlaced: 0,
      lastTierLevel: 0,
      history: []
  };

  private readonly HISTORY_WINDOW_MS = 60000; 
  private readonly PNL_SYNC_INTERVAL_MS = 10000; 

  private readonly SCALING_PLAN: TierConfig[] = [
      { level: 1, minConf: 0.60, persistenceSamples: 3, windowSize: 5, sizeMult: 1.0 },
      { level: 2, minConf: 0.70, persistenceSamples: 3, windowSize: 5, sizeMult: 1.0 }, 
      { level: 3, minConf: 0.80, persistenceSamples: 4, windowSize: 6, sizeMult: 1.5 }, 
      { level: 4, minConf: 0.90, persistenceSamples: 5, windowSize: 8, sizeMult: 2.0 }, 
  ];

  constructor(market: Market) {
    this.market = market;
    this.edgeEngine = new EdgeEngine();
    this.lastWriteTime = Date.now();
  }

  public async start() {
    if (this.active) return;
    
    // No longer needing refreshExposure() from DB, we trust AccountManager
    await this.hydrateScalingState();
    
    this.active = true;
    this.hasExitedDefensively = false;

    Logger.info(`[LOOP_START] Market: ${this.market.polymarket_market_id} | Dir: ${this.scalingState.lockedDirection || 'OPEN'} | Clips: ${this.scalingState.clipsPlaced}`);

    this.intervalId = setInterval(() => {
      this.tick();
    }, ENV.POLL_INTERVAL_MS);
  }

  private async hydrateScalingState() {
      if (!this.market.active_run_id) return;
      
      const { data: trades } = await supabase
          .from('trade_events')
          .select('side, status, signals')
          .eq('test_run_id', this.market.active_run_id)
          .eq('market_id', this.market.id)
          .eq('status', 'EXECUTED')
          .order('created_at', { ascending: true });

      if (trades && trades.length > 0) {
          const firstTrade = trades[0];
          this.scalingState.lockedDirection = firstTrade.side as 'UP' | 'DOWN';
          if (firstTrade.signals) {
              this.scalingState.entryRegime = firstTrade.signals.regime;
          }
          this.scalingState.clipsPlaced = trades.length;
          this.scalingState.lastTierLevel = trades.length;
          
          Logger.info(`[HYDRATE] Restored State for ${this.market.asset}: Locked=${this.scalingState.lockedDirection}, Clips=${this.scalingState.clipsPlaced}`);
      } else {
          this.scalingState.lockedDirection = null;
          this.scalingState.clipsPlaced = 0;
          this.scalingState.lastTierLevel = 0;
          this.scalingState.entryRegime = undefined;
          this.scalingState.entryConfidence = undefined;
      }
  }

  public stop(reason: string = 'MANUAL') {
    if (!this.active) return;
    this.active = false;
    if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
    }
    
    if (this.hasExitedDefensively) {
        Logger.info(`[MARKET_LOOP_STOP] reason=DEFENSIVE_EXIT marketId=${this.market.id}`);
    } else {
        Logger.info(`[MARKET_LOOP_STOP] marketId=${this.market.id} reason=${reason} finalTickTime=${new Date(this.lastWriteTime).toISOString()}`);
    }
  }

  public updateConfig(newConfig: Market) {
    this.market = newConfig; 
  }

  private async tick() {
    if (!this.active) return;

    // INVARIANT 1: HARD TERMINAL GUARD
    if (this.hasExitedDefensively) {
        Logger.warn(`[INVARIANT_GUARD] Tick attempted after Defensive Exit. Ignoring.`);
        return;
    }

    const run = this.market._run;
    if (!run || run.status !== 'RUNNING') return; 

    // 1. Lifecycle Reset
    if (this.lastRunId !== run.id) {
        Logger.info(`[LOOP] New Run Detected: ${run.id}. Resetting Local State.`);
        this.scalingState = { lockedDirection: null, clipsPlaced: 0, lastTierLevel: 0, history: [] };
        this.priceHistory = [];
        this.lastRunId = run.id;
        this.lastTradeTime = 0;
        this.hasExitedDefensively = false; 
    }

    try {
      // 2. Observe
      // Note: We don't have a "baseTradeSize" globally anymore, sizing is per-Account.
      // But EdgeEngine needs a dummy size for VWAP calc.
      const observation = await this.edgeEngine.observe(
          this.market, 
          this.priceHistory,
          10 // Dummy size for VWAP calc, real sizing happens later
      );

      // 3. Check Expiration
      if (this.market.t_expiry) {
          const expiryTime = new Date(this.market.t_expiry).getTime();
          if (Date.now() >= expiryTime) {
             Logger.info(`[LOOP_EXPIRY] Market Expired: ${this.market.polymarket_market_id}`);
             if (ENV.DRY_RUN && run) {
                 await pnlLedger.settleMarket(this.market.id, run.id, 0.5, 'EXPIRY_CHECK');
             }
             this.stop('EXPIRED');
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

      this.priceHistory.push({ price: observation.spot.price, time: observation.timestamp });
      const cutoff = Date.now() - this.HISTORY_WINDOW_MS;
      this.priceHistory = this.priceHistory.filter(p => p.time > cutoff);
      
      this.scalingState.history.push({ 
          conf: observation.confidence, 
          dir: observation.direction, 
          ts: observation.timestamp 
      });
      if (this.scalingState.history.length > 20) this.scalingState.history.shift();

      let status: 'WATCHING' | 'OPPORTUNITY' | 'LOCKED' = 'WATCHING';
      if (!observation.isSafeToTrade) status = 'LOCKED';

      // 4. RESOLVE ISOLATED ACCOUNT
      // Logic: If locked, use locked direction. If not, use observed direction to check feasibility.
      const directionKey = this.scalingState.lockedDirection || observation.direction;
      
      // Determine if we have capital/exposure for this specific bucket
      // This is purely for reporting status in this tick, execution checks again strictly.
      let currentAccountExposure = 0;
      try {
          if (directionKey !== 'NEUTRAL') {
            const acc = accountManager.getAccount(this.market.asset, directionKey);
            currentAccountExposure = acc.currentExposure;
          }
      } catch (e) {
          // Can happen if direction is NEUTRAL or asset unknown
      }

      // 5. DEFENSIVE EXIT EVALUATION
      if (this.scalingState.lockedDirection && currentAccountExposure > 0) {
          const exitDecision = defensiveExitEvaluator.shouldExit(
              observation,
              this.scalingState.history,
              this.scalingState.entryRegime,
              this.scalingState.entryConfidence
          );

          if (exitDecision) {
              await this.executeDefensiveExit(exitDecision);
              return; 
          }
      }

      // 6. SCALING EVALUATION
      if (status !== 'LOCKED') {
          await this.evaluateScaling(observation, run.params?.cooldown || DEFAULTS.DEFAULT_COOLDOWN_MS);
          if (this.scalingState.clipsPlaced > 0) status = 'OPPORTUNITY';
      }

      // 7. PnL Sync (Stub for simulation updates)
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
        exposure: currentAccountExposure, // Report the ACCOUNT exposure, not loop local
        last_update: nowTs
      };

      await supabase.from('market_state').upsert(stateRow);
      this.lastWriteTime = Date.now(); 

    } catch (err) {
      Logger.error(`Tick Error ${this.market.polymarket_market_id}`, err);
    }
  }

  private async executeDefensiveExit(decision: any) {
      if (!this.scalingState.lockedDirection) return;

      // Fetch Account for accurate logging
      const acc = accountManager.getAccount(this.market.asset, this.scalingState.lockedDirection);

      Logger.info(`[DEFENSIVE_EXIT_TRIGGERED] marketId=${this.market.id} reason=${decision.reason} netExposure=${acc.currentExposure} entryDirection=${this.scalingState.lockedDirection}`);
      
      const result = await executionService.defensiveExit(
          this.market,
          this.scalingState.lockedDirection,
          decision
      );

      if (result.executed) {
          this.hasExitedDefensively = true;
          this.stop(`DEFENSIVE_EXIT:${decision.reason}`);
      } else {
          Logger.error(`[DEFENSIVE_EXIT] Execution Failed. Retrying next tick.`);
      }
  }

  private async evaluateScaling(obs: any, cooldown: number) {
      if (obs.direction === 'NEUTRAL') return;

      // A. Direction Lock Check
      if (this.scalingState.lockedDirection) {
          if (this.scalingState.lockedDirection !== obs.direction) {
              return;
          }
      }

      // B. Max Clips Check
      if (this.scalingState.clipsPlaced >= this.SCALING_PLAN.length) {
          return; 
      }

      // C. Cooldown Check
      const now = Date.now();
      if (now - this.lastTradeTime < cooldown) return;

      // D. Determine Next Target Tier
      const nextTierIdx = this.scalingState.clipsPlaced; 
      const tierConfig = this.SCALING_PLAN[nextTierIdx];

      if (!tierConfig) return;

      // E. Evaluate Persistence
      const recentSamples = this.scalingState.history.slice(-tierConfig.windowSize);
      const validSamples = recentSamples.filter(s => 
          s.dir === obs.direction && 
          s.conf >= tierConfig.minConf
      );

      const isEligible = validSamples.length >= tierConfig.persistenceSamples;

      if (isEligible) {
          // F. PASSIVE VS AGGRESSIVE MODE SELECTION
          let executionMode: ExecutionMode = 'AGGRESSIVE';
          const timeRemaining = obs.timeToExpiryMs || 0;
          const spread = obs.orderBook?.spread || 0;
          
          if (timeRemaining > 3 * 60 * 1000 && spread >= 0.02) {
              executionMode = 'PASSIVE';
          }

          Logger.info(`[SCALING] Tier ${tierConfig.level} Eligible (Conf=${obs.confidence.toFixed(2)}). Mode: ${executionMode}`);
          
          // Execute with NO baseSize override here, let ExecutionService/RiskGovernor resolve size from Account
          const result = await executionService.attemptTrade(
              this.market, 
              obs, 
              { 
                  tierLevel: tierConfig.level, 
                  clipIndex: nextTierIdx + 1,
                  scalingFactor: tierConfig.sizeMult,
                  tradeSizeOverride: 0, // 0 signals "Use RiskGovernor Calc"
                  mode: executionMode,
                  lockedDirection: this.scalingState.lockedDirection
              }
          );

          if (result.executed || result.simulated) {
              // SUCCESS
              this.lastTradeTime = now;
              
              // Update Scaling State
              this.scalingState.clipsPlaced++;
              this.scalingState.lastTierLevel = tierConfig.level;
              
              if (!this.scalingState.lockedDirection) {
                  this.scalingState.lockedDirection = obs.direction;
                  this.scalingState.entryRegime = obs.regime;
                  this.scalingState.entryConfidence = obs.confidence;

                  Logger.info(`[SCALING] DIRECTION LOCKED: ${obs.direction} (Regime: ${obs.regime})`);
              }
              
              Logger.info(`[SCALING] Executed Clip #${this.scalingState.clipsPlaced} (Tier ${tierConfig.level})`);
          } else if (executionMode === 'PASSIVE') {
             Logger.info(`[SCALING] Passive Attempt Missed/Skipped. Waiting for next tick.`);
          }
      }
  }
}
