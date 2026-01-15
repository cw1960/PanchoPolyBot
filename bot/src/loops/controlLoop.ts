import { supabase, logEvent } from '../services/supabase';
import { MarketRegistry } from '../services/marketRegistry';
import { Logger } from '../utils/logger';
import { ENV } from '../config/env';
import { BotControl, Market, TestRun } from '../types/tables';
import { marketRotator } from '../services/marketRotator';

export class ControlLoop {
  private registry: MarketRegistry;
  private isRunning: boolean = false;

  constructor(registry: MarketRegistry) {
    this.registry = registry;
  }

  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    Logger.info("Starting Control Loop (Single-Market Autonomous Mode)...");

    const poll = async () => {
      if (!this.isRunning) return;
      await this.tick();
      setTimeout(poll, ENV.POLL_INTERVAL_MS);
    };
    poll();
  }

  public stop() {
    this.isRunning = false;
    this.registry.stopAll();
  }

  private async tick() {
    try {
      // 1. Fetch Global Control State
      const { data: controlData, error: controlError } = await supabase
        .from('bot_control')
        .select('*')
        .eq('id', 1)
        .single();

      if (controlError || !controlData) {
        Logger.error("Failed to fetch bot_control", controlError);
        return;
      }

      const desiredState = (controlData as BotControl).desired_state;

      // 2. STOPPED STATE
      if (desiredState === 'stopped') {
        if (this.registry.getActiveCount() > 0) {
          Logger.info("Command received: STOP. Shutting down markets.");
          await logEvent('WARN', 'Global Stop Command Received');
          this.registry.stopAll();
        }
        return;
      }

      // 3. RUNNING STATE: Enforce Single Active Market
      if (desiredState === 'running') {
        
        // A. Rotate/Ensure Active Market
        // This function guarantees DB has exactly one enabled BTC market (the current one)
        await marketRotator.ensureCurrentMarket();

        // B. Fetch Enabled Market from DB
        const { data: marketsData, error: marketsError } = await supabase
          .from('markets')
          .select('*')
          .eq('enabled', true);

        if (marketsError || !marketsData) {
          Logger.error("Failed to fetch markets", marketsError);
          return;
        }

        // C. Fetch The "Global" Configuration Run
        // We now use a single persistent run config for the auto-bot
        const { data: globalRun } = await supabase
            .from('test_runs')
            .select('*')
            .eq('name', 'AUTO_TRADER_GLOBAL_CONFIG')
            .single();

        if (!globalRun) {
            Logger.warn("Global Config Run not found. Waiting for initialization...");
            return;
        }

        // D. Hydrate Market with Global Config
        const enrichedMarkets = marketsData.map(m => ({
            ...m,
            active_run_id: globalRun.id,
            _run: globalRun
        }));

        // E. Sync Registry (Starts/Stops loops)
        await this.registry.sync(enrichedMarkets as Market[]);
      }

    } catch (err) {
      Logger.error("Control Loop Crash", err);
    }
  }
}
