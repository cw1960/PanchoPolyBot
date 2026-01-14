
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

// 4️⃣ Staleness (heartbeat enforcement)
const MAX_STALENESS_SECONDS: Record<Asset, number> = {
  [Asset.BTC]: 120,
  [Asset.ETH]: 120,
  [Asset.SOL]: 180,
  [Asset.XRP]: 180
};

export class ChainlinkService {
  private provider: ethers.JsonRpcProvider;
  private static loggedFeeds = new Set<string>();

  constructor() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
  }

  /**
   * Fetches the latest price from a whitelisted Chainlink Aggregator.
   * STRICTLY FORBIDS arbitrary addresses.
   * STRICTLY VALIDATES return data.
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

      // 5. STRICT DATA VALIDATION
      this.validateRoundData(asset, roundData);

      const price = Number(ethers.formatUnits(roundData.answer, decimals));
      const timestamp = Number(roundData.updatedAt) * 1000;

      // 6. Log ONCE per market (Asset) on first SUCCESSFUL validation
      if (!ChainlinkService.loggedFeeds.has(asset)) {
          const ageSec = Math.floor(Date.now() / 1000) - Number(roundData.updatedAt);
          Logger.info(`[ORACLE] Valid Chainlink price asset=${asset} updatedAt=${timestamp} age=${ageSec}s`);
          ChainlinkService.loggedFeeds.add(asset);
      }

      return { price, timestamp };

    } catch (err: any) {
      Logger.error(`[ORACLE_FATAL] Chainlink call failed for ${asset} at ${feed}`, err);
      throw err;
    }
  }

  /**
   * Enforces mandatory Chainlink data integrity checks.
   * Throws [ORACLE_FATAL] on any violation.
   */
  private validateRoundData(asset: Asset, roundData: any): void {
    const roundId = BigInt(roundData.roundId);
    const answer = BigInt(roundData.answer);
    const updatedAt = BigInt(roundData.updatedAt);
    const answeredInRound = BigInt(roundData.answeredInRound);

    // 1. Round completeness
    if (answeredInRound < roundId) {
        throw new Error(`[ORACLE_FATAL] Incomplete Chainlink round for asset=${asset}: answeredInRound < roundId`);
    }

    // 2. Price sanity
    if (answer <= 0n) {
        throw new Error(`[ORACLE_FATAL] Invalid Chainlink price for asset=${asset}: answer=${answer}`);
    }

    // 3. Timestamp presence
    if (updatedAt === 0n) {
        throw new Error(`[ORACLE_FATAL] Chainlink updatedAt missing for asset=${asset}`);
    }

    // 4. Staleness
    const nowSec = Math.floor(Date.now() / 1000);
    const updatedSec = Number(updatedAt);
    const ageSec = nowSec - updatedSec;
    const maxStaleness = MAX_STALENESS_SECONDS[asset];

    if (ageSec > maxStaleness) {
        throw new Error(`[ORACLE_FATAL] Stale Chainlink price for asset=${asset}: age=${ageSec}s exceeds max=${maxStaleness}s`);
    }
  }
}
