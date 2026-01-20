
import { supabase } from './supabase';
import { Logger } from '../utils/logger';
import { BotTickRow, BotMarketRow, BotBankrollRow } from '../types/tables';

export class TelemetryService {
  
  /**
   * Logs a high-frequency tick to Supabase.
   * Fire-and-forget to avoid blocking the loop.
   */
  public logTick(tick: BotTickRow) {
    // Run in background
    Promise.resolve().then(async () => {
      try {
        const { error } = await supabase.from('bot_ticks').insert(tick);
        if (error) {
           // Suppress mostly, but warn occasionally? 
           // Logger.warn('[TELEMETRY] Tick log failed', error);
        }
      } catch (err) {
        // Silent fail
      }
    });
  }

  /**
   * Logs a bankroll snapshot.
   */
  public async logBankroll(snapshot: BotBankrollRow) {
    try {
      await supabase.from('bot_bankroll').insert(snapshot);
    } catch (err) {
      Logger.error('[TELEMETRY] Bankroll log failed', err);
    }
  }

  /**
   * Summarizes a market session upon closure.
   */
  public async logMarketSummary(summary: BotMarketRow) {
    try {
      await supabase.from('bot_markets').upsert(summary);
      Logger.info(`[TELEMETRY] Market Summary Logged: ${summary.slug}`);
    } catch (err) {
      Logger.error('[TELEMETRY] Market summary log failed', err);
    }
  }
}

export const telemetry = new TelemetryService();
