import axios from 'axios';
import { Logger } from '../utils/logger';

export class SpotPriceService {
  
  public async getSpotPrice(asset: string): Promise<number | null> {
    const sym = asset.toUpperCase();
    const prices: number[] = [];

    // 1. Binance
    try {
      const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}USDT`);
      if (res.data?.price) prices.push(parseFloat(res.data.price));
    } catch (e) { /* Ignore */ }

    // 2. Coinbase
    try {
      const res = await axios.get(`https://api.coinbase.com/v2/prices/${sym}-USD/spot`);
      if (res.data?.data?.amount) prices.push(parseFloat(res.data.data.amount));
    } catch (e) { /* Ignore */ }

    if (prices.length === 0) {
      Logger.warn(`Failed to fetch spot prices for ${asset}`);
      return null;
    }

    // Return Median/Average
    const sum = prices.reduce((a, b) => a + b, 0);
    return sum / prices.length;
  }
}
