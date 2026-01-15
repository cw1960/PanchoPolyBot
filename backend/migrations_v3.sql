
-- 1. Market Results Table
-- Captures the finalized outcome of a single market cycle
CREATE TABLE IF NOT EXISTS market_results (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id text NOT NULL, -- Logical link to the configuration run
    market_id uuid REFERENCES markets(id),
    polymarket_market_id text NOT NULL,
    asset text NOT NULL,
    
    -- Timestamps
    market_start_time timestamptz,
    market_end_time timestamptz,
    recorded_at timestamptz DEFAULT now(),

    -- Performance Metrics
    total_trades int NOT NULL DEFAULT 0,
    total_volume_usd numeric NOT NULL DEFAULT 0, -- Sum of all entry sizes
    gross_pnl numeric NOT NULL DEFAULT 0,
    net_pnl numeric NOT NULL DEFAULT 0, -- After fees/slippage
    roi_pct numeric NOT NULL DEFAULT 0, -- net_pnl / total_volume
    
    -- Metadata
    resolution_source text NOT NULL, -- 'EXPIRY', 'DEFENSIVE_EXIT', 'MANUAL'
    winning_outcome text -- 'UP', 'DOWN', 'N/A'
);

-- Index for fast retrieval of charts
CREATE INDEX idx_market_results_recorded_at ON market_results(recorded_at);
