
import { Asset } from "../types/assets";
import { Logger } from "../utils/logger";

// SINGLE AUTHORITATIVE SOURCE OF TRUTH
// These are Real Polygon Mainnet Chainlink AggregatorV3 Addresses
// NOT EXPORTED: Must access via getChainlinkFeedAddress()
const CHAINLINK_FEEDS: Record<Asset, string> = {
  [Asset.BTC]: "0xc907E116054Ad103354f2D350FD2514433D57F6f",
  [Asset.ETH]: "0xF9680D99D6C9589e2a93a78A04A279771948a025",
  [Asset.SOL]: "0x1092a6C1704e578494c259837905D4157a667618",
  [Asset.XRP]: "0x1C13E171969B0A3F1F17d3550889e4726279930D"
};

// Derived set for O(1) whitelist checking
const ALLOWED_CHAINLINK_FEEDS_SET = new Set(
  Object.values(CHAINLINK_FEEDS).map(a => a.toLowerCase())
);

/**
 * Retrieves the hardcoded Chainlink Feed address for a given Asset.
 * Throws FATAL error if not found.
 */
export function getChainlinkFeedAddress(asset: Asset): string {
  const feed = CHAINLINK_FEEDS[asset];
  if (!feed) {
    throw new Error(`[ORACLE_FATAL] No Chainlink feed configured for asset=${asset}. Refusing to start.`);
  }
  return feed;
}

/**
 * Asserts that an address is in the strict whitelist.
 * This prevents accidental usage of non-proxy addresses or malicious inputs.
 */
export function assertAllowedFeedAddress(addr: string): void {
  if (!addr) throw new Error(`[ORACLE_FATAL] Address is empty/undefined.`);
  
  if (!ALLOWED_CHAINLINK_FEEDS_SET.has(addr.toLowerCase())) {
    throw new Error(`[ORACLE_FATAL] Disallowed oracle address ${addr}. Must be a hardcoded Chainlink feed proxy. Refusing to call Chainlink.`);
  }
}

/**
 * Boot-time self-check to ensure registry integrity.
 * Should be called before any market loop starts.
 */
export function validateOracleRegistry(): void {
  const assets = Object.values(Asset);
  for (const asset of assets) {
    const feed = CHAINLINK_FEEDS[asset];
    if (!feed) {
        throw new Error(`[ORACLE_FATAL] Registry missing feed for ${asset}`);
    }
    // Strict Hex + Length Check (20 bytes = 40 chars + 0x)
    if (!/^0x[a-fA-F0-9]{40}$/.test(feed)) {
        throw new Error(`[ORACLE_FATAL] Invalid hex address format for ${asset}: ${feed}`);
    }
    // Placeholder Safety Check
    if (feed.startsWith("0x0000000000000000000000000000000000000001")) {
         throw new Error(`[ORACLE_FATAL] Placeholder Chainlink feed address for asset=${asset}. Refusing to start in production.`);
    }
  }
  Logger.info(`[ORACLE_INIT] Registry validated for ${assets.length} assets.`);
}
