import { Market } from '../types/tables';
import { MarketObservation } from '../types/marketEdge';
import { Logger } from '../utils/logger';
import { polymarket } from './polymarket';
import { supabase } from './supabase';
import { assetFromMarketSlug } from '../utils/assetDerivation';
import { Asset } from '../types/assets';
import { ENV } from '../config/env';

// TYPE-ONLY IMPORTS (Safe in DRY_RUN)
import type { ChainlinkService as ChainlinkServiceType } from './chainlink';
import type { SpotPriceService as SpotPriceServiceType } from './spotPrices';

// Fix for missing types for 'require' in Node environment
declare const require: any;

// --- MOCK IMPLEMENTATIONS (For DRY_RUN) ---
class MockChainlinkService {
  // Updated signature to match Real Service (Asset only)
  public async getLatestPrice(asset: Asset): Promise<{ price: number; timestamp: number } | null> {
      Logger.info(`[DRY_RUN_MOCK] Chainlink fetch for ${asset}`);
      let mockPrice = 45000;
      if (asset === Asset.ETH) mockPrice = 2500;
      if (asset === Asset.SOL) mockPrice = 95;
      if (asset === Asset.XRP) mockPrice = 0.55;
      return { price: mockPrice, timestamp: Date.now() };
  }
}

class MockSpotPriceService {
  public async getSpotPrice(asset: Asset): Promise<number | null> {
      Logger.info(`[DRY_RUN_MOCK] Spot fetch for ${asset}`);
      let mockPrice = 45000;
      if (asset === Asset.ETH) mockPrice = 2500;
      if (asset === Asset.SOL) mockPrice = 95;
      if (asset === Asset.XRP) mockPrice = 0.55;
      return mockPrice;
  }

  public async getHistoricalTrade(asset: Asset, timestampMs: number): Promise<{ price: number, time: number } | null> {
      Logger.info(`[DRY_RUN_MOCK] Historical trade fetch for ${asset}`);
      let mockPrice = 45000;
      if (asset === Asset.ETH) mockPrice = 2500;
      return { price: mockPrice, time: timestampMs };
  }
}
// -------------------------------------------

export class EdgeEngine {
  // Use Type erasure or Interfaces to support both Real and Mock
  private chainlink: ChainlinkServiceType | MockChainlinkService;
  private spot: SpotPriceServiceType | MockSpotPriceService;
  
  // Risk Config
  private readonly NO_TRADE_ZONE_MS = 2 * 60 * 1000; 
  private readonly MIN_REALIZED_VOL = 0.0005; 
  private readonly MAX_REALIZED_VOL = 0.02;   
  private readonly REGIME_LOW_VOL = 0.001;  
  private readonly REGIME_HIGH_VOL = 0.005; 

  constructor() {
    // CONDITIONAL LOADING
    // We CANNOT import the real files if DRY_RUN is true because they will throw FATAL errors.
    if (ENV.DRY_RUN) {
        Logger.info("[EDGE] Initializing in DRY_RUN mode with MOCKS.");
        this.chainlink = new MockChainlinkService();
        this.spot = new MockSpotPriceService();
    } else {
        // LIVE MODE: Require the real services
        // We use require() here to ensure the file is only loaded when safe.
        Logger.info("[EDGE] Initializing in LIVE mode with REAL ORACLES.");
        const { ChainlinkService } = require('./chainlink');
        const { SpotPriceService } = require('./spotPrices');
        this.chainlink = new ChainlinkService();
        this.spot = new SpotPriceService();
    }
  }

