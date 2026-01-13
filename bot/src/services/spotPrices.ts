
import axios from 'axios';
import { Logger } from '../utils/logger';
import { Asset } from '../types/assets';

export class SpotPriceService {
  
  public async getSpotPrice(asset: Asset): Promise<number | null> {
    // Enum is string-based, so this works, but we enforce strictness at call site
    const sym = asset.toString().toUpperCase();
    const prices: number[] = [];

    // 1. Binance
    try {
      const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}USDT`, { timeout: 2000 });
      if (res.data?.price) prices.push(parseFloat(res.data.price));
    } catch (e) { /* Ignore timeouts/errors */ }

    // 2. Coinbase
    try {
      const res = await axios.get(`https://api.coinbase.com/v2/prices/${sym}-USD/spot`, { timeout: 2000 });
      if (res.data?.data?.amount) prices.push(parseFloat(res.data.data.amount));
    } catch (e) { /* Ignore timeouts/errors */ }

    if (prices.length === 0) {
      // Logger.warn(`Failed to fetch spot prices for ${asset}`);
      return null;
    }

    // Return Simple Average
    const sum = prices.reduce((a, b) => a + b, 0);
    return sum / prices.length;
  }

  /**
   * Fetches the first trade at or after timestamp.
   * Uses Binance AggTrades for high precision.
   */
  public async getHistoricalTrade(asset: Asset, timestampMs: number): Promise<{ price: number, time: number } | null> {
      // Map Asset Enum to specific Binance Symbols if needed
      let sym = '';
      if (asset === Asset.BTC) sym = 'BTCUSDT';
      else if (asset === Asset.ETH) sym = 'ETHUSDT';
      else if (asset === Asset.SOL) sym = 'SOLUSDT';
      else if (asset === Asset.XRP) sym = 'XRPUSDT';
      else throw new Error(`[SPOT] Unsupported asset for historical lookup: ${asset}`);

      try {
          // fetch trades starting at timestamp
          const url = `https://api.binance.com/api/v3/aggTrades?symbol=${sym}&startTime=${timestampMs}&limit=1`;
          const res = await axios.get(url, { timeout: 3000 });
          
          if (res.data && res.data.length > 0) {
              const trade = res.data[0];
              // trade object: { a: aggTradeId, p: price, q: quantity, f: firstTradeId, l: lastTradeId, T: timestamp, ... }
              return { 
                  price: parseFloat(trade.p), 
                  time: trade.T 
              };
          }
      } catch (err) {
          Logger.warn(`Failed to fetch historical trade for ${asset}`, err);
      }
      return null;
  }
}
