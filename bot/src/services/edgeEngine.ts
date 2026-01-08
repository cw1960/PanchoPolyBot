import { Market } from '../types/tables';
import { ChainlinkService } from './chainlink';
import { SpotPriceService } from './spotPrices';
import { MarketObservation } from '../types/marketEdge';
import { Logger } from '../utils/logger';

export class EdgeEngine {
  private chainlink: ChainlinkService;
  private spot: SpotPriceService;

  constructor() {
    this.chainlink = new ChainlinkService();
    this.spot = new SpotPriceService();
  }

  public async observe(market: Market): Promise<MarketObservation | null> {
    const asset = market.asset || 'BTC'; // Default to BTC
    
    // 1. Fetch Data Concurrently
    const [clData, spotPrice] = await Promise.all([
      this.chainlink.getLatestPrice(asset),
      this.spot.getSpotPrice(asset)
    ]);

    if (!clData || !spotPrice) {
      return null;
    }

    // 2. Calculate Edge Logic
    const delta = spotPrice - clData.price;
    const absDelta = Math.abs(delta);
    let direction: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = 0.0;

    // Threshold: How much must spot deviate before we consider it "Real" movement?
    const NOISE_THRESHOLD = market.min_price_delta || 10.0; 
    
    if (absDelta > NOISE_THRESHOLD) {
      direction = delta > 0 ? 'UP' : 'DOWN';
      
      // Heuristic: Confidence increases as the delta grows larger than the threshold
      // e.g., if delta is $100 and threshold is $10, we are very confident.
      const excess = absDelta - NOISE_THRESHOLD;
      confidence = Math.min(excess / 50, 0.99); // Max confidence at $50+ excess
    }

    return {
      chainlink: { price: clData.price, timestamp: clData.timestamp, source: 'Chainlink Oracle' },
      spot: { price: spotPrice, timestamp: Date.now(), source: 'Spot Median' },
      delta,
      direction,
      confidence,
      timestamp: Date.now()
    };
  }
}
