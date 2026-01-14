
// CRITICAL SAFETY GUARD
// This file MUST NOT be loaded in DRY_RUN mode.
if (process.env.DRY_RUN !== 'false') {
  throw new Error('FATAL: ChainlinkService loaded while DRY_RUN=true. This is a bug. Consumers must use Mocks.');
}

import axios from 'axios';
import { Logger } from '../utils/logger';
import { Asset } from '../types/assets';

// STRICT MAPPING - NO DEFAULTS
// Polygon Mainnet Aggregator Addresses
const CHAINLINK_FEEDS: Record<Asset, string> = {
  [Asset.BTC]: '0xc907E116054Ad103354f2D350FD2514433D57F6f', 
  [Asset.ETH]: '0xF9680D99D6C9589e2a93a78A04A279771948a025',
  [Asset.SOL]: '0x1092a6C1704e578494c259837905D4157a667618',
  [Asset.XRP]: '0x1C13E171969B0A3F1F17d3550889e4726279930D'
};

// Public read-only API for Chainlink Feeds (mirrors on-chain data)
const BASE_URL = 'https://data.chain.link/api/v1/feeds';

export class ChainlinkService {
  
  /**
   * Fetches the latest price from the Chainlink feed.
   */
  public async getLatestPrice(asset: Asset, marketSlug: string): Promise<{ price: number; timestamp: number } | null> {
    
    // 1. Validate Feed Address existence
    const address = CHAINLINK_FEEDS[asset]; 

    // 2. REQUIRED LOG (Diagnostic)
    console.log(`[ORACLE_CALL] slug=${marketSlug} asset=${asset} feed=${address || 'UNDEFINED'}`);

    // 3. FAIL FAST (No Defaults)
    if (!address) {
      const errorMsg = `[CHAINLINK_FATAL] No feed configured for asset '${asset}' (Slug: ${marketSlug}). Aborting.`;
      Logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    try {
      // Fetch latest round data from Chainlink public API
      const url = `${BASE_URL}/polygon-mainnet/${address}`;
      
      const response = await axios.get(url, { timeout: 3000 });
      
      if (!response.data || !response.data.answer) {
        throw new Error("Invalid API response structure");
      }

      // 4. Parse Price
      const rawPrice = BigInt(response.data.answer);
      const decimals = 8; 
      const price = Number(rawPrice) / Math.pow(10, decimals);

      // 5. Parse Timestamp
      const rawTimestamp = response.data.updatedAt || response.data.timestamp;
      const timestamp = Number(rawTimestamp) * 1000; 

      return { price, timestamp };

    } catch (err: any) {
      Logger.error(`Chainlink REST fetch failed for ${asset}`, err.message);
      throw err;
    }
  }
}
