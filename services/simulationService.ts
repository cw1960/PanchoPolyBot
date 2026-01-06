import { PricePoint, TradeLog, BotConfig } from '../types';

// Simulates a "Leading" price (Binance) and a "Lagging" price (Polymarket)
// The strategy relies on the Lagging price reacting slowly to the Leading price.

let currentPrice = 98000; // Starting BTC price simulation
let lastUpdateTime = Date.now();
const history: PricePoint[] = [];

export const generateMarketData = (lagSeconds: number): PricePoint => {
  const now = Date.now();
  const timeDelta = (now - lastUpdateTime) / 1000;
  lastUpdateTime = now;

  // Random walk for Leading Price (Binance)
  const volatility = 20; // Price moves roughly $20 per tick
  const movement = (Math.random() - 0.5) * volatility;
  currentPrice += movement;

  // Polymarket price simulation
  // It tracks the real price but with a delay (smoothing)
  // We map BTC price to a probability for "BTC > $100k by Jan 31"
  // Let's assume current strike is roughly near current price for drama
  
  // Normalized "Leading" Probability (0-100 cents)
  // Let's just track price directly for visual simplicity in the chart
  const leadingValue = currentPrice;
  
  // The "Lagging" value is an average of past prices (simulating human/system delay)
  // If history is empty, use current.
  let laggingValue = leadingValue;
  
  if (history.length > lagSeconds * 10) { // Assuming 10 ticks per second roughly
     const pastPoint = history[history.length - (lagSeconds * 5)]; // Look back
     if (pastPoint) {
         // It moves *towards* the real price but slowly
         laggingValue = pastPoint.targetPrice + (leadingValue - pastPoint.targetPrice) * 0.1;
     }
  }

  const point: PricePoint = {
    timestamp: now,
    sourcePrice: leadingValue,
    targetPrice: laggingValue,
    delta: Math.abs(leadingValue - laggingValue)
  };

  history.push(point);
  if (history.length > 200) history.shift(); // Keep memory clean

  return point;
};

export const checkTradeCondition = (
  data: PricePoint, 
  config: BotConfig
): TradeLog | null => {
  // Simple Logic: If Source moves X% away from Target, assume Target will catch up.
  
  const percentDiff = ((data.sourcePrice - data.targetPrice) / data.targetPrice) * 100;
  
  if (Math.abs(percentDiff) > config.triggerThreshold) {
    const isBullish = percentDiff > 0;
    
    return {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      type: isBullish ? 'BUY_YES' : 'BUY_NO',
      asset: 'BTC > 100k',
      entryPrice: data.targetPrice,
      marketPrice: data.sourcePrice,
      amount: config.betSize,
      status: 'OPEN'
    };
  }
  
  return null;
};