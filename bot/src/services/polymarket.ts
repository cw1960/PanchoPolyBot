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
      // Fetch from Gamma API
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
   * Executes a Limit Order (GTC)
   */
  public async placeOrder(tokenId: string, side: 'BUY' | 'SELL', price: number, size: number) {
    if (!this.client) throw new Error("Client not initialized");

    // Create Order
    const order = await this.client.createOrder({
      tokenID: tokenId,
      price: price,
      side: side === 'BUY' ? Side.BUY : Side.SELL,
      size: size,
      feeRateBps: 0,
      nonce: Date.now() // Simple nonce
    });

    // Post Order
    const response = await this.client.postOrder(order);
    return response.orderID;
  }
}

export const polymarket = new PolymarketService();
