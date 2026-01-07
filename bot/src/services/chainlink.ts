import { ethers } from 'ethers';
import { Logger } from '../utils/logger';

// Polygon Mainnet Aggregators
const AGGREGATORS: Record<string, string> = {
  'BTC': '0xc907E116054Ad103354f2D350FD2514433D57F6f', // BTC/USD
  'ETH': '0xF9680D99D6C9589e2a93a78A04A279771948a025', // ETH/USD
};

// Minimal ABI to read latestRoundData
const ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)"
];

const RPC_URL = 'https://polygon-rpc.com';

export class ChainlinkService {
  private provider: ethers.JsonRpcProvider;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
  }

  public async getLatestPrice(asset: string): Promise<{ price: number; timestamp: number } | null> {
    try {
      const address = AGGREGATORS[asset.toUpperCase()];
      if (!address) {
        Logger.warn(`No Chainlink aggregator found for asset: ${asset}`);
        return null;
      }

      const contract = new ethers.Contract(address, ABI, this.provider);
      const data = await contract.latestRoundData();

      // Chainlink BTC/USD usually has 8 decimals
      const rawPrice = Number(data.answer);
      const price = rawPrice / 100000000; 
      const timestamp = Number(data.updatedAt) * 1000; // Convert to ms

      return { price, timestamp };

    } catch (err) {
      Logger.error(`Chainlink fetch failed for ${asset}`, err);
      return null;
    }
  }
}
