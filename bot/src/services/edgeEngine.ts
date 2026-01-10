
import { Market } from '../types/tables';
import { ChainlinkService } from './chainlink';
import { SpotPriceService } from './spotPrices';
import { MarketObservation } from '../types/marketEdge';
import { Logger } from '../utils/logger';
import { polymarket } from './polymarket';

export class EdgeEngine {
  private chainlink: ChainlinkService;
  private spot: SpotPriceService;
  
  // Risk Config
  private readonly NO_TRADE_ZONE_MS = 2 * 60 * 1000; 
  // Safety Clips for Realized Volatility
  private readonly MIN_REALIZED_VOL = 0.0005; // 0.05% per min
  private readonly MAX_REALIZED_VOL = 0.02;   // 2.0% per min (Panic mode clip)

  constructor() {
    this.chainlink = new ChainlinkService();
    this.spot = new SpotPriceService();
  }

  /**
   * Hydrates market with metadata.
   * STRICT: Uses nearest trade tick logic (1-2s tolerance)
   */
  public async hydrateMarket(market: Market): Promise<boolean> {
    if (market.t_open && market.baseline_price) return true;

    try {
        // 1. Fetch Times
        if (!market.t_open || !market.t_expiry) {
            const meta = await polymarket.getMarketMetadata(market.polymarket_market_id);
            if (meta) {
                market.t_open = meta.startDate;
                market.t_expiry = meta.endDate;
            } else {
                return false; 
            }
        }

        // 2. Fetch Baseline (Nearest Trade via AggTrades)
        if (market.t_open && !market.baseline_price) {
            const startMs = new Date(market.t_open).getTime();
            
            // Get trade at or immediately after t_open
            const trade = await this.spot.getHistoricalTrade(market.asset, startMs);
            
            if (trade) {
                // Precision Check: Must be within 2000ms of t_open
                const diff = Math.abs(trade.time - startMs);
                if (diff <= 2000) {
                    market.baseline_price = trade.price;
                    Logger.info(`[HYDRATE] ${market.polymarket_market_id} Baseline: $${market.baseline_price} (Delta: ${diff}ms)`);
                } else {
                    Logger.warn(`[HYDRATE] Baseline trade too far: ${diff}ms > 2000ms. Waiting for closer match.`);
                    return false; 
                }
            } else {
                return false;
            }
        }
        return true;
    } catch (e) {
        Logger.warn(`[HYDRATE] Failed to hydrate ${market.polymarket_market_id}`, e);
        return false;
    }
  }

  public async observe(
      market: Market, 
      priceHistory: { price: number, time: number }[],
      targetTradeSize: number = 10
  ): Promise<MarketObservation | null> {
    
    // 1. Ensure Hydration
    const isReady = await this.hydrateMarket(market);
    if (!isReady || !market.baseline_price || !market.t_expiry) return null;

    const asset = market.asset || 'BTC'; 
    const now = Date.now();
    
    // 2. Fetch Live Data
    const [clData, spotPrice] = await Promise.all([
      this.chainlink.getLatestPrice(asset),
      this.spot.getSpotPrice(asset)
    ]);

    if (!clData || !spotPrice) return null;

    const expiryMs = new Date(market.t_expiry).getTime();
    const timeRemaining = expiryMs - now;

    // 3. Time Gating
    const isSafeToTrade = timeRemaining > this.NO_TRADE_ZONE_MS;

    // 4. Delta 
    const baseline = market.baseline_price; 
    const delta = spotPrice - baseline;
    const direction = delta > 0 ? 'UP' : 'DOWN';

    // 5. Realized Volatility Calculation (Rolling Window)
    let realizedVolPerMin = this.MIN_REALIZED_VOL;
    
    if (priceHistory.length > 5) {
        // Calculate Log Returns
        const returns: number[] = [];
        for (let i = 1; i < priceHistory.length; i++) {
             // ln(Pt / Pt-1)
             const r = Math.log(priceHistory[i].price / priceHistory[i-1].price);
             returns.push(r);
        }

        if (returns.length > 1) {
            // Standard Deviation of Returns
            const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
            const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
            const sdTick = Math.sqrt(variance);
            
            // Annualize to Minute (Assuming roughly 1 tick per sec? No, use timestamps)
            // Average time delta
            const totalTime = priceHistory[priceHistory.length-1].time - priceHistory[0].time;
            const avgTimeStepSec = (totalTime / 1000) / returns.length;
            
            if (avgTimeStepSec > 0) {
                 // Scale SD to 60 seconds
                 const ticksPerMin = 60 / avgTimeStepSec;
                 realizedVolPerMin = sdTick * Math.sqrt(ticksPerMin);
            }
        }
    }
    
    // Clamp Vol
    realizedVolPerMin = Math.max(this.MIN_REALIZED_VOL, Math.min(this.MAX_REALIZED_VOL, realizedVolPerMin));

    // 6. Probability Model (Z-Score with Realized Vol)
    let calculatedProbability = 0.5;
    
    if (timeRemaining > 0) {
        const minutesLeft = Math.max(timeRemaining / 60000, 0.1); 
        const stdDevToExpiry = realizedVolPerMin * Math.sqrt(minutesLeft);
        
        // Log Return Distance
        const logReturn = Math.log(spotPrice / baseline);
        
        // Z-Score
        const z = logReturn / stdDevToExpiry;
        
        calculatedProbability = this.getNormalCDF(z);
    }

    // 7. Implied Probability (VWAP of Order Book)
    let impliedProbability = 0;
    const tokens = await polymarket.getTokens(market.polymarket_market_id);
    if (tokens) {
        const tokenId = direction === 'UP' ? tokens.up : tokens.down;
        // Use VWAP for liquidity guard
        const vwapAsk = await polymarket.getVWAPAsk(tokenId, targetTradeSize);
        if (vwapAsk) impliedProbability = vwapAsk;
    }

    // 8. Confidence Mapping
    const rawConf = direction === 'UP' ? calculatedProbability : (1 - calculatedProbability);
    const confidence = Math.max(0, (rawConf - 0.5) * 2);

    return {
      chainlink: { price: clData.price, timestamp: clData.timestamp, source: 'Chainlink' },
      spot: { price: spotPrice, timestamp: now, source: 'Median' },
      delta,
      direction,
      confidence, 
      timestamp: now,
      calculatedProbability, 
      impliedProbability,
      timeToExpiryMs: timeRemaining,
      isSafeToTrade
    };
  }

  private getNormalCDF(x: number): number {
    const t = 1 / (1 + .2316419 * Math.abs(x));
    const d = .3989423 * Math.exp(-x * x / 2);
    let prob = d * t * (.3193815 + t * (-.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    if (x > 0) prob = 1 - prob;
    return prob;
  }
}
