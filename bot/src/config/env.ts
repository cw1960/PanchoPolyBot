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
  
  // Oracle Mode (Mock vs Real)
  DRY_RUN: DRY_RUN,
  
  // Execution Mode (Paper vs Live)
  EXECUTION_MODE: EXECUTION_MODE,

  // Trading Credentials (Required only for LIVE)
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

  const executionMode =
    process.env.EXECUTION_MODE === 'LIVE' ? 'LIVE' : 'PAPER';

  // ---- Always required ----
  if (!ENV.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!ENV.SUPABASE_SERVICE_ROLE_KEY)
    missing.push('SUPABASE_SERVICE_ROLE_KEY');

  // ---- Required only in LIVE mode ----
  if (executionMode === 'LIVE') {
    if (!ENV.PRIVATE_KEY) missing.push('PRIVATE_KEY');
    if (!ENV.POLY_API_KEY) missing.push('POLY_API_KEY');
    if (!ENV.POLY_API_SECRET) missing.push('POLY_API_SECRET');
    if (!ENV.POLY_PASSPHRASE) missing.push('POLY_PASSPHRASE');
  }

  if (missing.length > 0) {
    throw new Error(
      `[CONFIG_FATAL] Missing required ENV variables for ${executionMode} mode: ${missing.join(
        ', '
      )}`
    );
  }

  if (executionMode === 'PAPER' && ENV.DRY_RUN !== false) {
    throw new Error(
      `[CONFIG_FATAL] PAPER mode requires DRY_RUN=false (real oracles)`
    );
  }

  console.log(
    executionMode === 'LIVE'
      ? '[MODE] EXECUTION_MODE=LIVE (real trading enabled)'
      : '[MODE] EXECUTION_MODE=PAPER (execution disabled)'
  );
}
