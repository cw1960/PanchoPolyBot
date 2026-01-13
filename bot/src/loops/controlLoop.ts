
import { supabase, logEvent } from '../services/supabase';
import { MarketRegistry } from '../services/marketRegistry';
import { Logger } from '../utils/logger';
import { ENV } from '../config/env';
import { BotControl, Market, TestRun } from '../types/tables';
import { MarketRotator } from '../services/marketRotator';
import { polymarket } from '../services/polymarket';

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
        await this.rotator.tick();
        
        // --- ORCHESTRATION INJECTION ---
        await this.processLaunchRequests();

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

  private async processLaunchRequests() {
    const { data: requests } = await supabase
      .from('market_launch_requests')
      .select('*')
      .eq('status', 'PENDING');

    if (!requests || requests.length === 0) return;

    Logger.info(`[ORCHESTRATOR] Processing ${requests.length} launch requests...`);

    // Group by asset to minimize API calls
    const assetRequests = new Map<string, typeof requests>();
    for(const r of requests) {
       const key = `${r.asset}-${r.launch_type}`; // e.g. BTC-NEXT_15M
       if(!assetRequests.has(key)) assetRequests.set(key, []);
       assetRequests.get(key)?.push(r);
    }

    for (const [key, group] of assetRequests) {
        // 1. Resolve Market
        const asset = group[0].asset;
        // Calc Expiry for NEXT 15M bucket
        const now = Date.now();
        const bucketDuration = 15 * 60 * 1000;
        
        let nextStart = Math.ceil(now / bucketDuration) * bucketDuration;
        if (nextStart <= now) nextStart += bucketDuration; // Ensure future
        const nextEnd = nextStart + bucketDuration;
        
        const expiryIso = new Date(nextEnd).toISOString();
        const startIso = new Date(nextStart).toISOString();

        Logger.info(`[ORCHESTRATOR] Resolving ${asset} for ${expiryIso}...`);

        const marketData = await polymarket.findMarketForAssetAndExpiry(asset, expiryIso);
        
        if (!marketData) {
             Logger.warn(`[ORCHESTRATOR] No market found for ${asset} ${expiryIso}`);
             await supabase.from('market_launch_requests').update({ status: 'FAILED', error_log: 'Market not found' }).in('id', group.map(r => r.id));
             continue;
        }

        const slug = marketData.slug;

        // 2. Ensure Run Exists
        const runName = `ORCH-${asset}-${new Date(nextStart).toISOString()}`;
        let { data: run } = await supabase.from('test_runs').select('id').eq('name', runName).maybeSingle();
        
        if (!run) {
             const { data: newRun } = await supabase.from('test_runs').insert({
                 name: runName,
                 status: 'RUNNING',
                 params: { direction: 'BOTH', tradeSize: 10, maxExposure: 500 }
             }).select('id').single();
             run = newRun;
        }
        
        if (!run) continue; 

        // 3. Upsert Markets for Requested Directions
        for (const req of group) {
             const { data: mk } = await supabase.from('markets')
                 .select('id')
                 .eq('polymarket_market_id', slug)
                 .eq('direction', req.direction)
                 .maybeSingle();

             if (mk) {
                 await supabase.from('markets').update({
                     enabled: true,
                     active_run_id: run.id,
                     max_exposure: 500
                 }).eq('id', mk.id);
             } else {
                 await supabase.from('markets').insert({
                     polymarket_market_id: slug,
                     asset: asset,
                     direction: req.direction,
                     enabled: true,
                     active_run_id: run.id,
                     max_exposure: 500,
                     t_open: marketData.startDate,
                     t_expiry: marketData.endDate,
                     baseline_price: 0
                 });
             }
             
             // Update request
             await supabase.from('market_launch_requests').update({ status: 'LAUNCHED', target_market_slug: slug }).eq('id', req.id);
        }
    }
  }
}
