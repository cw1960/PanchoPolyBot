
import axios from 'axios';
import { Logger } from '../utils/logger';

export class MarketResolver {
  
  /**
   * Finds the nearest UP/DOWN 15-minute market for the given asset that hasn't started yet (or is just starting).
   * Enforces: Expiry > Now.
   */
  public async resolveNextMarket(asset: string): Promise<{ slug: string, startDate: string, endDate: string } | null> {
    const keyword = this.getSearchKeyword(asset);
    
    // Query active markets for the asset
    const url = `https://gamma-api.polymarket.com/events?active=true&closed=false&keyword=${keyword}&limit=20`;
    
    try {
        const res = await axios.get(url, { timeout: 5000 });
        const now = Date.now();
        const candidates: any[] = [];

        for (const event of res.data) {
            for (const market of event.markets) {
                // 1. Basic Validity
                if (market.closed) continue;
                
                // 2. Times
                const startMs = new Date(market.startDate).getTime();
                const endMs = new Date(market.endDate).getTime();
                
                // CRITICAL SAFETY: Must expire in the future
                if (endMs <= now) continue;

                // 3. Duration Check (Targeting ~15m markets)
                const durationMs = endMs - startMs;
                const is15Min = durationMs >= 10 * 60 * 1000 && durationMs <= 25 * 60 * 1000;
                
                if (!is15Min) continue;

                // 4. Outcomes Check (Binary)
                let isBinary = false;
                try {
                    const outcomes = JSON.parse(market.outcomes);
                    if (outcomes.length === 2) isBinary = true;
                } catch(e) {}
                
                if (isBinary) {
                    candidates.push({
                        slug: market.slug,
                        startDate: market.startDate,
                        endDate: market.endDate,
                        startMs: startMs
                    });
                }
            }
        }

        // Sort by start time (nearest first)
        candidates.sort((a, b) => a.startMs - b.startMs);

        if (candidates.length > 0) {
            const chosen = candidates[0];
            console.log(`[MARKET_RESOLVED] asset=${asset} slug=${chosen.slug} start=${chosen.startDate}`);
            return chosen;
        }
        
    } catch (err: any) {
        Logger.error(`[RESOLVER] Failed to resolve next market for ${asset}`, err.message);
    }
    
    return null;
  }

  private getSearchKeyword(asset: string): string {
      switch(asset.toUpperCase()) {
          case 'BTC': return 'Bitcoin';
          case 'ETH': return 'Ethereum';
          case 'SOL': return 'Solana';
          case 'XRP': return 'Ripple'; // or XRP, depending on Polymarket naming
          default: return asset;
      }
  }
}

export const marketResolver = new MarketResolver();
