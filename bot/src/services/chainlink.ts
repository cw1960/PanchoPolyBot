
import axios from 'axios';
import { Logger } from '../utils/logger';

// STRICT MAPPING - NO DEFAULTS
// Polygon Mainnet Aggregator Addresses
const CHAINLINK_FEEDS: Record<string, string> = {
  'BTC': '0xc907E116054Ad103354f2D350FD2514433D57F6f', 
  'ETH': '0xF9680D99D6C9589e2a93a78A04A279771948a025',
  'SOL': '0x1092a6C1704e578494c259837905D4157a667618',
  'XRP': '0x1C13E171969B0A3F1F17d3550889e4726279930D' // XRP/USD Aggregator
};

// Public read-only API for Chainlink Feeds (mirrors on-chain data)
const BASE_URL = 'https://data.chain.link/api/v1/feeds';

export class ChainlinkService {
  
  /**
   * Fetches the latest price from the Chainlink feed.
   * REQUIRES explicit asset and slug.
   * THROWS if no feed is configured for the asset.
   */
  public async getLatestPrice(asset: string, marketSlug: string): Promise<{ price: number; timestamp: number } | null> {
    const address = CHAINLINK_FEEDS[asset]; // Direct lookup, no fallbacks

    // DIAGNOSTIC LOG (REQUIRED)
    console.log(`[ORACLE_CALL] slug=${marketSlug} asset=${asset} feed=${address || 'UNDEFINED'}`);

    if (!address) {
      Logger.error(`[CHAINLINK] FATAL: No feed configured for asset '${asset}'. Slug: ${marketSlug}`);
      throw new Error(`[CHAINLINK] Configuration Error: No feed for ${asset}`);
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
      const decimals = 8; 
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
