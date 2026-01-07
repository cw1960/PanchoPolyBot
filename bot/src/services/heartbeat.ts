import { Logger } from '../utils/logger';
import { ENV } from '../config/env';

export class HeartbeatService {
  private intervalId: any | null = null;

  public start(getActiveMarkets: () => number) {
    Logger.info("Starting Heartbeat Service...");
    
    // Heartbeat every 10 seconds
    this.intervalId = setInterval(() => {
      const count = getActiveMarkets();
      Logger.info(`[BOT_HEARTBEAT] ID: ${ENV.BOT_ID} | Active Markets: ${count}`);
    }, 10000);
  }

  public stop() {
    if (this.intervalId) clearInterval(this.intervalId);
  }
}