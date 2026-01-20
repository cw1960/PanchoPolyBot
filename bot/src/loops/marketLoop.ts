
import { Market, MarketStateRow, BotTickRow } from '../types/tables';
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
import { telemetry } from '../services/telemetry';
import { feeModel } from '../services/feeModel';
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

  // KELLY LIMITS
  private readonly KELLY_CAP = 0.25; 
  private readonly MIN_TRADE_SIZE_USD = 1.0;

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
          // ORCHESTRATION SUPPORT: If no trades yet, but market config enforces direction, lock it now.
          if (this.market.direction) {
              this.scalingState.lockedDirection = this.market.direction;
              this._immutableAccount = accountManager.getAccount(this.market.asset, this.market.direction);
              Logger.info(`[LOCK_FORCED] Market initialized with pre-set direction: ${this._immutableAccount.marketKey}`);
          } else {
              this.scalingState.lockedDirection = null;
              this._immutableAccount = null;
          }
          
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
    
    // TELEMETRY: MARKET SUMMARY
    this.logMarketClosureSummary();

    if (this.hasExitedDefensively) {
        Logger.info(`[MARKET_TERMINATED] reason=DEFENSIVE_EXIT marketId=${this.market.id}`);
    } else {
        Logger.info(`[MARKET_TERMINATED] marketId=${this.market.id} reason=${reason}`);
    }
  }

  private async logMarketClosureSummary() {
      if (!this._immutableAccount) return;
      
      // Basic PnL stats from account manager
      const acc = this._immutableAccount;
      
      const summary = {
          slug: this.market.polymarket_market_id,
          run_id: this.market.active_run_id,
          start_time: this.market.t_open || new Date().toISOString(),
          end_time: new Date().toISOString(),
          total_pnl_usd: acc.realizedPnL,
          total_fees_usd: 0, // Need to track this separately if required
          trade_count: this.scalingState.clipsPlaced,
          avg_edge_captured: 0, // Placeholder
          max_drawdown_usd: 0, // Placeholder
          regime_tag: this.scalingState.entryRegime || 'UNKNOWN'
      };
      
      await telemetry.logMarketSummary(summary);
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
          return;
      }

      // --- TELEMETRY & KELLY CALCULATION START ---
      
      // 1. Fetch Pair Prices (Approximate)
      let yesPrice = 0;
      let noPrice = 0;
      
      if (observation.orderBook) {
          if (observation.direction === 'UP') {
              yesPrice = observation.orderBook.bestAsk;
              noPrice = 1 - observation.orderBook.bestBid;
          } else if (observation.direction === 'DOWN') {
              noPrice = observation.orderBook.bestAsk;
              yesPrice = 1 - observation.orderBook.bestBid;
          }
      }
      
      const pairCost = yesPrice + noPrice || 1.0;
      const modelProb = observation.calculatedProbability;
      const marketProb = observation.impliedProbability;
      const rawEdge = Math.abs(modelProb - marketProb);
      
      // 2. Metrics (Using default isMaker=false for conservative sizing)
      const metrics = feeModel.calculateMetrics(marketProb, modelProb, 10, false);
      const edgeAfterFees = metrics.edgePct / 100;

      // 3. Kelly Criterion (REFINED)
      // K = Edge / Variance
      const varianceApprox = modelProb * (1 - modelProb);
      let kellyFraction = 0;
      if (varianceApprox > 0.01 && edgeAfterFees > 0) {
          const kRaw = edgeAfterFees / varianceApprox;
          kellyFraction = Math.min(this.KELLY_CAP, Math.max(0, kRaw)); // Cap at 25%
      }
      
      // 4. Sizing
      let bankroll = 500;
      let cap = 100;
      if (this._immutableAccount) {
          bankroll = this._immutableAccount.bankroll;
          cap = this._immutableAccount.maxExposure;
      }
      
      // Basic sizing formula: Bankroll * Kelly. 
      // We still respect maxExposure cap.
      const rawSize = bankroll * kellyFraction;
      const recommendedSize = Math.min(cap, rawSize);

      let signalTag = observation.isSafeToTrade ? 'ACTIVE' : 'WAIT';

      // 5. MISSED OPPORTUNITY LOGIC
      // If we have a valid edge but can't trade due to min size or cooldown
      const cooldownMs = run.params?.cooldown || DEFAULTS.DEFAULT_COOLDOWN_MS;
      const inCooldown = (Date.now() - this.lastTradeTime) < cooldownMs;

      if (observation.isSafeToTrade && edgeAfterFees > 0) {
          if (recommendedSize < this.MIN_TRADE_SIZE_USD) {
              signalTag = 'MISSED_SIZE_TOO_SMALL';
          } else if (inCooldown) {
              signalTag = 'MISSED_COOLDOWN';
          }
      }

      // 6. Log Tick
      telemetry.logTick({
          run_id: run.id,
          market_slug: this.market.polymarket_market_id,
          ts: new Date().toISOString(),
          yes_price: yesPrice,
          no_price: noPrice,
          spread: observation.orderBook?.spread || 0,
          pair_cost: pairCost,
          model_prob: modelProb,
          edge_raw: rawEdge,
          edge_after_fees: edgeAfterFees,
          kelly_fraction: kellyFraction,
          recommended_size_usd: recommendedSize,
          actual_size_usd: 0, // Updated if trade happens
          signal_tag: signalTag,
          regime_tag: observation.regime
      });

      // --- TELEMETRY END ---

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
              this._immutableAccount = accountManager.getAccount(this.market.asset, this.scalingState.lockedDirection);
          }
          if (this._immutableAccount.direction !== this.scalingState.lockedDirection) {
               throw new Error(`[INVARIANT_VIOLATION] Locked Direction ${this.scalingState.lockedDirection} mismatch with Account ${this._immutableAccount.direction}`);
          }
          activeAccount = this._immutableAccount;
          currentAccountExposure = activeAccount.currentExposure;
      } else {
          if (observation.direction !== 'NEUTRAL') {
               activeAccount = accountManager.getAccount(this.market.asset, observation.direction);
               currentAccountExposure = activeAccount.currentExposure;
          }
      }

      // 5. DEFENSIVE EXIT EVALUATION
      if (this.scalingState.lockedDirection && activeAccount) {
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
      let tradeOccurred = false;
      let tradeSize = 0;

      if (status !== 'LOCKED') {
          // Enforce min size here as well to prevent dust trades
          if (recommendedSize >= this.MIN_TRADE_SIZE_USD) {
              const tradeRes = await this.evaluateScaling(
                  observation, 
                  cooldownMs, 
                  recommendedSize // Pass dynamic size
              );
              
              if (tradeRes && tradeRes.executed) {
                  tradeOccurred = true;
                  tradeSize = tradeRes.sizeUsd || 0;
              }
          }
          if (this.scalingState.clipsPlaced > 0) status = 'OPPORTUNITY';
      }
      
      // Update Actual Size in Telemetry if Trade Occurred
      if (tradeOccurred) {
          telemetry.logTick({
              run_id: run.id,
              market_slug: this.market.polymarket_market_id,
              ts: new Date().toISOString(),
              yes_price: yesPrice,
              no_price: noPrice,
              spread: observation.orderBook?.spread || 0,
              pair_cost: pairCost,
              model_prob: modelProb,
              edge_raw: rawEdge,
              edge_after_fees: edgeAfterFees,
              kelly_fraction: kellyFraction,
              recommended_size_usd: recommendedSize,
              actual_size_usd: tradeSize,
              signal_tag: 'EXECUTE',
              regime_tag: observation.regime
          });
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

  private async evaluateScaling(obs: any, cooldown: number, dynamicSize: number): Promise<{executed: boolean, sizeUsd?: number} | undefined> {
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
          
          // Refined execution logic: If Spread is WIDE or regime is WIDE_SPREAD, force Passive
          if (obs.regime === 'WIDE_SPREAD' || (obs.orderBook && obs.orderBook.spread > 0.03)) {
              executionMode = 'PASSIVE';
          }

          Logger.info(`[SCALING] Tier ${tierConfig.level} Eligible (Conf=${obs.confidence.toFixed(2)}). Mode: ${executionMode} Size: $${dynamicSize.toFixed(2)}`);
          
          const result = await executionService.attemptTrade(
              this.market, 
              obs, 
              { 
                  tierLevel: tierConfig.level, 
                  clipIndex: nextTierIdx + 1,
                  scalingFactor: tierConfig.sizeMult,
                  tradeSizeOverride: dynamicSize, 
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
              
              return { executed: true, sizeUsd: dynamicSize }; 
          } else if (executionMode === 'PASSIVE') {
             Logger.info(`[SCALING] Passive Attempt Missed/Skipped. Waiting for next tick.`);
          }
      }
      return { executed: false };
  }
}
