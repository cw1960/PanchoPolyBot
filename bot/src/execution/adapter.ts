
export interface OrderResult {
    orderId: string;
    success: boolean;
    error?: string;
}

export interface OrderDetails {
    sizeMatched: string; // From ClobClient
    // Add other fields if necessary
}

export interface ExecutionAdapter {
    placeOrder(
        tokenId: string, 
        side: 'BUY' | 'SELL', 
        price: number, 
        size: number
    ): Promise<string>; // Returns orderId or throws

    cancelOrder(orderId: string): Promise<void>;

    getOrder(orderId: string): Promise<OrderDetails | null>;
}
