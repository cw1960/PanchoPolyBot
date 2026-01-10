
import { validateEnv } from './config/env';
import { ControlLoop } from './loops/controlLoop';
import { MarketRegistry } from './services/marketRegistry';
import { HeartbeatService } from './services/heartbeat';
import { logEvent, supabase } from './services/supabase';
import { Logger } from './utils/logger';

async function main() {
  Logger.info("Booting PolyBot VPS Engine...");

  // 1. Validate Config
  validateEnv();

  // 2. Initialize Services
  const registry = new MarketRegistry();
  const controlLoop = new ControlLoop(registry);
  const heartbeat = new HeartbeatService();

  // 3. Start Lifecycle
  await logEvent('INFO', 'VPS Process Started');
  
  // NOTE: Removed global exposure reset. Exposure is now scoped by run_id in MarketLoop.
  // This allows the bot to restart without wiping state for active runs.
  
  heartbeat.start(() => registry.getActiveCount());
  await controlLoop.start();

  // 4. Handle Shutdown Gracefully
  const shutdown = async () => {
    Logger.info("Shutting down...");
    await logEvent('WARN', 'VPS Process Stopping...');
    controlLoop.stop();
    heartbeat.stop();
    registry.stopAll();
    (process as any).exit(0);
  };

  (process as any).on('SIGINT', shutdown);
  (process as any).on('SIGTERM', shutdown);
}

main().catch(err => {
  Logger.error("Fatal Boot Error", err);
  (process as any).exit(1);
});
