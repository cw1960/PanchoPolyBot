import dotenv from 'dotenv';
import { Logger } from '../utils/logger';

dotenv.config();

export const ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  BOT_ID: process.env.BOT_ID || 'polymarket-bot-1',
  POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS || '1000', 10),
  
  // Safety
  DRY_RUN: process.env.DRY_RUN === 'true', // If true, no real orders sent

  // Trading Credentials
  PRIVATE_KEY: process.env.PRIVATE_KEY || '',
  POLY_API_KEY: process.env.POLY_API_KEY || '',
  POLY_API_SECRET: process.env.POLY_API_SECRET || '',
  POLY_PASSPHRASE: process.env.POLY_PASSPHRASE || '',
};

export function validateEnv() {
  const missing: string[] = [];
  if (!ENV.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!ENV.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!ENV.PRIVATE_KEY) missing.push("PRIVATE_KEY");
  
  // API keys strictly required only if NOT dry run
  if (!ENV.DRY_RUN) {
    if (!ENV.POLY_API_KEY) missing.push("POLY_API_KEY");
  }

  if (missing.length > 0) {
    Logger.error(`Missing required ENV variables: ${missing.join(', ')}`);
    (process as any).exit(1);
  }

  if (ENV.DRY_RUN) {
    Logger.warn("!!! RUNNING IN DRY_RUN MODE - NO REAL TRADES !!!");
  }
}
