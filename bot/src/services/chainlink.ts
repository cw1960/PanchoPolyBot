import axios from 'axios';
import { Logger } from '../utils/logger';

// Mapping Assets to their Chainlink Aggregator Addresses (Polygon)
// These IDs are used to query the Chainlink Data Feeds API.
// 0xc907... is the official BTC/USD Aggregator on Polygon Mainnet
const FEED_ADDRESSES: Record<string, string> = {
  'BTC': '0xc907E116054Ad103354f2D350FD2514433D57F6f', 
  'ETH': '0xF9680D99D6C9589e2a93a78A04A279771948a025', 
};

// Public read-only API for Chainlink Feeds (mirrors on-chain data)
const BASE_URL = 'https://data.chain.link/api/v1/feeds';

export class ChainlinkService {
  
  public async getLatestPrice(asset: string): Promise<{ price: number; timestamp: number } | null> {
    const address = FEED_ADDRESSES[asset.toUpperCase()];
    
    if (!address) {
      Logger.warn(`No Chainlink Feed Address configured for ${asset}`);
      return null;
    }

    try {
      // Fetch latest round data from Chainlink public API
      // This endpoint returns the exact data available on the aggregator contract
      const url = `${BASE_URL}/polygon-mainnet/${address}`;
      
      const response = await axios.get(url, { timeout: 3000 });
      
      if (!response.data || !response.data.answer) {
        throw new Error("Invalid API response structure");
      }

      // 1. Parse Price (Chainlink uses 8 decimals for USD pairs usually)
      const rawPrice = BigInt(response.data.answer);
      const decimals = 8; // Standard for BTC/USD and ETH/USD
      const price = Number(rawPrice) / Math.pow(10, decimals);

      // 2. Parse Timestamp (API returns seconds, we need ms)
      const rawTimestamp = response.data.updatedAt || response.data.timestamp;
      const timestamp = Number(rawTimestamp) * 1000; 

      return { price, timestamp };

    } catch (err: any) {
      Logger.error(`Chainlink REST fetch failed for ${asset}`, err.message);
      return null;
    }
  }
}
