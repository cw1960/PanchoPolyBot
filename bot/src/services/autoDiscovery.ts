import axios from 'axios';
import { Logger } from '../utils/logger';

interface DiscoveredMarket {
  slug: string;
  question: string;
  startDate: string;
  endDate: string;
  clobTokenIds: string[];
}

export class AutoDiscoveryService {
  
  /**
   * Finds the single "Bitcoin Up or Down" market that is currently active
   * and expires nearest in the future.
   */
  public async findCurrentBtc15mMarket(): Promise<DiscoveredMarket | null> {
    try {
        // Fetch active Bitcoin events
        const url = `https://gamma-api.polymarket.com/events?active=true&closed=false&keyword=Bitcoin&limit=20`;
        const res = await axios.get(url, { timeout: 5000 });
        
        const now = Date.now();
        const candidates: DiscoveredMarket[] = [];

        for (const event of res.data) {
            for (const market of event.markets) {
                // 1. Strict Name Check
                // Must be the specific 15m binary option format
                const q = market.question;
                if (!q.includes("Bitcoin Up or Down")) continue;
                
                // 2. Binary Check
                if (!market.outcomes || JSON.parse(market.outcomes).length !== 2) continue;
                
                // 3. Time Check
                const endMs = new Date(market.endDate).getTime();
                if (endMs <= now) continue; // Already expired

                candidates.push({
                    slug: market.slug,
                    question: market.question,
                    startDate: market.startDate,
                    endDate: market.endDate,
                    clobTokenIds: JSON.parse(market.clobTokenIds)
                });
            }
        }

        // Sort by expiry ascending (nearest future expiry)
        candidates.sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());

        if (candidates.length > 0) {
            const best = candidates[0];
            Logger.info(`[AUTO_DISCO] Identified Target: ${best.slug} (Expires: ${best.endDate})`);
            return best;
        }

        Logger.warn("[AUTO_DISCO] No valid BTC 15m markets found active.");
        return null;

    } catch (err: any) {
        Logger.error("[AUTO_DISCO] API Error", err.message);
        return null;
    }
  }
}

export const autoDiscovery = new AutoDiscoveryService();
