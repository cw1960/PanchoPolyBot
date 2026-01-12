
import { supabase } from './supabase';
import { Logger } from '../utils/logger';
import { GoogleGenAI } from "@google/genai";
import { ENV } from '../config/env';

export interface ConfidenceBucketStat {
  confidence_bucket: string;
  trades: number;
  realized_pnl: number;
  win_rate: number;
}

export interface ExitAnalysisStat {
  type: 'DEFENSIVE' | 'EXPIRY' | 'MANUAL';
  trade_count: number;
  total_pnl: number;
  win_rate: number;
  avg_pnl: number;
  avg_time_remaining_min?: number; // Only relevant for defensive
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
  exit_stats?: ExitAnalysisStat[];
  regime_stats?: any[]; 
}

export class AnalysisService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: ENV.API_KEY });
  }

  /**
   * Orchestrates the fetching of data and the generation of the AI report.
   */
  public async produceAiReport(runId: string): Promise<string | null> {
    if (!ENV.API_KEY) {
        Logger.error("[ANALYSIS] Missing API_KEY. Cannot generate AI report.");
        return "Error: API Key missing in environment configuration.";
    }

    const reportData = await this.generateRunAnalysis(runId);
    if (!reportData) return "Error: No data found for this run.";

    const prompt = `
    ROLE:
    You are a junior quantitative trading analyst tasked with reviewing completed experimental results.
    
    TASK:
    Analyze the provided experimental results JSON.
    Produce a structured, factual Markdown report.
    
    CONSTRAINTS:
    - Base conclusions ONLY on the provided metrics.
    - No emojis.
    - No motivational language.
    - No trading advice.
    - Explicitly state if data is insufficient for a section.
    - Reference numbers, counts, or percentages for every claim.
    
    INPUT DATA:
    ${JSON.stringify(reportData, null, 2)}
    
    REQUIRED SECTIONS:
    1. Executive Summary (Data-Bound, 1 paragraph)
    2. Confidence Analysis (Profitability by bucket, concentration)
    3. Exit Analysis (Critical: Compare Defensive Exits vs Expiry. Did defensive exits save money?)
    4. Regime Sensitivity (Performance by regime)
    5. Hypotheses (Max 3, clearly labeled "Hypothesis: ...")
    6. Data Gaps & Limitations
    `;

    try {
        const response = await this.ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
            config: {
                temperature: 0.1, // High precision/factual
            }
        });
        return response.text || "No response generated.";
    } catch (err: any) {
        Logger.error(`[ANALYSIS] AI Generation Error`, err);
        return `Error generating report: ${err.message}`;
    }
  }

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

    // 4. EXIT ANALYSIS (Defensive vs Expiry)
    const exitStats: ExitAnalysisStat[] = [];
    
    // Identify defensive trades by presence of 'exit_reason' in metadata
    // Identify expiry trades by 'settlement_reason' === 'EXPIRY'
    const defensiveTrades = trades.filter(t => t.metadata?.exit_reason);
    const expiryTrades = trades.filter(t => t.metadata?.settlement_reason === 'EXPIRY');
    
    const calcExitStats = (subset: any[], type: 'DEFENSIVE' | 'EXPIRY'): ExitAnalysisStat | null => {
        if (subset.length === 0) return null;
        const subTotal = subset.reduce((sum, t) => sum + (t.realized_pnl || 0), 0);
        const subWins = subset.filter(t => (t.realized_pnl || 0) > 0).length;
        
        let avgTimeRemaining = 0;
        if (type === 'DEFENSIVE') {
            const sumTime = subset.reduce((acc, t) => acc + (t.metadata?.exit_details?.timeRemaining || 0), 0);
            avgTimeRemaining = (sumTime / subset.length) / 60000; // Minutes
        }

        return {
            type,
            trade_count: subset.length,
            total_pnl: parseFloat(subTotal.toFixed(2)),
            win_rate: parseFloat((subWins / subset.length).toFixed(2)),
            avg_pnl: parseFloat((subTotal / subset.length).toFixed(2)),
            avg_time_remaining_min: type === 'DEFENSIVE' ? parseFloat(avgTimeRemaining.toFixed(1)) : undefined
        };
    };

    const defStat = calcExitStats(defensiveTrades, 'DEFENSIVE');
    if (defStat) exitStats.push(defStat);
    
    const expStat = calcExitStats(expiryTrades, 'EXPIRY');
    if (expStat) exitStats.push(expStat);

    // 5. (Optional) Regime Stats
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
        exit_stats: exitStats,
        regime_stats
    };
  }

  private initStat() {
      return { trades: 0, pnl: 0, wins: 0 };
  }
}

export const analysisService = new AnalysisService();
