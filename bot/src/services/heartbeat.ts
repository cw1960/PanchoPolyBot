import { Logger } from '../utils/logger';
import { ENV } from '../config/env';
import { supabase } from './supabase';

export class HeartbeatService {
  private intervalId: any | null = null;

  public start(getActiveMarkets: () => number) {
    Logger.info("Starting Heartbeat Service...");
    
    // Heartbeat every 10 seconds
    this.intervalId = setInterval(async () => {
      const count = getActiveMarkets();
      // Write to DB for UI visibility
      try {
        await supabase.from('bot_heartbeats').upsert({
          id: ENV.BOT_ID,
          last_seen: new Date().toISOString(),
          active_markets: count,
          status: 'HEALTHY'
        });
      } catch (e) {
        Logger.error("Failed to write heartbeat", e);
      }
      
      Logger.info(`[BOT_HEARTBEAT] ID: ${ENV.BOT_ID} | Active Markets: ${count}`);
    }, 10000);
  }

  public stop() {
    if (this.intervalId) clearInterval(this.intervalId);
  }
}
