
import { MarketObservation } from '../types/marketEdge';
import { Logger } from '../utils/logger';

export interface ExitDecision {
    reason: 'CONFIDENCE_COLLAPSE' | 'REGIME_INVALIDATION' | 'TIME_DECAY';
    confidence: number;
    regime: string;
    timeRemaining: number;
    description: string;
}

export class DefensiveExitEvaluator {
    
    // CONFIGURATION DEFAULTS
    private readonly EXIT_CONFIDENCE_THRESHOLD = 0.45;
    private readonly EXIT_PERSISTENCE_TICKS = 3; // K
    private readonly EXIT_WINDOW_TICKS = 5;      // N
    
    private readonly MIN_TIME_REMAINING_MS = 5 * 60 * 1000; // 5 Minutes
    private readonly REGIME_CONFIDENCE_DROP = 0.15; // Drop required to invalidate if Regime flips

    /**
     * Evaluates if a position should be exited defensively.
     * @param obs Current market observation
     * @param history Recent history of ticks
     * @param entryRegime The volatility regime when the position was first locked
     * @param entryConfidence The confidence level when the position was first locked
     */
    public shouldExit(
        obs: MarketObservation,
        history: { conf: number; dir: string; ts: number }[],
        entryRegime?: string,
        entryConfidence?: number
    ): ExitDecision | null {
        
        // 1. CONFIDENCE COLLAPSE
        // Rule: Confidence < Threshold for K of last N ticks
        // We look at the last N samples in history + current observation
        const recentConfs = history.slice(-this.EXIT_WINDOW_TICKS).map(h => h.conf);
        recentConfs.push(obs.confidence); // Include current

        // Count how many are below threshold
        const lowConfCount = recentConfs.filter(c => c < this.EXIT_CONFIDENCE_THRESHOLD).length;
        
        if (lowConfCount >= this.EXIT_PERSISTENCE_TICKS) {
            return {
                reason: 'CONFIDENCE_COLLAPSE',
                confidence: obs.confidence,
                regime: obs.regime,
                timeRemaining: obs.timeToExpiryMs || 0,
                description: `Confidence < ${this.EXIT_CONFIDENCE_THRESHOLD} for ${lowConfCount}/${recentConfs.length} ticks`
            };
        }

        // 2. REGIME INVALIDATION
        // Rule: Entered in LOW/NORMAL -> Now HIGH_VOL AND Confidence dropped significantly
        if (entryRegime && entryConfidence) {
            const isRegimeWorse = (entryRegime !== 'HIGH_VOL' && obs.regime === 'HIGH_VOL');
            const hasConfidenceDropped = obs.confidence < (entryConfidence - this.REGIME_CONFIDENCE_DROP);

            if (isRegimeWorse && hasConfidenceDropped) {
                return {
                    reason: 'REGIME_INVALIDATION',
                    confidence: obs.confidence,
                    regime: obs.regime,
                    timeRemaining: obs.timeToExpiryMs || 0,
                    description: `Regime flip (${entryRegime}->${obs.regime}) + Conf drop (${entryConfidence.toFixed(2)}->${obs.confidence.toFixed(2)})`
                };
            }
        }

        // 3. TIME-DECAY RISK
        // Rule: Close to expiry (< 5 min) and Confidence is low/decaying
        // This is a safety valve to avoid holding "hopium" into the binary outcome if we aren't sure.
        if (obs.timeToExpiryMs && obs.timeToExpiryMs < this.MIN_TIME_REMAINING_MS) {
            // If confidence is barely above 50/50, get out.
            if (obs.confidence < 0.55) {
                return {
                    reason: 'TIME_DECAY',
                    confidence: obs.confidence,
                    regime: obs.regime,
                    timeRemaining: obs.timeToExpiryMs,
                    description: `Low confidence (${obs.confidence.toFixed(2)}) near expiry (<${(obs.timeToExpiryMs/60000).toFixed(1)}m)`
                };
            }
        }

        return null;
    }
}

export const defensiveExitEvaluator = new DefensiveExitEvaluator();
