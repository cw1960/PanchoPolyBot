
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

interface TierConfig {
    level: number;
    minConf: number;
    persistenceSamples: number; // How many recent ticks must meet minConf
    windowSize: number;         // Lookback window size
    sizeMult: number;           // Multiplier of Base Bet Size
}

interface ScalingState {
    lockedDirection: 'UP' | 'DOWN' | null;
    entryRegime?: string;     // New: For Regime Invalidation checks
    entryConfidence?: number; // New: For Thesis tracking
    clipsPlaced: number;
    lastTierLevel: number;
    history: { conf: number; dir: string; ts: number }[];
}

export class MarketLoop {
  private active: boolean = false;
  private intervalId: any | null = null;
  public market: Market; 
  private edgeEngine: EdgeEngine;
  private currentExposure: number = 0; 
  private lastRunId: string | undefined = undefined;
  
  // INVARIANT 1: TERMINAL STATE FLAG
  private hasExitedDefensively: boolean = false;

  // To handle external resets
  private lastWriteTime: number = 0;
  private lastLogTime: number = 0; // Throttle idle logs
  private lastPnlSyncTime: number = 0; // Throttle PnL checks
  private lastTradeTime: number = 0; 
  
  // Price history for volatility calculation
  private priceHistory: { price: number, time: number }[] = [];
  
  // SCALING STATE
  private scalingState: ScalingState = {
      lockedDirection: null,
      clipsPlaced: 0,
      lastTierLevel: 0,
      history: []
  };

  // CONSTANTS
  private readonly HISTORY_WINDOW_MS = 60000; 
  private readonly PNL_SYNC_INTERVAL_MS = 10000; 

  // CONFIDENCE TIERS
  // Strict progression: Must sustain higher confidence to add more risk.
  private readonly SCALING_PLAN: TierConfig[] = [
      { level: 1, minConf: 0.60, persistenceSamples: 3, windowSize: 5, sizeMult: 1.0 },
      { level: 2, minConf: 0.70, persistenceSamples: 3, windowSize: 5, sizeMult: 1.0 }, // Add equal clip
      { level: 3, minConf: 0.80, persistenceSamples: 4, windowSize: 6, sizeMult: 1.5 }, // Size up
      { level: 4, minConf: 0.90, persistenceSamples: 5, windowSize: 8, sizeMult: 2.0 }, // High conviction
  ];

  constructor(market: Market) {
    this.market = market;
    this.edgeEngine = new EdgeEngine();
    this.lastWriteTime = Date.now();
  }

  public async start() {
    if (this.active) return;
    
    // 1. Fetch initial exposure & Hydrate Scaling State
    await this.refreshExposure();
    await this.hydrateScalingState();
    
    this.active = true;
    // Reset terminal flag on fresh start (lifecycle management)
    this.hasExitedDefensively = false;

    Logger.info(`[LOOP_START] Market: ${this.market.polymarket_market_id} | Dir: ${this.scalingState.lockedDirection || 'OPEN'} | Clips: ${this.scalingState.clipsPlaced}`);

    this.intervalId = setInterval(() => {
      this.tick();
    }, ENV.POLL_INTERVAL_MS);
  }

  /**
   * Reconstructs the state of this market (Direction, Clip Count) from the DB.
   * Ensures we don't flip direction or double-count clips after a bot restart.
   */
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
          // Lock direction to the first trade
          const firstTrade = trades[0];
          this.scalingState.lockedDirection = firstTrade.side as 'UP' | 'DOWN';
          
          // Attempt to restore entry regime/confidence from signals json if available
          if (firstTrade.signals) {
              this.scalingState.entryRegime = firstTrade.signals.regime;
              // this.scalingState.entryConfidence = ... (might not be in signals flat, but that's okay, we can proceed without strict invalidation if missing)
          }

          // Count executed clips
          this.scalingState.clipsPlaced = trades.length;
          
          // Estimate tier (naive: assume 1 trade = 1 tier level progressed)
          this.scalingState.lastTierLevel = trades.length;
          
