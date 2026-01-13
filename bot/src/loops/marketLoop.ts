
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
import { accountManager } from '../services/accountManager'; 
import { IsolatedMarketAccount } from '../types/accounts';

interface TierConfig {
    level: number;
    minConf: number;
    persistenceSamples: number; 
    windowSize: number;         
    sizeMult: number;           
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
  
  // INVARIANT 1: IMMUTABLE ACCOUNT MAPPING
  // Once locked, this reference MUST be used for all ledger/risk operations.
  private _immutableAccount: IsolatedMarketAccount | null = null;
  
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
          
          // RE-ESTABLISH INVARIANT ON HYDRATION (Restart Safety)
          this._immutableAccount = accountManager.getAccount(this.market.asset, this.scalingState.lockedDirection);
          Logger.info(`[LOCK_RESTORED] Market=${this.market.polymarket_market_id} Account=${this._immutableAccount.marketKey}`);

          if (firstTrade.signals) {
              this.scalingState.entryRegime = firstTrade.signals.regime;
          }
          this.scalingState.clipsPlaced = trades.length;
          this.scalingState.lastTierLevel = trades.length;
      } else {
          this.scalingState.lockedDirection = null;
          this._immutableAccount = null;
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
        Logger.info(`[MARKET_TERMINATED] reason=DEFENSIVE_EXIT marketId=${this.market.id}`);
    } else {
        Logger.info(`[MARKET_TERMINATED] marketId=${this.market.id} reason=${reason}`);
    }
  }

  public updateConfig(newConfig: Market) {
    this.market = newConfig; 
  }

  private async tick() {
    if (!this.active) return;

    if (this.hasExitedDefensively) {
        return;
    }

    const run = this.market._run;
    if (!run || run.status !== 'RUNNING') return; 

    // Lifecycle Reset
    if (this.lastRunId !== run.id) {
        Logger.info(`[LOOP] New Run Detected: ${run.id}. Resetting Local State.`);
        this.scalingState = { lockedDirection: null, clipsPlaced: 0, lastTierLevel: 0, history: [] };
        this._immutableAccount = null; // Clear Invariant
        this.priceHistory = [];
        this.lastRunId = run.id;
        this.lastTradeTime = 0;
        this.hasExitedDefensively = false; 
    }

    try {
      const observation = await this.edgeEngine.observe(
          this.market, 
          this.priceHistory,
          10 
      );

      // Expiration Check
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

      // ---------------------------------------------------------
      // INVARIANT #1: ACCOUNT RESOLUTION
      // ---------------------------------------------------------
      let activeAccount: IsolatedMarketAccount | null = null;
      let currentAccountExposure = 0;

      if (this.scalingState.lockedDirection) {
          // STRICT PATH: Use Immutable Account
          if (!this._immutableAccount) {
              throw new Error("[INVARIANT_VIOLATION] Direction is locked but _immutableAccount is null.");
          }
          
          if (this._immutableAccount.direction !== this.scalingState.lockedDirection) {
               throw new Error(`[INVARIANT_VIOLATION] Locked Direction ${this.scalingState.lockedDirection} mismatch with Account ${this._immutableAccount.direction}`);
          }

          // SIGNAL FLIP GUARD: Even if observation says DOWN, we stay locked UP
          if (observation.direction !== 'NEUTRAL' && observation.direction !== this.scalingState.lockedDirection) {
              Logger.warn(`[LOCK_PERSISTS_SIGNAL_IGNORED] Locked=${this.scalingState.lockedDirection} Signal=${observation.direction}`);
          }

          activeAccount = this._immutableAccount;
          currentAccountExposure = activeAccount.currentExposure;
      } else {
          // WATCH PATH: Use Observation Direction
          // No lock yet, so we peek at the potential account.
          if (observation.direction !== 'NEUTRAL') {
               activeAccount = accountManager.getAccount(this.market.asset, observation.direction);
               currentAccountExposure = activeAccount.currentExposure;
          }
      }

      // 5. DEFENSIVE EXIT EVALUATION
      if (this.scalingState.lockedDirection && activeAccount) {
          // Verify we passed the correct account
          if (activeAccount !== this._immutableAccount) {
              throw new Error("[INVARIANT_VIOLATION] Active Account !== Immutable Account during Defensive Check");
          }

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

      // 7. PnL Sync 
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
        exposure: currentAccountExposure, 
        last_update: nowTs
      };

      await supabase.from('market_state').upsert(stateRow);
      this.lastWriteTime = Date.now(); 

    } catch (err) {
      Logger.error(`Tick Error ${this.market.polymarket_market_id}`, err);
    }
  }

  private async executeDefensiveExit(decision: any) {
      if (!this.scalingState.lockedDirection || !this._immutableAccount) {
          Logger.error("[INVARIANT_VIOLATION] Defensive Exit triggered without Locked State");
          return;
      }

      Logger.info(`[DEFENSIVE_EXIT_TRIGGERED] marketId=${this.market.id} reason=${decision.reason} entryDirection=${this.scalingState.lockedDirection}`);
      
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
          
          const result = await executionService.attemptTrade(
              this.market, 
              obs, 
              { 
                  tierLevel: tierConfig.level, 
                  clipIndex: nextTierIdx + 1,
                  scalingFactor: tierConfig.sizeMult,
                  tradeSizeOverride: 0, 
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
              
              // INVARIANT 1: LOCK DIRECTION ON FIRST TRADE
              if (!this.scalingState.lockedDirection) {
                  this.scalingState.lockedDirection = obs.direction;
                  this._immutableAccount = accountManager.getAccount(this.market.asset, obs.direction);
                  
                  this.scalingState.entryRegime = obs.regime;
                  this.scalingState.entryConfidence = obs.confidence;

                  Logger.info(`[DIRECTION_LOCKED] Market: ${this.market.polymarket_market_id} -> ${obs.direction}`);
                  Logger.info(`[ACCOUNT_LOCKED] ${this._immutableAccount.marketKey}`);
              }
              
              Logger.info(`[SCALING] Executed Clip #${this.scalingState.clipsPlaced} (Tier ${tierConfig.level})`);
          } else if (executionMode === 'PASSIVE') {
             Logger.info(`[SCALING] Passive Attempt Missed/Skipped. Waiting for next tick.`);
          }
      }
  }
}
