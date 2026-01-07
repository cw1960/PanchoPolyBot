import { supabase, logEvent } from '../services/supabase';
import { MarketRegistry } from '../services/marketRegistry';
import { Logger } from '../utils/logger';
import { ENV } from '../config/env';
import { BotControl, Market } from '../types/tables';

export class ControlLoop {
  private registry: MarketRegistry;
  private isRunning: boolean = false;

  constructor(registry: MarketRegistry) {
    this.registry = registry;
  }

  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    Logger.info("Starting Control Loop...");

    // Poll loop
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

      // 2. Logic Branch
      if (desiredState === 'stopped') {
        if (this.registry.getActiveCount() > 0) {
          Logger.info("Command received: STOP. Shutting down markets.");
          await logEvent('WARN', 'Global Stop Command Received');
          this.registry.stopAll();
        }
      } else if (desiredState === 'running') {
        // 3. Fetch Active Markets
        const { data: markets, error: marketsError } = await supabase
          .from('markets')
          .select('*')
          .eq('enabled', true);

        if (marketsError) {
          Logger.error("Failed to fetch markets", marketsError);
          return;
        }

        // 4. Sync Registry
        await this.registry.sync(markets as Market[]);
      }

    } catch (err) {
      Logger.error("Control Loop Crash", err);
    }
  }
}
