
import { supabase, logEvent } from '../services/supabase';
import { MarketRegistry } from '../services/marketRegistry';
import { Logger } from '../utils/logger';
import { ENV } from '../config/env';
import { BotControl, Market, TestRun } from '../types/tables';
import { MarketRotator } from '../services/marketRotator';

export class ControlLoop {
  private registry: MarketRegistry;
  private rotator: MarketRotator;
  private isRunning: boolean = false;

  constructor(registry: MarketRegistry) {
    this.registry = registry;
    this.rotator = new MarketRotator();
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
      // 0. Auto-Rotation Check (Runs independent of global stop, but respects config)
      // Actually, if bot is globally stopped, we probably shouldn't rotate new markets in.
      
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
        
        // --- AUTO ROTATION INJECTION ---
        // We run the rotator here to ensure it keeps the DB populated with the active market
        await this.rotator.tick();

        // 3. Fetch Active Markets
        const { data: marketsData, error: marketsError } = await supabase
          .from('markets')
          .select('*')
          .eq('enabled', true);

        if (marketsError || !marketsData) {
          Logger.error("Failed to fetch markets", marketsError);
          return;
        }
        
        const markets = marketsData as Market[];

        // 4. Fetch Active Experiment Configs (Test Runs)
        const activeRunIds = markets
            .map(m => m.active_run_id)
            .filter((id): id is string => !!id); // Filter nulls and ensure type safety
        
        let runMap = new Map<string, TestRun>();
        
        if (activeRunIds.length > 0) {
           const { data: runs, error: runsError } = await supabase
            .from('test_runs')
            .select('*')
            .in('id', activeRunIds);
            
           if (runsError) {
             Logger.error("Failed to fetch test runs", runsError);
           }
           
           if (runs) {
              runs.forEach(r => runMap.set(r.id, r as TestRun));
           }
        }

        // 5. Enrich Market Objects with Run Data
        const enrichedMarkets = markets.map(m => {
            if (m.active_run_id) {
                if (runMap.has(m.active_run_id)) {
                    // Success: Found the run config
                    return { ...m, _run: runMap.get(m.active_run_id) };
                } else {
                    // Warn: Market has run_id but run not found (deleted? error?)
                    Logger.warn(`[CONTROL] Market ${m.asset} linked to missing Run ID: ${m.active_run_id}`);
                }
            }
            return m;
        });

        // 6. Sync Registry
        await this.registry.sync(enrichedMarkets);
      }

    } catch (err) {
      Logger.error("Control Loop Crash", err);
    }
  }
}
