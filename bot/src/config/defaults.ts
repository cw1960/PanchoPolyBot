/**
 * config/defaults.ts
 * 
 * Responsibilities:
 * 1. Store fallback values for non-critical configuration.
 * 2. Define constant timeouts and intervals.
 */

export const DEFAULTS = {
  POLL_INTERVAL_MS: 1000,     // How often to check for price updates
  SYNC_INTERVAL_MS: 5000,     // How often to sync config from Supabase
  MAX_RETRIES: 3,             // Network retry limit
  DEFAULT_BET_SIZE: 10,       // Safe default bet size in USDC
};