  public async hydrateMarket(market: Market): Promise<boolean> {
    // 1. FAST PATH: If we already have the data, use it.
    if (market.t_open && market.baseline_price) return true;

    try {
        let updates: any = {};

        // 2. Fetch Metadata if Times OR Baseline are missing
        if (!market.t_open || !market.t_expiry || !market.baseline_price) {
            const meta = await polymarket.getMarketMetadata(market.polymarket_market_id);
            if (meta) {
                // A. Update Times
                if (!market.t_open) {
                    market.t_open = meta.startDate;
                    market.t_expiry = meta.endDate;
                    updates.t_open = meta.startDate;
                    updates.t_expiry = meta.endDate;
                    Logger.info(`[HYDRATE] Fetched Times | Start: ${market.t_open}`);
                }
                
                // B. Parse "Price To Beat"
                if (!market.baseline_price) {
                    const priceRegex = /\$([0-9,]+(\.[0-9]+)?)/;
                    const match = (meta.question || '').match(priceRegex) || (meta.description || '').match(priceRegex);
                    
                    if (match) {
                        const raw = match[1].replace(/,/g, '');
                        const val = parseFloat(raw);
                        if (!isNaN(val) && val > 0) {
                            market.baseline_price = val;
                            updates.baseline_price = val;
                            Logger.info(`[HYDRATE] Found Price To Beat (Metadata): $${val}`);
                        }
                    }
                }
            }
        }

        // 3. FORCE HYDRATION FALLBACK
        if (market.baseline_price && (!market.t_open || !market.t_expiry)) {
             Logger.warn(`[HYDRATE] Manual Baseline detected but Metadata API failed. Using DEFAULTS to unblock.`);
             const now = new Date();
             const oneDayLater = new Date(now.getTime() + 24 * 60 * 60 * 1000);
             if (!market.t_open) { market.t_open = now.toISOString(); updates.t_open = market.t_open; }
             if (!market.t_expiry) { market.t_expiry = oneDayLater.toISOString(); updates.t_expiry = market.t_expiry; }
        }

        // 4. Fallback: Fetch Baseline
        if (market.t_open && !market.baseline_price) {
            const startMs = new Date(market.t_open).getTime();
            const now = Date.now();

            if (startMs > now) {
                return false;
            }
            
            let derivedAsset: Asset;
            try {
                derivedAsset = assetFromMarketSlug(market.polymarket_market_id);
            } catch (e) {
                return false;
            }

            const trade = await this.spot.getHistoricalTrade(derivedAsset, startMs);
            
            if (trade) {
                const diff = Math.abs(trade.time - startMs);
                if (diff <= 2000) {
                    market.baseline_price = trade.price;
                    updates.baseline_price = trade.price;
                    updates.asset = derivedAsset; 
                    Logger.info(`[HYDRATE] ${market.polymarket_market_id} Baseline (Binance Est): $${market.baseline_price}`);
                } else {
                    return false; 
                }
            } else {
                return false;
            }
        }

        // 5. PERSISTENCE
        if (Object.keys(updates).length > 0) {
            await supabase.from('markets').update(updates).eq('id', market.id);
        }

        return !!(market.t_open && market.baseline_price);
        
    } catch (e: any) {
        Logger.warn(`[HYDRATE] Failed to hydrate ${market.polymarket_market_id}: ${e.message}`);
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

    let asset: Asset;
    try {
        asset = assetFromMarketSlug(market.polymarket_market_id);
    } catch (e: any) {
        Logger.error(`[EDGE] Asset Derivation Failed for ${market.polymarket_market_id}`, e.message);
        return null;
    }
    market.asset = asset; 

    const now = Date.now();
    
    // 2. Fetch Live Data (using mocked or real service based on env)
    let clData, spotPrice;
    try {
      [clData, spotPrice] = await Promise.all([
        // UPDATED: No longer passing market slug, STRICT asset-only call
        this.chainlink.getLatestPrice(asset),
        this.spot.getSpotPrice(asset)
      ]);
    } catch (err: any) {
        Logger.error(`[EDGE] Oracle Fetch Failed: ${err.message}`);
        return null;
    }

    if (!clData || !spotPrice) {
        // Mock fallback explicitly if null returned in weird cases
        if (ENV.DRY_RUN) {
             clData = { price: 45000, timestamp: now, source: 'MOCK_FALLBACK' };
             spotPrice = 45000;
        } else {
             return null;
        }
    }

    const expiryMs = new Date(market.t_expiry).getTime();
    const timeRemaining = expiryMs - now;

    // 3. Time Gating
    const isSafeToTrade = timeRemaining > this.NO_TRADE_ZONE_MS;

    // 4. Delta
    const baseline = market.baseline_price; 
    const delta = spotPrice - baseline;
    const direction = delta > 0 ? 'UP' : 'DOWN';

    // 5. Volatility & Regime
    let realizedVolPerMin = this.MIN_REALIZED_VOL;
    let regime: 'LOW_VOL' | 'NORMAL' | 'HIGH_VOL' = 'NORMAL';
    
    if (priceHistory.length > 5) {
        const returns: number[] = [];
        for (let i = 1; i < priceHistory.length; i++) {
             const r = Math.log(priceHistory[i].price / priceHistory[i-1].price);
             returns.push(r);
        }
        if (returns.length > 1) {
            const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
            const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
            const sdTick = Math.sqrt(variance);
            const totalTime = priceHistory[priceHistory.length-1].time - priceHistory[0].time;
            const avgTimeStepSec = (totalTime / 1000) / returns.length;
            if (avgTimeStepSec > 0) {
                 const ticksPerMin = 60 / avgTimeStepSec;
                 realizedVolPerMin = sdTick * Math.sqrt(ticksPerMin);
            }
        }
    }
    
    if (realizedVolPerMin < this.REGIME_LOW_VOL) regime = 'LOW_VOL';
    else if (realizedVolPerMin > this.REGIME_HIGH_VOL) regime = 'HIGH_VOL';
    realizedVolPerMin = Math.max(this.MIN_REALIZED_VOL, Math.min(this.MAX_REALIZED_VOL, realizedVolPerMin));

    // 6. Probability Model
    let calculatedProbability = 0.5;
    if (timeRemaining > 0) {
        const minutesLeft = Math.max(timeRemaining / 60000, 0.1); 
        const stdDevToExpiry = realizedVolPerMin * Math.sqrt(minutesLeft);
        const logReturn = Math.log(spotPrice / baseline);
        const z = logReturn / stdDevToExpiry;
        calculatedProbability = this.getNormalCDF(z);
    }

    // 7. Order Book
    let impliedProbability = 0;
    let orderBookSnapshot = undefined;
    
    const tokens = await polymarket.getTokens(market.polymarket_market_id);
    if (tokens) {
        const tokenId = direction === 'UP' ? tokens.up : tokens.down;
        const [vwapAsk, depth] = await Promise.all([
             polymarket.getVWAPAsk(tokenId, targetTradeSize),
             polymarket.getMarketDepth(tokenId)
        ]);
        if (vwapAsk) impliedProbability = vwapAsk;
        if (depth) {
            orderBookSnapshot = {
                bestBid: depth.bestBid,
                bestAsk: depth.bestAsk,
                spread: depth.bestAsk - depth.bestBid
            };
        }
    }

    const rawConf = direction === 'UP' ? calculatedProbability : (1 - calculatedProbability);
    const confidence = Math.max(0, (rawConf - 0.5) * 2);

    return {
      chainlink: { price: clData.price, timestamp: clData.timestamp, source: ENV.DRY_RUN ? 'MOCK' : 'Chainlink' },
      spot: { price: spotPrice, timestamp: now, source: ENV.DRY_RUN ? 'MOCK' : 'Median' },
      delta,
      direction,
      confidence, 
      timestamp: now,
      calculatedProbability, 
      impliedProbability,
      timeToExpiryMs: timeRemaining,
      isSafeToTrade,
      regime,
      orderBook: orderBookSnapshot
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