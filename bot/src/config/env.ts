
import dotenv from 'dotenv';
import { Logger } from '../utils/logger';
import { EXECUTION_MODE } from './executionMode';

dotenv.config();

// Authoritative DRY_RUN constant
// Defaults to TRUE (Safe Mode) if not explicitly set to 'false'
export const DRY_RUN = process.env.DRY_RUN !== 'false';

export const ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  BOT_ID: process.env.BOT_ID || 'polymarket-bot-1',
  POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS || '1000', 10),
  
  // Safety: Dry Run Mode
  DRY_RUN: DRY_RUN,
  EXECUTION_MODE: EXECUTION_MODE,

  // Trading Credentials
  PRIVATE_KEY: process.env.PRIVATE_KEY || '',
  POLY_API_KEY: process.env.POLY_API_KEY || '',
  POLY_API_SECRET: process.env.POLY_API_SECRET || '',
  POLY_PASSPHRASE: process.env.POLY_PASSPHRASE || '',

  // AI Analysis
  API_KEY: process.env.API_KEY || '',

  // Automated Rotation
  AUTO_ROTATION: process.env.AUTO_ROTATION === 'true',
  ROTATION_ASSETS: (process.env.ROTATION_ASSETS || 'BTC').split(',').map(s => s.trim())
};

export function validateEnv() {
  const missing: string[] = [];

  // Common Requirements (Supabase)
  if (!ENV.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!ENV.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  
  // 1. LIVE Mode Validation (Strict Credentials)
  if (ENV.EXECUTION_MODE === 'LIVE') {
    if (!ENV.PRIVATE_KEY) missing.push("PRIVATE_KEY");
    if (!ENV.POLY_API_KEY) missing.push("POLY_API_KEY");
    if (!ENV.POLY_API_SECRET) missing.push("POLY_API_SECRET");
    if (!ENV.POLY_PASSPHRASE) missing.push("POLY_PASSPHRASE");
  }

  // 2. PAPER Mode Validation (No Credentials, Real Oracles)
  if (ENV.EXECUTION_MODE === 'PAPER') {
     // Must use Real Oracles (DRY_RUN=false)
     if (ENV.DRY_RUN) {
         Logger.error("[CONFIG_FATAL] PAPER mode requires DRY_RUN=false (real oracles).");
         (process as any).exit(1);
     }

     // Warn if credentials are accidentally present (Safety Check)
     if (ENV.PRIVATE_KEY || ENV.POLY_API_KEY || ENV.POLY_API_SECRET || ENV.POLY_PASSPHRASE) {
         Logger.warn("[CONFIG_WARN] Trading credentials present but EXECUTION_MODE=PAPER — execution is disabled");
     }
  }

  // Fail on missing requirements
  if (missing.length > 0) {
    Logger.error(`[CONFIG_FATAL] Missing required ENV variables for ${ENV.EXECUTION_MODE} mode: ${missing.join(', ')}`);
    (process as any).exit(1);
  }

  // 3. Status Logging
  if (ENV.EXECUTION_MODE === 'LIVE') {
      Logger.info("[MODE] EXECUTION_MODE=LIVE (real trading enabled)");
  } else {
      Logger.info("[MODE] EXECUTION_MODE=PAPER (execution disabled)");
  }

  if (ENV.DRY_RUN) {
    Logger.warn("!!! RUNNING IN LEGACY DRY_RUN MODE - MOCK ORACLES ACTIVE !!!");
  } else {
    Logger.info(`[ENV] REAL ORACLES ACTIVE.`);
  }

  if (!ENV.API_KEY) {
    Logger.warn("Missing API_KEY. AI Analysis features will be unavailable.");
  }

  if (ENV.AUTO_ROTATION) {
    Logger.info(`[AUTO_ROTATION] ENABLED for assets: ${ENV.ROTATION_ASSETS.join(', ')}`);
  }
}
