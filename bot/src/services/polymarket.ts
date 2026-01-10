
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
          apiKey: ENV.POLY_API_KEY,
          apiSecret: ENV.POLY_API_SECRET,
          apiPassphrase: ENV.POLY_PASSPHRASE,
        }
      );
    } catch (err) {
      Logger.error("Failed to initialize Polymarket Client", err);
    }
  }

  /**
   * Resolves a Market Slug (e.g. 'btc-price-jan-1') to Token IDs (UP/DOWN)
   */
  public async getTokens(slug: string): Promise<{ up: string; down: string } | null> {
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
  public async getMarketMetadata(slug: string): Promise<{ startDate: string, endDate: string, question: string, description: string } | null> {
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
                weightedSum += neededValue; // Price is the weight? No.
                // VWAP = Total Value / Total Shares
                // We are summing Value ($). We need to track Shares.
                
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

        // Check if we exhausted the book without filling size
        if (remainingTarget > 0 && filledSize === 0) return null; // Empty book

        // VWAP = (Total USD Spent) / (Total Shares Acquired)
        const totalSpent = targetUsdSize - remainingTarget;
        if (filledSize === 0) return parseFloat(asks[0].price); // Fallback

        return totalSpent / filledSize;
        
    } catch (err) {
        // Suppress 404s/empty books
    }
    return null;
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
