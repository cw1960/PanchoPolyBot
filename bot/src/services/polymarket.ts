

import { ethers } from 'ethers';
import { ClobClient, Side } from '@polymarket/clob-client';
import { ENV } from '../config/env';
import { Logger } from '../utils/logger';
import axios from 'axios';

class PolymarketService {
  private client: ClobClient | null = null;
  private signer: ethers.Wallet | null = null;
  private marketCache: Map<string, { up: string; down: string }> = new Map();

  constructor() {
    try {
      if (!ENV.PRIVATE_KEY) return;

      const provider = new ethers.JsonRpcProvider('https://polygon-rpc.com');
      this.signer = new ethers.Wallet(ENV.PRIVATE_KEY, provider);

      this.client = new ClobClient(
        'https://clob.polymarket.com/',
        137,
        this.signer as any, // Cast to avoid v6/v5 type mismatch
        {
          key: ENV.POLY_API_KEY,
          secret: ENV.POLY_API_SECRET,
          passphrase: ENV.POLY_PASSPHRASE,
        }
      );
    } catch (err) {
      Logger.error("Failed to initialize Polymarket Client", err);
    }
  }

  private sanitizeSlug(slug: string): string {
      if (!slug) return '';
      // Remove query params (?tid=...), whitespace, and trailing slashes
      return slug.split('?')[0].trim().replace(/\/$/, '');
  }

  /**
   * Resolves a Market Slug (e.g. 'btc-price-jan-1') to Token IDs (UP/DOWN)
   */
  public async getTokens(rawSlug: string): Promise<{ up: string; down: string } | null> {
    const slug = this.sanitizeSlug(rawSlug);
    if (this.marketCache.has(slug)) return this.marketCache.get(slug)!;

    try {
      const res = await axios.get(`https://gamma-api.polymarket.com/events?slug=${slug}`);
      if (!res.data || res.data.length === 0) return null;

      const market = res.data[0].markets[0];
      const clobTokenIds = JSON.parse(market.clobTokenIds);
      const outcomes = JSON.parse(market.outcomes);

      let up = '', down = '';
      outcomes.forEach((name: string, idx: number) => {
        if (name.toUpperCase() === 'UP' || name.toUpperCase() === 'YES') up = clobTokenIds[idx];
        if (name.toUpperCase() === 'DOWN' || name.toUpperCase() === 'NO') down = clobTokenIds[idx];
      });

      if (up && down) {
        this.marketCache.set(slug, { up, down });
        return { up, down };
      }
    } catch (err) {
      Logger.error(`Failed to resolve tokens for ${slug}`, err);
    }
    return null;
  }

  /**
   * Fetches metadata (Start/End times, Question, Description) for a market slug.
   */
  public async getMarketMetadata(rawSlug: string): Promise<{ startDate: string, endDate: string, question: string, description: string } | null> {
    const slug = this.sanitizeSlug(rawSlug);
    try {
      const res = await axios.get(`https://gamma-api.polymarket.com/events?slug=${slug}`);
      if (!res.data || res.data.length === 0) return null;
      const market = res.data[0].markets[0];
      return { 
        startDate: market.startDate, 
        endDate: market.endDate,
        question: market.question,
        description: market.description
      };
    } catch (err) {
      Logger.error(`Failed to fetch metadata for ${slug}`, err);
      return null;
    }
  }

