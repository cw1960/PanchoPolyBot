
import { ExecutionAdapter, OrderDetails } from './adapter';
import { logPaperAction, PaperActionPayload } from '../telemetry/paperTelemetry';
import { Logger } from '../utils/logger';

export class PaperExecutionAdapter implements ExecutionAdapter {
    private context: Partial<PaperActionPayload>;

    constructor(context: Partial<PaperActionPayload>) {
        this.context = context;
    }

    async placeOrder(tokenId: string, side: 'BUY' | 'SELL', price: number, size: number): Promise<string> {
        const orderId = `paper_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Log the intent
        if (this.context.asset && this.context.marketId) {
             const payload: PaperActionPayload = {
                 ...this.context as PaperActionPayload,
                 action: 'ENTER',
                 intendedOrder: {
                     type: 'LIMIT',
                     price,
                     size,
                     isMaker: false // Assumption, can be updated by caller context logic
                 }
             };
             await logPaperAction(payload);
        }

        Logger.info(`[PAPER_EXEC] Simulated Order Placed: ${orderId} | ${side} | ${size} @ ${price}`);
        return orderId;
    }

    async cancelOrder(orderId: string): Promise<void> {
        Logger.info(`[PAPER_EXEC] Simulated Order Cancel: ${orderId}`);
    }

    async getOrder(orderId: string): Promise<OrderDetails | null> {
        // Return 0 matched to simulate unfilled Maker orders, forcing Taker fallback logic
        return { sizeMatched: "0" };
    }
}
