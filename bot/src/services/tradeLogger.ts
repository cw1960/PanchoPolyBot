
import { supabase } from './supabase';
import { Logger } from '../utils/logger';
import { TradeEventRow } from '../types/tables';
import { ENV } from '../config/env';

/**
 * TradeLogger
 * Responsibilities:
 * 1. Asynchronously log every decision (SKIP or EXECUTE) to Supabase.
 * 2. Attach the current active TEST_RUN_ID if present in ENV.
 * 3. Fail silently/gracefully to not block trading loops.
 */
export class TradeLogger {
  
  private static testRunId: string | undefined = process.env.BOT_TEST_RUN_ID;

  /**
   * Logs a trade event (Decision) to the database.
   */
  public static async log(event: TradeEventRow) {
    // Attach Test Run ID if we are in a managed experiment
    if (this.testRunId) {
      event.test_run_id = this.testRunId;
    }

    // Fire and forget (don't await strictly in the main loop, but catch errors)
    Promise.resolve().then(async () => {
      try {
        const { error } = await supabase.from('trade_events').insert(event);
        if (error) {
           Logger.error('TradeLogger: Failed to insert event', error);
        }
      } catch (err) {
        Logger.error('TradeLogger: Unexpected error', err);
      }
    });
  }

  /**
   * Refreshes the Test Run ID from env (useful if process doesn't restart but config reloads)
   */
  public static refreshConfig() {
    this.testRunId = process.env.BOT_TEST_RUN_ID;
    if (this.testRunId) {
        Logger.info(`TradeLogger: Attached to Test Run ${this.testRunId}`);
    }
  }
}
