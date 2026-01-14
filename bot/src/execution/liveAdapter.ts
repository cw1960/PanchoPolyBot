
import { ExecutionAdapter, OrderDetails } from './adapter';
import { polymarket } from '../services/polymarket';
import { EXECUTION_MODE } from '../config/executionMode';

export class LiveExecutionAdapter implements ExecutionAdapter {
    constructor() {
        if (EXECUTION_MODE !== 'LIVE') {
            throw new Error(`[EXECUTION_FATAL] LiveExecutionAdapter instantiated in ${EXECUTION_MODE} mode.`);
        }
    }

    async placeOrder(tokenId: string, side: 'BUY' | 'SELL', price: number, size: number): Promise<string> {
        return await polymarket.placeOrder(tokenId, side, price, size);
    }

    async cancelOrder(orderId: string): Promise<void> {
        return await polymarket.cancelOrder(orderId);
    }

    async getOrder(orderId: string): Promise<OrderDetails | null> {
        return await polymarket.getOrder(orderId);
    }
}
