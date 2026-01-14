
// CRITICAL SAFETY GUARD
// This file MUST NOT be loaded in DRY_RUN mode.
if (process.env.DRY_RUN !== 'false') {
  throw new Error('FATAL: ChainlinkService loaded while DRY_RUN=true. This is a bug. Consumers must use Mocks.');
}

import { ethers } from 'ethers';
import { Asset } from '../types/assets';
import { CHAINLINK_FEEDS } from '../oracles/chainlinkFeeds';
import { Logger } from '../utils/logger';

const AGGREGATOR_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)"
];

// Use provided RPC or fallback to public Polygon RPC
const RPC_URL = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';

export class ChainlinkService {
  private provider: ethers.JsonRpcProvider;
  private static loggedFeeds = new Set<string>();

  constructor() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
  }

  /**
   * Fetches the latest price from a whitelisted Chainlink Aggregator.
   * STRICTLY FORBIDS arbitrary addresses.
   */
  public async getLatestPrice(asset: Asset): Promise<{ price: number; timestamp: number }> {
    const feed = CHAINLINK_FEEDS[asset];

    // 1. FAIL FAST: Check Existence in Whitelist
    if (!feed) {
      const msg = `[ORACLE_FATAL] No Chainlink feed for asset ${asset}`;
      Logger.error(msg);
      throw new Error(msg);
    }

    // 2. FAIL FAST: Runtime Address Validation
    if (feed.length !== 42) {
       throw new Error(`[ORACLE_FATAL] Invalid feed address for ${asset}: ${feed}`);
    }

    try {
      const contract = new ethers.Contract(feed, AGGREGATOR_ABI, this.provider);
      
      // Parallel fetch for speed
      const [roundData, decimals] = await Promise.all([
        contract.latestRoundData(),
        contract.decimals()
      ]);

      const price = Number(ethers.formatUnits(roundData.answer, decimals));
      const timestamp = Number(roundData.updatedAt) * 1000;

      // 3. Log ONCE per market (Asset)
      if (!ChainlinkService.loggedFeeds.has(asset)) {
          Logger.info(`[ORACLE_OK] ${asset} -> ${feed}`);
          ChainlinkService.loggedFeeds.add(asset);
      }

      return { price, timestamp };

    } catch (err: any) {
      Logger.error(`[ORACLE_FATAL] Attempted to use non-Chainlink contract as oracle for ${asset}`, err);
      throw err;
    }
  }
}
