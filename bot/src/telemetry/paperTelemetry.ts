
import { supabase } from '../services/supabase';
import { Logger } from '../utils/logger';

export interface PaperActionPayload {
  asset: string;
  marketId: string;
  polymarketId: string;
  side: 'UP' | 'DOWN';
  action: 'ENTER' | 'EXIT' | 'SCALE';
  intendedOrder: {
    type: 'MARKET' | 'LIMIT';
    price: number;
    size: number;
    isMaker?: boolean;
  };
  oracle: {
    price: number;
    timestamp: number;
    age: number;
    source: string;
  };
  confidence: number;
  reason: string;
  runId?: string;
}

export async function logPaperAction(payload: PaperActionPayload) {
  Logger.info(`[PAPER_TELEMETRY] ${payload.action} ${payload.side} on ${payload.asset}`, {
      price: payload.intendedOrder.price,
      size: payload.intendedOrder.size
  });

  try {
      await supabase.from('trade_events').insert({
          test_run_id: payload.runId,
          market_id: payload.marketId,
          polymarket_market_id: payload.polymarketId,
          asset: payload.asset,
          side: payload.side,
          stake_usd: payload.intendedOrder.size * payload.intendedOrder.price, // Approx USD
          entry_prob: payload.intendedOrder.price,
          confidence: payload.confidence,
          decision_reason: payload.reason,
          status: 'PAPER_INTENT',
          signals: payload.oracle,
          context: {
              mode: 'PAPER',
              intendedOrder: payload.intendedOrder,
              action: payload.action
          }
      });
  } catch (err) {
      Logger.error(`[PAPER_TELEMETRY] Failed to write log`, err);
  }
}
