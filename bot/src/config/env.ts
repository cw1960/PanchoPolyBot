
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
  if (!ENV.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!ENV.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!ENV.PRIVATE_KEY) missing.push("PRIVATE_KEY");
  
  // API keys are only strictly required if we are NOT in legacy dry run mode.
  if (!ENV.DRY_RUN) {
    if (!ENV.POLY_API_KEY) missing.push("POLY_API_KEY");
    if (!ENV.POLY_API_SECRET) missing.push("POLY_API_SECRET");
    if (!ENV.POLY_PASSPHRASE) missing.push("POLY_PASSPHRASE");
  }

  // VALIDATE PAPER MODE CONFIGURATION
  // PAPER mode implies Real Oracles + Fake Execution.
  // DRY_RUN=true means Fake Oracles.
  // Therefore, PAPER mode REQUIRES DRY_RUN=false.
  if (ENV.EXECUTION_MODE === 'PAPER' && ENV.DRY_RUN) {
     Logger.error("INVALID CONFIG: EXECUTION_MODE='PAPER' requires DRY_RUN='false' to use real oracles.");
     (process as any).exit(1);
  }

  if (missing.length > 0) {
    Logger.error(`Missing required ENV variables: ${missing.join(', ')}`);
    (process as any).exit(1);
  }

  if (ENV.DRY_RUN) {
    Logger.warn("!!! RUNNING IN LEGACY DRY_RUN MODE - MOCK ORACLES ACTIVE !!!");
  } else {
    Logger.info(`[ENV] REAL ORACLES ACTIVE. Execution Mode: ${ENV.EXECUTION_MODE}`);
  }

  if (!ENV.API_KEY) {
    Logger.warn("Missing API_KEY. AI Analysis features will be unavailable.");
  }

  if (ENV.AUTO_ROTATION) {
    Logger.info(`[AUTO_ROTATION] ENABLED for assets: ${ENV.ROTATION_ASSETS.join(', ')}`);
  }
}