  /**
   * Finds a specific 15-minute market for an asset that matches the given expiry time.
   * This is used by the Auto-Rotator to discover the correct market slug.
   * 
   * @param asset 'BTC' or 'ETH'
   * @param expiryIso ISO String of the target bucket end time (e.g., "2023-10-27T12:15:00.000Z")
   */
  public async findMarketForAssetAndExpiry(asset: string, expiryIso: string): Promise<any | null> {
    const keyword = asset === 'BTC' ? 'Bitcoin' : asset === 'ETH' ? 'Ethereum' : asset;
    
    // We look for "Active" events primarily, but also check if they are newly created.
    const url = `https://gamma-api.polymarket.com/events?limit=20&active=true&closed=false&keyword=${keyword}`;
    
    try {
        const res = await axios.get(url, { timeout: 5000 });
        const targetTime = new Date(expiryIso).getTime();

        for (const event of res.data) {
            for (const market of event.markets) {
                const mEnd = new Date(market.endDate).getTime();
                
                // Check if expiry matches our target bucket (Tolerance: +/- 60s)
                // Polymarket sometimes shifts seconds, so we need a small buffer.
                if (Math.abs(mEnd - targetTime) < 60000) {
                     
                     // Secondary Validation: Ensure it's a binary Price market
                     // (Simple heuristic: 2 outcomes, clobTokenIds present)
                     if (market.outcomes && JSON.parse(market.outcomes).length === 2) {
                         return market;
                     }
                }
            }
        }
    } catch (err) {
        Logger.error(`[POLY_API] Discovery failed for ${asset} @ ${expiryIso}`, err);
    }
    return null;
  }

  /**
   * Calculates VWAP (Volume Weighted Average Price) for a target USD size.
   * Walks the order book asks until size is filled.
   */
  public async getVWAPAsk(tokenId: string, targetUsdSize: number = 10): Promise<number | null> {
    if (!this.client) return null;
    try {
        const orderbook = await this.client.getOrderBook(tokenId);
        const asks = orderbook.asks;
        if (!asks || asks.length === 0) return null;

        let filledSize = 0;
        let weightedSum = 0;
        let remainingTarget = targetUsdSize;

        for (const level of asks) {
            const price = parseFloat(level.price);
            const size = parseFloat(level.size);
            
            // Value of this level in USD approx (shares * price) 
            // NOTE: Clob size is usually shares. 
            // If we want to deploy $10, we need $10 / price shares.
            const costOfLevel = size * price;

            if (costOfLevel >= remainingTarget) {
                // Partial fill of this level completes the order
                const neededValue = remainingTarget;
                weightedSum += neededValue; 
                
                const sharesNeeded = remainingTarget / price;
                filledSize += sharesNeeded;
                remainingTarget = 0;
                break;
            } else {
                // Consume full level
                weightedSum += costOfLevel;
                filledSize += size;
                remainingTarget -= costOfLevel;
            }
        }

        if (remainingTarget > 0 && filledSize === 0) return null; 

        const totalSpent = targetUsdSize - remainingTarget;
        if (filledSize === 0) return parseFloat(asks[0].price); 

        return totalSpent / filledSize;
        
    } catch (err) {
        // Suppress 404s/empty books
    }
    return null;
  }

  /**
   * Calculates Mid Price ((Best Bid + Best Ask) / 2) for PnL Marking.
   */
  public async getMidPrice(tokenId: string): Promise<number | null> {
    if (!this.client) return null;
    try {
        const book = await this.client.getOrderBook(tokenId);
        
        let bestAsk: number | undefined;
        let bestBid: number | undefined;

        if (book.asks.length > 0) bestAsk = parseFloat(book.asks[0].price);
        if (book.bids.length > 0) bestBid = parseFloat(book.bids[0].price);

        if (bestAsk !== undefined && bestBid !== undefined) {
            return (bestAsk + bestBid) / 2;
        } else if (bestAsk !== undefined) {
            return bestAsk;
        } else if (bestBid !== undefined) {
            return bestBid;
        }
        
        return null;
    } catch (e) {
        // Quietly fail for PnL marks to avoid log spam
        return null;
    }
  }

  /**
   * Executes a Limit Order (GTC)
   */
  public async placeOrder(tokenId: string, side: 'BUY' | 'SELL', price: number, size: number) {
    if (!this.client) throw new Error("Client not initialized");

    const order = await this.client.createOrder({
      tokenID: tokenId,
      price: price,
      side: side === 'BUY' ? Side.BUY : Side.SELL,
      size: size,
      feeRateBps: 0,
      nonce: Date.now()
    });

    const response = await this.client.postOrder(order);
    return response.orderID;
  }
}

export const polymarket = new PolymarketService();