          Logger.info(`[HYDRATE] Restored State for ${this.market.asset}: Locked=${this.scalingState.lockedDirection}, Clips=${this.scalingState.clipsPlaced}`);
      } else {
          // Reset if fresh
          this.scalingState.lockedDirection = null;
          this.scalingState.clipsPlaced = 0;
          this.scalingState.lastTierLevel = 0;
          this.scalingState.entryRegime = undefined;
          this.scalingState.entryConfidence = undefined;
      }
  }

  private async refreshExposure() {
      const { data } = await supabase
        .from('market_state')
        .select('exposure')
        .eq('market_id', this.market.id)
        .maybeSingle();
      if (data) this.currentExposure = data.exposure || 0;
  }

  public stop(reason: string = 'MANUAL') {
    if (!this.active) return;
    this.active = false;
    if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
    }
    
    // Explicit Audit Log for Terminal State
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

    // 1. Exposure Scope Enforcement & Natural Reset
    if (this.lastRunId !== run.id) {
        Logger.info(`[LOOP] New Run Detected: ${run.id}. Resetting Local State.`);
        this.currentExposure = 0; 
        this.scalingState = { lockedDirection: null, clipsPlaced: 0, lastTierLevel: 0, history: [] };
        this.priceHistory = [];
        this.lastRunId = run.id;
        this.lastTradeTime = 0;
        this.hasExitedDefensively = false; // Reset allowed on new run ID only
        
        await supabase.from('market_state').upsert({
            market_id: this.market.id,
            exposure: 0,
            run_id: run.id,
            status: 'WATCHING',
            last_update: new Date().toISOString()
        });
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
                // Note: We do NOT reset scaling state (Direction Lock) on exposure reset, 
                // because the market hypothesis usually remains valid until expiry.
            }
        }
    }

    try {
      // 3. Observe
      const baseTradeSize = run.params?.tradeSize || DEFAULTS.DEFAULT_BET_SIZE;
      const observation = await this.edgeEngine.observe(
          this.market, 
          this.priceHistory,
          baseTradeSize
      );

      // 4. Check Expiration
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

      // Update Local Histories
      this.priceHistory.push({ price: observation.spot.price, time: observation.timestamp });
      const cutoff = Date.now() - this.HISTORY_WINDOW_MS;
      this.priceHistory = this.priceHistory.filter(p => p.time > cutoff);
      
      // Update Scaling History
      this.scalingState.history.push({ 
          conf: observation.confidence, 
          dir: observation.direction, 
          ts: observation.timestamp 
      });
      if (this.scalingState.history.length > 20) this.scalingState.history.shift();

      // 5. Determine Logic State
      let status: 'WATCHING' | 'OPPORTUNITY' | 'LOCKED' = 'WATCHING';
      if (!observation.isSafeToTrade) status = 'LOCKED';

      // 6. DEFENSIVE EXIT EVALUATION
      // Run this BEFORE Scaling Logic to prioritize capital protection
      if (this.scalingState.lockedDirection && this.currentExposure > 0) {
          const exitDecision = defensiveExitEvaluator.shouldExit(
              observation,
              this.scalingState.history,
              this.scalingState.entryRegime,
              this.scalingState.entryConfidence
          );

          if (exitDecision) {
              // TERMINAL BRANCH
              await this.executeDefensiveExit(exitDecision);
              return; // Stop processing immediately
          }
      }

      // 7. SCALING EVALUATION
      if (status !== 'LOCKED') {
          await this.evaluateScaling(observation, run.params?.cooldown || DEFAULTS.DEFAULT_COOLDOWN_MS, baseTradeSize);
          if (this.scalingState.clipsPlaced > 0) status = 'OPPORTUNITY';
      }

      // 8. PnL Sync
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

      // 9. State Persistence
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

  /**
   * Executes a defensive exit: Halts scaling, sells inventory, stops loop.
   * REACHABLE ONLY ONCE per market due to hasExitedDefensively flag.
   */
  private async executeDefensiveExit(decision: any) {
      if (!this.scalingState.lockedDirection) return;

      // Log Mandatory Trigger Event
      Logger.info(`[DEFENSIVE_EXIT_TRIGGERED] marketId=${this.market.id} reason=${decision.reason} netExposure=${this.currentExposure} entryDirection=${this.scalingState.lockedDirection}`);
      
      const result = await executionService.defensiveExit(
          this.market,
          this.scalingState.lockedDirection,
          decision
      );

      if (result.executed) {
          // LOCK TERMINAL STATE
          this.hasExitedDefensively = true;
          this.currentExposure = 0; 
          this.stop(`DEFENSIVE_EXIT:${decision.reason}`);
      } else {
          Logger.error(`[DEFENSIVE_EXIT] Execution Failed. Retrying next tick.`);
          // If execution failed (network error), we do NOT set terminal flag yet,
          // allowing the next tick to retry the exit.
      }
  }

  /**
   * Evaluates whether to enter or add to a position based on Confidence Tiers.
   */
  private async evaluateScaling(obs: any, cooldown: number, baseSize: number) {
      // A. Direction Lock Check
      if (this.scalingState.lockedDirection) {
          if (this.scalingState.lockedDirection !== obs.direction) {
              // Signal mismatch - Do nothing (Wait for alignment or expiry)
              return;
          }
      }

      // B. Max Clips Check
      if (this.scalingState.clipsPlaced >= this.SCALING_PLAN.length) {
          return; // Max allocation reached
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

          const tradeSize = baseSize * tierConfig.sizeMult;
          
          const result = await executionService.attemptTrade(
              this.market, 
              obs, 
              this.currentExposure,
              { 
                  tierLevel: tierConfig.level, 
                  clipIndex: nextTierIdx + 1,
                  scalingFactor: tierConfig.sizeMult,
                  tradeSizeOverride: tradeSize,
                  mode: executionMode,
                  lockedDirection: this.scalingState.lockedDirection // Pass authoritative lock for invariant check
              }
          );

          if (result.executed || result.simulated) {
              // SUCCESS
              this.currentExposure = result.newExposure;
              this.lastTradeTime = now;
              
              // Update Scaling State
              this.scalingState.clipsPlaced++;
              this.scalingState.lastTierLevel = tierConfig.level;
              
              if (!this.scalingState.lockedDirection) {
                  this.scalingState.lockedDirection = obs.direction;
                  // RECORD ENTRY METADATA for Defensive Checks
                  this.scalingState.entryRegime = obs.regime;
                  this.scalingState.entryConfidence = obs.confidence;

                  Logger.info(`[SCALING] DIRECTION LOCKED: ${obs.direction} (Regime: ${obs.regime})`);
              }
              
              Logger.info(`[SCALING] Executed Clip #${this.scalingState.clipsPlaced} (Tier ${tierConfig.level})`);
          } else if (executionMode === 'PASSIVE') {
             Logger.info(`[SCALING] Passive Attempt Missed/Skipped. Waiting for next tick.`);
          }
      } else {
          // Optional: Debug Log for "Almost there"
          if (obs.confidence >= tierConfig.minConf && Math.random() < 0.05) {
              Logger.info(`[SCALING] Tier ${tierConfig.level} pending persistence (${validSamples.length}/${tierConfig.persistenceSamples})...`);
          }
      }
  }
}
