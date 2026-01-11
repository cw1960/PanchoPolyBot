
export interface BotControl {
  id: number;
  desired_state: 'running' | 'stopped';
  updated_at: string;
}

export interface ExperimentParams {
  direction?: 'UP' | 'DOWN' | 'BOTH';
  tradeSize?: number;
  maxExposure?: number;
  confidenceThreshold?: number;
  cooldown?: number;
}

export interface Market {
  id: string; // UUID
  polymarket_market_id: string;
  asset: string; // 'BTC', 'ETH'
  direction: 'UP' | 'DOWN';
  enabled: boolean;
  max_exposure: number;
  min_price_delta: number;
  max_entry_price: number;
  active_run_id?: string; // Optional: Link to a specific test run
  // Internal Runtime Data
  _run?: TestRun;
  
  // New Runtime Fields for 15m Markets
  t_open?: string;      // ISO Timestamp of market start
  t_expiry?: string;    // ISO Timestamp of market end
  baseline_price?: number; // The reference price at t_open
}

// The "Eyes" of the bot. Written by EdgeEngine, read by UI.
export interface MarketStateRow {
  market_id: string;
  run_id?: string; // Added for strict exposure scoping
  status: 'WATCHING' | 'OPPORTUNITY' | 'LOCKED';
  chainlink_price: number;
  spot_price_median: number;
  delta: number;
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
  confidence: number;
  exposure: number;
  last_update: string;
}

export interface TestRun {
  id: string;
  name: string;
  status: 'PLANNED' | 'RUNNING' | 'COMPLETED';
  params: ExperimentParams;
}

export interface TradeEventRow {
  test_run_id?: string;
  market_id: string;
  polymarket_market_id: string;
  asset: string;
  side: string;
  stake_usd: number;
  entry_prob: number;
  confidence: number;
  decision_reason: string;
  status: string;
  outcome?: string;
  edge_after_fees_pct?: number;
  ev_after_fees_usd?: number;
  fees?: any;
  context?: any;
  signals?: any;
  error?: string;
  created_at?: string;
}

export interface TradeLedgerRow {
  id?: string; // uuid, optional on insert
  run_id: string;
  market_id: string;
  polymarket_market_id: string;
  mode: 'DRY_RUN' | 'LIVE';
  side: 'YES' | 'NO';
  size_usd: number;
  entry_price: number;
  exit_price?: number;
  status: 'OPEN' | 'CLOSED' | 'VOID';
  realized_pnl: number;
  unrealized_pnl: number;
  opened_at: string;
  closed_at?: string;
  metadata?: any;
}
