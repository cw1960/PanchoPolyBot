
-- 1. High-Frequency Tick Data
-- Captures the exact state of the bot's brain every cycle
CREATE TABLE IF NOT EXISTS bot_ticks (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id text,
    market_slug text NOT NULL,
    ts timestamptz DEFAULT now(),
    
    -- Pricing
    yes_price numeric, -- Best Ask for YES
    no_price numeric,  -- Best Ask for NO
    spread numeric,    -- Spread on the active side
    pair_cost numeric, -- YES + NO cost (Vig check)
    
    -- Model
    model_prob numeric,
    edge_raw numeric,
    edge_after_fees numeric,
    
    -- Sizing / Risk
    kelly_fraction numeric,
    recommended_size_usd numeric,
    actual_size_usd numeric, -- If a trade occurred
    
    -- Context
    signal_tag text,   -- 'BUY', 'WAIT', 'VETO'
    regime_tag text    -- 'LOW_VOL', 'NORMAL', 'HIGH_VOL'
);

-- Index for time-series queries
CREATE INDEX idx_bot_ticks_ts ON bot_ticks(ts);
CREATE INDEX idx_bot_ticks_slug ON bot_ticks(market_slug);

-- 2. Market Summary
-- Aggregates performance after a market closes
CREATE TABLE IF NOT EXISTS bot_markets (
    slug text PRIMARY KEY,
    run_id text,
    start_time timestamptz,
    end_time timestamptz,
    
    total_pnl_usd numeric DEFAULT 0,
    total_fees_usd numeric DEFAULT 0,
    trade_count int DEFAULT 0,
    
    avg_edge_captured numeric DEFAULT 0,
    max_drawdown_usd numeric DEFAULT 0,
    regime_tag text
);

-- 3. Bankroll Snapshot
-- Tracks capital curves over time
CREATE TABLE IF NOT EXISTS bot_bankroll (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    ts timestamptz DEFAULT now(),
    
    total_bankroll_usd numeric,
    cap_per_market_usd numeric,
    total_exposure_usd numeric,
    
    active_markets_count int
);
