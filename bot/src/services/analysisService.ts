
import { supabase } from './supabase';
import { Logger } from '../utils/logger';

export interface ConfidenceBucketStat {
  confidence_bucket: string;
  trades: number;
  realized_pnl: number;
  win_rate: number;
}

export interface RunSummary {
  run_id: string;
  mode: string;
  markets_traded: number;
  total_trades: number;
  realized_pnl: number;
  win_rate: number;
  avg_trade_pnl: number;
  max_drawdown?: number; // Optional, complex to calc in one pass
}

export interface AnalysisReport {
  summary: RunSummary;
  confidence_buckets: ConfidenceBucketStat[];
  regime_stats?: any[]; 
}

export class AnalysisService {

  /**
   * Generates a full structured report for a completed/expired Run.
   * This payload matches the Input Data Contract for the AI Assistant.
   */
  public async generateRunAnalysis(runId: string): Promise<AnalysisReport | null> {
    
    // 1. Fetch ALL settled trades for this run
    const { data: trades, error } = await supabase
        .from('trade_ledger')
        .select('*')
        .eq('run_id', runId)
        .eq('status', 'CLOSED');

    if (error || !trades || trades.length === 0) {
        Logger.warn(`[ANALYSIS] No settled trades found for run ${runId}`);
        return null;
    }

    // 2. Calculate Global Summary
    const uniqueMarkets = new Set(trades.map(t => t.market_id));
    const totalPnl = trades.reduce((sum, t) => sum + (t.realized_pnl || 0), 0);
    const wins = trades.filter(t => (t.realized_pnl || 0) > 0).length;
    
    const summary: RunSummary = {
        run_id: runId,
        mode: trades[0].mode,
        markets_traded: uniqueMarkets.size,
        total_trades: trades.length,
        realized_pnl: parseFloat(totalPnl.toFixed(2)),
        win_rate: parseFloat((wins / trades.length).toFixed(2)),
        avg_trade_pnl: parseFloat((totalPnl / trades.length).toFixed(2))
    };

    // 3. Calculate Confidence Buckets
    // Buckets: 0.50-0.60, 0.60-0.70, 0.70-0.80, 0.80-0.90, 0.90-1.00
    // Note: Confidence is stored in metadata.confidence
    const buckets = [
        { label: '0.50-0.60', min: 0.50, max: 0.60, stats: this.initStat() },
        { label: '0.60-0.70', min: 0.60, max: 0.70, stats: this.initStat() },
        { label: '0.70-0.80', min: 0.70, max: 0.80, stats: this.initStat() },
        { label: '0.80-0.90', min: 0.80, max: 0.90, stats: this.initStat() },
        { label: '0.90+',     min: 0.90, max: 1.01, stats: this.initStat() }, // Max 1.01 to include 1.0
    ];

    for (const trade of trades) {
        const conf = trade.metadata?.confidence;
        if (typeof conf !== 'number') continue; // Skip if missing

        const pnl = trade.realized_pnl || 0;
        const isWin = pnl > 0;

        // Find bucket
        const bucket = buckets.find(b => conf >= b.min && conf < b.max);
        if (bucket) {
            bucket.stats.trades++;
            bucket.stats.pnl += pnl;
            if (isWin) bucket.stats.wins++;
        }
    }

    // Format Bucket Output
    const confidence_buckets: ConfidenceBucketStat[] = buckets.map(b => ({
        confidence_bucket: b.label,
        trades: b.stats.trades,
        realized_pnl: parseFloat(b.stats.pnl.toFixed(2)),
        win_rate: b.stats.trades > 0 ? parseFloat((b.stats.wins / b.stats.trades).toFixed(2)) : 0
    })).filter(b => b.trades > 0); // Only return active buckets

    // 4. (Optional) Regime Stats
    // Aggregates by regime tag ('LOW_VOL', 'NORMAL', 'HIGH_VOL')
    const regimeMap = new Map<string, { trades: number, pnl: number, wins: number }>();
    
    for (const trade of trades) {
        const regime = trade.metadata?.regime || 'UNKNOWN';
        
        if (!regimeMap.has(regime)) regimeMap.set(regime, { trades: 0, pnl: 0, wins: 0 });
        const stat = regimeMap.get(regime)!;
        
        stat.trades++;
        stat.pnl += (trade.realized_pnl || 0);
        if ((trade.realized_pnl || 0) > 0) stat.wins++;
    }

    const regime_stats = Array.from(regimeMap.entries()).map(([regime, stat]) => ({
        regime,
        trades: stat.trades,
        realized_pnl: parseFloat(stat.pnl.toFixed(2)),
        win_rate: stat.trades > 0 ? parseFloat((stat.wins / stat.trades).toFixed(2)) : 0
    }));

    Logger.info(`[ANALYSIS] Generated Report for ${runId}. PnL: $${summary.realized_pnl}`);

    return {
        summary,
        confidence_buckets,
        regime_stats
    };
  }

  private initStat() {
      return { trades: 0, pnl: 0, wins: 0 };
  }
}

export const analysisService = new AnalysisService();
