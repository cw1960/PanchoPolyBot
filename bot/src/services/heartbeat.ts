
import { Logger } from '../utils/logger';
import { ENV } from '../config/env';
import { supabase } from './supabase';

export class HeartbeatService {
  private intervalId: any | null = null;

  public start(getActiveMarkets: () => number) {
    Logger.info("Starting Heartbeat Service...");
    
    // 1. Send Immediate Pulse (Don't wait 10s)
    this.pulse(getActiveMarkets());
    
    // 2. Start Loop
    this.intervalId = setInterval(async () => {
      this.pulse(getActiveMarkets());
    }, 10000);
  }

  private async pulse(count: number) {
      try {
        await supabase.from('bot_heartbeats').upsert({
          id: ENV.BOT_ID,
          last_seen: new Date().toISOString(),
          active_markets: count,
          status: 'HEALTHY'
        });
        Logger.info(`[BOT_HEARTBEAT] ID: ${ENV.BOT_ID} | Active Markets: ${count}`);
      } catch (e) {
        Logger.error("Failed to write heartbeat", e);
      }
  }

  public stop() {
    if (this.intervalId) clearInterval(this.intervalId);
  }
}
