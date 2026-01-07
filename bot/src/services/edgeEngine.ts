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
    const asset = market.asset || 'BTC'; // Default to BTC if undefined
    
    // 1. Fetch Data Concurrently
    const [clData, spotPrice] = await Promise.all([
      this.chainlink.getLatestPrice(asset),
      this.spot.getSpotPrice(asset)
    ]);

    if (!clData || !spotPrice) {
      return null;
    }

    // 2. Calculate Logic
    const delta = spotPrice - clData.price;
    const absDelta = Math.abs(delta);
    let direction: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = 0.0;

    // 3. Determine Edge
    // If Spot is significantly > Chainlink, Chainlink will likely move UP.
    // If Spot is significantly < Chainlink, Chainlink will likely move DOWN.
    
    // Thresholds (Simulated for Step 5 - would be dynamic in production)
    const NOISE_THRESHOLD = market.min_price_delta || 10.0; 
    
    if (absDelta > NOISE_THRESHOLD) {
      direction = delta > 0 ? 'UP' : 'DOWN';
      
      // Heuristic: Confidence scales with deviation
      // e.g. $50 delta = 0.5 confidence, $100 delta = 0.9 confidence (clamped)
      confidence = Math.min(absDelta / 100, 0.99); 
    }

    return {
      chainlink: { price: clData.price, timestamp: clData.timestamp, source: 'Chainlink' },
      spot: { price: spotPrice, timestamp: Date.now(), source: 'Median(Binance,Coinbase)' },
      delta,
      direction,
      confidence,
      timestamp: Date.now()
    };
  }
}
