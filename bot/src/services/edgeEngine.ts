
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
  private readonly MIN_VOLATILITY = 0.002; // Floor volatility

  constructor() {
    this.chainlink = new ChainlinkService();
    this.spot = new SpotPriceService();
  }

  /**
   * Ensures the market has runtime metadata (t_open, baseline).
   * Populates it via API if missing.
   */
  public async hydrateMarket(market: Market): Promise<void> {
    if (market.t_open && market.baseline_price) return;

    // 1. Fetch Times
    if (!market.t_open || !market.t_expiry) {
        const meta = await polymarket.getMarketMetadata(market.polymarket_market_id);
        if (meta) {
            market.t_open = meta.startDate;
            market.t_expiry = meta.endDate;
        }
    }

    // 2. Fetch Baseline (Spot Price at Start Time)
    if (market.t_open && !market.baseline_price) {
        const startMs = new Date(market.t_open).getTime();
        // Use Binance History
        const sym = market.asset === 'ETH' ? 'ETHUSDT' : 'BTCUSDT';
        try {
            const url = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1m&startTime=${startMs}&limit=1`;
            const res = await axios.get(url, { timeout: 3000 });
            if (res.data && res.data.length > 0) {
                market.baseline_price = parseFloat(res.data[0][1]); // Open price of candle
                Logger.info(`[HYDRATE] ${market.polymarket_market_id} Baseline: $${market.baseline_price}`);
            }
        } catch (e) {
            Logger.warn(`Failed to fetch baseline for ${market.polymarket_market_id}`);
        }
    }
  }

  public async observe(market: Market): Promise<MarketObservation | null> {
    const asset = market.asset || 'BTC'; 
    
    // Ensure Baseline is set
    await this.hydrateMarket(market);

    // 1. Fetch Data
    const [clData, spotPrice] = await Promise.all([
      this.chainlink.getLatestPrice(asset),
      this.spot.getSpotPrice(asset)
    ]);

    if (!clData || !spotPrice) return null;

    const now = Date.now();
    const expiry = market.t_expiry ? new Date(market.t_expiry).getTime() : (now + 3600000); // fallback 1h
    const timeRemaining = expiry - now;

    // 2. Time Gating (No Trade Zone)
    const isSafeToTrade = timeRemaining > this.NO_TRADE_ZONE_MS;

    // 3. Delta Calculation (Spot vs Baseline)
    const referencePrice = market.baseline_price || clData.price; // Fallback to Oracle if no baseline
    const delta = spotPrice - referencePrice;
    
    // 4. Direction
    const direction = delta > 0 ? 'UP' : 'DOWN';

    // 5. Probabilistic Confidence Model
    // P(Spot > Baseline at Expiry) assuming Brownian Motion
    // Z = (ln(S/K) + (r - 0.5*sigma^2)T) / (sigma * sqrt(T))
    // Simplified Linear Approximation for High Frequency:
    // We treat it as distance / volatility_over_time
    
    let calculatedProbability = 0.5;
    
    if (timeRemaining > 0) {
        const minutesLeft = timeRemaining / 60000;
        // Volatility scaler: Price moves ~0.1% per minute roughly on high vol? 
        // We use a dynamic scaler. 
        // e.g. BTC $100k, 10 min left. sigma_10m ~ $300. 
        // If delta is $600, we are 2 sigma away -> 97% prob.
        const assumedVolPerMin = referencePrice * 0.001; // 0.1% per minute
        const stdDevAtExpiry = assumedVolPerMin * Math.sqrt(minutesLeft);
        
        // Z-Score
        const z = delta / (stdDevAtExpiry || 1); // Avoid div 0
        calculatedProbability = this.getNormalCDF(z);
    }

    // 6. Implied Probability Check (Order Book)
    let impliedProbability = 0;
    const tokens = await polymarket.getTokens(market.polymarket_market_id);
    if (tokens) {
        const tokenId = direction === 'UP' ? tokens.up : tokens.down;
        const ask = await polymarket.getOrderBookAsk(tokenId);
        if (ask) impliedProbability = ask;
    }

    // 7. Edge Confidence
    // Our Confidence is how sure we are that our Model > Market
    // If Model says 90% and Market says 60%, we have edge.
    // We stick to the prompt's request: "Replace Spot–Oracle confidence...".
    // We map calculatedProbability directly to confidence for the ExecutionService, 
    // but weighted by how far it is from 50%.
    const confidence = Math.abs(calculatedProbability - 0.5) * 2; // Map 0.5->0, 1.0->1.0

    return {
      chainlink: { price: clData.price, timestamp: clData.timestamp, source: 'Chainlink Oracle' },
      spot: { price: spotPrice, timestamp: now, source: 'Spot Median' },
      delta,
      direction,
      confidence, // Scaled 0-1 magnitude
      timestamp: now,
      calculatedProbability,
      impliedProbability,
      timeToExpiryMs: timeRemaining,
      isSafeToTrade
    };
  }

  // Standard Normal CDF Approximation
  private getNormalCDF(x: number): number {
    const t = 1 / (1 + .2316419 * Math.abs(x));
    const d = .3989423 * Math.exp(-x * x / 2);
    let prob = d * t * (.3193815 + t * (-.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    if (x > 0) prob = 1 - prob;
    return prob;
  }
}
