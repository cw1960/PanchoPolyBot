
import { IsolatedMarketAccount } from '../types/accounts';
import { Logger } from '../utils/logger';
import { telemetry } from './telemetry';

const INITIAL_BANKROLL = 500;

export const MARKET_CONFIGS = [
    { asset: "BTC", direction: "UP" },
    { asset: "BTC", direction: "DOWN" },
    { asset: "ETH", direction: "UP" },
    { asset: "ETH", direction: "DOWN" },
    { asset: "SOL", direction: "UP" },
    { asset: "SOL", direction: "DOWN" },
    { asset: "XRP", direction: "UP" },
    { asset: "XRP", direction: "DOWN" },
] as const;

export class AccountManager {
    private accounts: Map<string, IsolatedMarketAccount> = new Map();
    private lastSnapshotTime: number = 0;

    constructor() {
        this.initialize();
    }

    private initialize() {
        MARKET_CONFIGS.forEach(cfg => {
            const key = `${cfg.asset}_${cfg.direction}`;
            this.accounts.set(key, {
                marketKey: key,
                asset: cfg.asset,
                direction: cfg.direction as "UP" | "DOWN",
                bankroll: INITIAL_BANKROLL,
                maxExposure: INITIAL_BANKROLL, // Max exposure = Current Bankroll (No leverage)
                currentExposure: 0,
                realizedPnL: 0,
                unrealizedPnL: 0,
                isActive: true
            });
            Logger.info(`[ACCOUNT_INIT] Initialized ${key} with $${INITIAL_BANKROLL}`);
        });
    }

    /**
     * Retrieves the isolated account for a given asset and direction.
     * @param asset Asset symbol (e.g. BTC)
     * @param direction Trade direction (UP or DOWN)
     */
    public getAccount(asset: string, direction: string): IsolatedMarketAccount {
        // Normalize
        const normAsset = asset.toUpperCase();
        const normDir = direction.toUpperCase();
        
        const key = `${normAsset}_${normDir}`;
        const account = this.accounts.get(key);
        
        if (!account) {
            // If an asset is traded that isn't in our hardcoded 8, we throw/error to enforce isolation.
            // Or we could create a default bucket, but strict isolation request suggests failing loudly.
            Logger.error(`[ACCOUNT_MANAGER] No isolated account found for ${key}`);
            throw new Error(`No isolated account for ${key}`);
        }
        return account;
    }

    /**
     * Updates exposure for a specific account. 
     * Called by ExecutionService on new trades.
     */
    public updateExposure(asset: string, direction: string, delta: number) {
        try {
            const account = this.getAccount(asset, direction);
            account.currentExposure += delta;
            // Prevent negative exposure drift from rounding errors
            if (account.currentExposure < 0) account.currentExposure = 0;
            
            this.logState(account);
            this.maybeSnapshot();
        } catch (e) {
            Logger.error(`[ACCOUNT_MANAGER] Failed to update exposure`, e);
        }
    }

    /**
     * Updates PnL and Bankroll for a specific account.
     * Called by PnLLedger on settlement/exit.
     */
    public updatePnL(asset: string, direction: string, realizedDelta: number) {
        try {
            const account = this.getAccount(asset, direction);
            account.realizedPnL += realizedDelta;
            account.bankroll += realizedDelta;
            
            // Dynamic Risk Adjustment: Max Exposure scales with Bankroll
            account.maxExposure = Math.max(0, account.bankroll);
            
            this.logState(account);
            this.maybeSnapshot();
        } catch (e) {
             Logger.error(`[ACCOUNT_MANAGER] Failed to update PnL`, e);
        }
    }

    private logState(acc: IsolatedMarketAccount) {
        Logger.info(`[MARKET ${acc.marketKey}] bankroll=${acc.bankroll.toFixed(2)} exposure=${acc.currentExposure.toFixed(2)} pnl=${acc.realizedPnL.toFixed(2)}`);
    }

    /**
     * Records a global bankroll snapshot to Supabase occasionally.
     */
    private maybeSnapshot() {
        const now = Date.now();
        // Throttle snapshots to every 10 minutes unless force called
        if (now - this.lastSnapshotTime < 600000) return;

        this.lastSnapshotTime = now;

        let totalBankroll = 0;
        let totalExposure = 0;
        let activeCount = 0;

        for (const acc of this.accounts.values()) {
            totalBankroll += acc.bankroll;
            totalExposure += acc.currentExposure;
            if (acc.currentExposure > 0) activeCount++;
        }

        telemetry.logBankroll({
            total_bankroll_usd: totalBankroll,
            cap_per_market_usd: 100, // Hardcoded per strategy def for now
            total_exposure_usd: totalExposure,
            active_markets_count: activeCount
        });
    }
}

export const accountManager = new AccountManager();
