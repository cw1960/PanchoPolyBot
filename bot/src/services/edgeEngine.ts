
import { Market } from '../types/tables';
import { ChainlinkService } from './chainlink';
import { SpotPriceService } from './spotPrices';
import { MarketObservation } from '../types/marketEdge';
import { Logger } from '../utils/logger';
import { polymarket } from './polymarket';
import { supabase } from './supabase';
import { assetFromMarketSlug } from '../utils/assetDerivation';
import { Asset } from '../types/assets';

export class EdgeEngine {
  private chainlink: ChainlinkService;
  private spot: SpotPriceService;
  
  // Risk Config
  private readonly NO_TRADE_ZONE_MS = 2 * 60 * 1000; 
  // Safety Clips for Realized Volatility
  private readonly MIN_REALIZED_VOL = 0.0005; // 0.05% per min
  private readonly MAX_REALIZED_VOL = 0.02;   // 2.0% per min (Panic mode clip)
  
  // Regime Thresholds (per minute volatility)
  private readonly REGIME_LOW_VOL = 0.001;  // 0.1%
  private readonly REGIME_HIGH_VOL = 0.005; // 0.5%

  constructor() {
    this.chainlink = new ChainlinkService();
    this.spot = new SpotPriceService();
  }

  /**
   * Hydrates market with metadata.
   * STRICT PRIORITY: 
   * 1. Existing DB/Manual Override.
   * 2. "Price To Beat" from Polymarket Metadata (Question/Description).
   * 3. Nearest Trade Tick on Binance (Fallback).
   */
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
                
                // B. Parse "Price To Beat" (Market Strike) from Text
                if (!market.baseline_price) {
                    // Look for patterns like "$90,287.65" in the question or description.
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

        // 3. FORCE HYDRATION FALLBACK (Critical Fix)
        // If we have a manual baseline (from UI) but still no Start/End times (API failure),
        // we MUST default them to unblock the bot.
        if (market.baseline_price && (!market.t_open || !market.t_expiry)) {
             Logger.warn(`[HYDRATE] Manual Baseline detected but Metadata API failed. Using DEFAULTS to unblock.`);
             
             const now = new Date();
             const oneDayLater = new Date(now.getTime() + 24 * 60 * 60 * 1000);
             
             if (!market.t_open) {
                 market.t_open = now.toISOString();
                 updates.t_open = market.t_open;
             }
             if (!market.t_expiry) {
                 market.t_expiry = oneDayLater.toISOString();
                 updates.t_expiry = market.t_expiry;
             }
        }

        // 4. Fallback: Fetch Baseline (Nearest Trade via AggTrades)
        // Only run this if we still lack a baseline_price but have a valid t_open
        if (market.t_open && !market.baseline_price) {
            const startMs = new Date(market.t_open).getTime();
            const now = Date.now();

            // Wait if market hasn't started
            if (startMs > now) {
                const waitSec = Math.ceil((startMs - now) / 1000);
                if (waitSec % 10 === 0) { // Log every 10s
                     Logger.info(`[HYDRATE] Waiting for Start: ${market.t_open} (in ${waitSec}s)`);
                }
                return false;
            }
            
            // Get trade at or immediately after t_open
            // STRICT ASSET DERIVATION - NO DEFAULTS
            let derivedAsset: Asset;
            try {
                derivedAsset = assetFromMarketSlug(market.polymarket_market_id);
            } catch (e) {
                Logger.warn(`[HYDRATE_FAIL] Asset derivation failed for ${market.polymarket_market_id}. Cannot fetch baseline.`);
                return false;
            }

            const trade = await this.spot.getHistoricalTrade(derivedAsset, startMs);
            
            if (trade) {
                // Precision Check: Must be within 2000ms of t_open
                const diff = Math.abs(trade.time - startMs);
                if (diff <= 2000) {
                    market.baseline_price = trade.price;
                    updates.baseline_price = trade.price;
                    // Auto-update asset metadata while we are here
                    updates.asset = derivedAsset; 
                    Logger.info(`[HYDRATE] ${market.polymarket_market_id} Baseline (Binance Est): $${market.baseline_price} (Delta: ${diff}ms)`);
                } else {
                    Logger.warn(`[HYDRATE] Baseline trade too far: ${diff}ms > 2000ms. Waiting for closer match.`);
                    return false; 
                }
            } else {
                Logger.warn(`[HYDRATE] No baseline trade found at ${market.t_open} yet.`);
                return false;
            }
        }

        // 5. PERSISTENCE: Save any found/defaulted data to DB
        if (Object.keys(updates).length > 0) {
            await supabase.from('markets').update(updates).eq('id', market.id);
            Logger.info(`[HYDRATE] Persisted metadata/baseline to DB for ${market.polymarket_market_id}`);
        }

        // Final check: Do we have what we need?
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

    // --- CRITICAL FIX: STRICT ASSET DERIVATION ---
    let asset: Asset;
    try {
        asset = assetFromMarketSlug(market.polymarket_market_id);
    } catch (e: any) {
        Logger.error(`[EDGE] Asset Derivation Failed for ${market.polymarket_market_id}`, e.message);
        return null; // Fail fast, do not proceed with bad asset
    }
    
    // Update local object to ensure consistency downstream
    market.asset = asset; 
    // ---------------------------------------------

    const now = Date.now();
    
    // 2. Fetch Live Data
    // PASSING DERIVED ASSET + SLUG
    // Note: getLatestPrice will now throw if the asset is invalid or unmapped
    let clData, spotPrice;
    
    try {
      [clData, spotPrice] = await Promise.all([
        this.chainlink.getLatestPrice(asset, market.polymarket_market_id),
        this.spot.getSpotPrice(asset)
      ]);
    } catch (err: any) {
      Logger.error(`[EDGE] Oracle Fetch Failed: ${err.message}`);
      return null;
    }

    if (!clData || !spotPrice) return null;

    const expiryMs = new Date(market.t_expiry).getTime();
    const timeRemaining = expiryMs - now;

    // 3. Time Gating
    const isSafeToTrade = timeRemaining > this.NO_TRADE_ZONE_MS;

    // 4. Delta (Spot - Price To Beat)
    const baseline = market.baseline_price; 
    const delta = spotPrice - baseline;
    const direction = delta > 0 ? 'UP' : 'DOWN';

    // 5. Realized Volatility Calculation (Rolling Window)
    let realizedVolPerMin = this.MIN_REALIZED_VOL;
    let regime: 'LOW_VOL' | 'NORMAL' | 'HIGH_VOL' = 'NORMAL';
    
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
            
            // Annualize to Minute
            const totalTime = priceHistory[priceHistory.length-1].time - priceHistory[0].time;
            const avgTimeStepSec = (totalTime / 1000) / returns.length;
            
            if (avgTimeStepSec > 0) {
                 // Scale SD to 60 seconds
                 const ticksPerMin = 60 / avgTimeStepSec;
                 realizedVolPerMin = sdTick * Math.sqrt(ticksPerMin);
            }
        }
    }
    
    // Determine Regime
    if (realizedVolPerMin < this.REGIME_LOW_VOL) regime = 'LOW_VOL';
    else if (realizedVolPerMin > this.REGIME_HIGH_VOL) regime = 'HIGH_VOL';
    
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

    // 7. Order Book Data
    let impliedProbability = 0;
    let orderBookSnapshot = undefined;
    
    const tokens = await polymarket.getTokens(market.polymarket_market_id);
    if (tokens) {
        const tokenId = direction === 'UP' ? tokens.up : tokens.down;
        
        // Parallel fetch for Depth and VWAP to avoid double waiting
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
