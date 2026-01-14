
import { Asset } from '../types/assets';

/**
 * PURE FUNCTION: strictly derives the asset symbol from the market slug.
 * 
 * Rules:
 * - slug starts with 'btc-' -> BTC
 * - slug starts with 'eth-' -> ETH
 * - slug starts with 'sol-' -> SOL
 * - slug starts with 'xrp-' -> XRP
 * 
 * THROWS on unknown or ambiguous slugs.
 */
export function assetFromMarketSlug(slug: string): Asset {
    if (!slug) throw new Error("[ORACLE_FATAL] Slug is empty or undefined");
    
    const s = slug.toLowerCase().trim();
    
    if (s.startsWith('btc-')) return Asset.BTC;
    if (s.startsWith('eth-')) return Asset.ETH;
    if (s.startsWith('sol-')) return Asset.SOL;
    if (s.startsWith('xrp-')) return Asset.XRP;
    
    throw new Error(`[ORACLE_FATAL] FAILED: Unknown asset for slug '${slug}'. Logic requires btc-, eth-, sol-, or xrp- prefix.`);
}
