
// CRITICAL SAFETY GUARD
// This file MUST NOT be loaded in DRY_RUN mode.
if (process.env.DRY_RUN !== 'false') {
  throw new Error('FATAL: ChainlinkService loaded while DRY_RUN=true. This is a bug. Consumers must use Mocks.');
}

import { ethers } from 'ethers';
import { Asset } from '../types/assets';
import { getChainlinkFeedAddress, assertAllowedFeedAddress } from '../oracles/chainlinkFeeds';
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
    // 1. Resolve strictly via helper (Throws if asset unknown)
    const feed = getChainlinkFeedAddress(asset);

    // 2. FAIL FAST: Runtime Address Validation (Regex)
    if (!/^0x[a-fA-F0-9]{40}$/.test(feed)) {
       throw new Error(`[ORACLE_FATAL] Invalid feed address format for asset=${asset}: ${feed}`);
    }

    // 3. FAIL FAST: Whitelist Assertion
    assertAllowedFeedAddress(feed);

    try {
      // 4. Construct Contract (Only reachable if strictly validated)
      const contract = new ethers.Contract(feed, AGGREGATOR_ABI, this.provider);
      
      // Parallel fetch for speed
      const [roundData, decimals] = await Promise.all([
        contract.latestRoundData(),
        contract.decimals()
      ]);

      const price = Number(ethers.formatUnits(roundData.answer, decimals));
      const timestamp = Number(roundData.updatedAt) * 1000;

      // 5. Log ONCE per market (Asset)
      if (!ChainlinkService.loggedFeeds.has(asset)) {
          Logger.info(`[ORACLE] Using Chainlink feed for asset=${asset} address=${feed}`);
          ChainlinkService.loggedFeeds.add(asset);
      }

      return { price, timestamp };

    } catch (err: any) {
      Logger.error(`[ORACLE_FATAL] Chainlink call failed for ${asset} at ${feed}`, err);
      throw err;
    }
  }
}
