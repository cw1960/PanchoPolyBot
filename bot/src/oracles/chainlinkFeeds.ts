
import { Asset } from "../types/assets";

// SINGLE AUTHORITATIVE SOURCE OF TRUTH
// These are Real Polygon Mainnet Chainlink AggregatorV3 Addresses
export const CHAINLINK_FEEDS: Record<Asset, string> = {
  [Asset.BTC]: "0xc907E116054Ad103354f2D350FD2514433D57F6f",
  [Asset.ETH]: "0xF9680D99D6C9589e2a93a78A04A279771948a025",
  [Asset.SOL]: "0x1092a6C1704e578494c259837905D4157a667618",
  [Asset.XRP]: "0x1C13E171969B0A3F1F17d3550889e4726279930D"
};
