
import { Market } from '../types/tables';
import { ChainlinkService } from './chainlink';
import { SpotPriceService } from './spotPrices';
import { MarketObservation } from '../types/marketEdge';
import { Logger } from '../utils/logger';
import { polymarket } from './polymarket';
import axios from 'axios';

export class EdgeEngine {
  private chainlink: ChainlinkService;
  private spot: SpotPriceService;
  
  // Risk Config
  private readonly NO_TRADE_ZONE_MS = 2 * 60 * 1000; // 2 Minutes before expiry
  private readonly MIN_VOL_PER_MIN = 0.001; // 0.1% per minute minimum volatility assumption

  constructor() {
    this.chainlink = new ChainlinkService();
    this.spot = new SpotPriceService();
  }

  /**
   * Hydrates market with metadata.
   * STRICT: If baseline cannot be found, we do not enable the market.
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
                return false; // Metadata is critical
            }
        }

        // 2. Fetch Baseline (Binance Candle Open at t_open)
        if (market.t_open && !market.baseline_price) {
            const startMs = new Date(market.t_open).getTime();
            const sym = market.asset === 'ETH' ? 'ETHUSDT' : 'BTCUSDT';
            
            // Fetch 1 minute candle exactly at start time
            const url = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1m&startTime=${startMs}&limit=1`;
            const res = await axios.get(url, { timeout: 3000 });
            
            if (res.data && res.data.length > 0) {
                const candle = res.data[0];
                const candleOpenTime = candle[0];
                // Sanity Check: Is the candle within 1 minute of requested time?
                if (Math.abs(candleOpenTime - startMs) < 60000) {
                    market.baseline_price = parseFloat(candle[1]); // Open Price
                    Logger.info(`[HYDRATE] ${market.polymarket_market_id} Baseline Set: $${market.baseline_price} @ ${new Date(startMs).toISOString()}`);
                } else {
                    Logger.warn(`[HYDRATE] Baseline timestamp mismatch for ${market.polymarket_market_id}. Wanted ${startMs}, got ${candleOpenTime}`);
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

  public async observe(market: Market): Promise<MarketObservation | null> {
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

    // 4. Delta (Spot vs Baseline)
    // NOTE: For 15m markets, we compare against baseline. 
    // For standard markets, we might default to oracle, but here we assume 15m structure.
    const baseline = market.baseline_price; 
    const delta = spotPrice - baseline;
    const direction = delta > 0 ? 'UP' : 'DOWN';

    // 5. Log-Normal Probability Model
    // Z = ln(S / K) / (sigma * sqrt(T))
    let calculatedProbability = 0.5;
    let sigmaUsed = 0;
    
    if (timeRemaining > 0) {
        const minutesLeft = Math.max(timeRemaining / 60000, 0.1); // Clamp to 0.1m to avoid div0
        
        // Volatility Estimation
        // Ideally dynamic, but for V3.1 we use a fixed high-freq assumption
        // 0.1% per minute is roughly BTC standard deviation in active hours
        sigmaUsed = this.MIN_VOL_PER_MIN; 
        const stdDevToExpiry = sigmaUsed * Math.sqrt(minutesLeft);
        
        // Log Return Distance
        // ln(100500 / 100000) ~= 0.0049
        const logReturn = Math.log(spotPrice / baseline);
        
        // Z-Score
        const z = logReturn / stdDevToExpiry;
        
        calculatedProbability = this.getNormalCDF(z);
    }

    // 6. Implied Probability (Market Consensus)
    let impliedProbability = 0;
    const tokens = await polymarket.getTokens(market.polymarket_market_id);
    if (tokens) {
        const tokenId = direction === 'UP' ? tokens.up : tokens.down;
        const ask = await polymarket.getOrderBookAsk(tokenId);
        // If ask is undefined, we assume market is inefficient or empty (0 prob is risky but functional for comparison)
        if (ask) impliedProbability = ask;
    }

    // 7. Confidence = Mapping Model Prob to 0-1 Confidence for Execution
    // We map 50-100% prob to 0-100% confidence linearly for the requested side
    const rawConf = direction === 'UP' ? calculatedProbability : (1 - calculatedProbability);
    // Normalize: 0.5 -> 0, 1.0 -> 1.0
    const confidence = Math.max(0, (rawConf - 0.5) * 2);

    return {
      chainlink: { price: clData.price, timestamp: clData.timestamp, source: 'Chainlink' },
      spot: { price: spotPrice, timestamp: now, source: 'Median' },
      delta,
      direction,
      confidence, 
      timestamp: now,
      calculatedProbability, // The true Model Probability (0-1)
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
