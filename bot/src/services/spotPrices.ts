import axios from 'axios';
import { Logger } from '../utils/logger';

export class SpotPriceService {
  
  public async getSpotPrice(asset: string): Promise<number | null> {
    const sym = asset.toUpperCase();
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
}
