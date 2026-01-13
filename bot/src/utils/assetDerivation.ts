
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
export function assetFromMarketSlug(slug: string): 'BTC' | 'ETH' | 'SOL' | 'XRP' {
    if (!slug) throw new Error("[ASSET_DERIVATION] Slug is empty or undefined");
    
    const s = slug.toLowerCase().trim();
    
    if (s.startsWith('btc-')) return 'BTC';
    if (s.startsWith('eth-')) return 'ETH';
    if (s.startsWith('sol-')) return 'SOL';
    if (s.startsWith('xrp-')) return 'XRP';
    
    throw new Error(`[ASSET_DERIVATION] FAILED: Unknown asset for slug '${slug}'. Logic requires btc-, eth-, sol-, or xrp- prefix.`);
}
