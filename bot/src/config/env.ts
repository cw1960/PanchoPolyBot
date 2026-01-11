
import dotenv from 'dotenv';
import { Logger } from '../utils/logger';

dotenv.config();

export const ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  BOT_ID: process.env.BOT_ID || 'polymarket-bot-1',
  POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS || '1000', 10),
  
  // Safety: Dry Run Mode
  // If set to true, the execution engine will simulate trades but NOT send them to Polymarket.
  DRY_RUN: process.env.DRY_RUN === 'true', 

  // Trading Credentials
  PRIVATE_KEY: process.env.PRIVATE_KEY || '',
  POLY_API_KEY: process.env.POLY_API_KEY || '',
  POLY_API_SECRET: process.env.POLY_API_SECRET || '',
  POLY_PASSPHRASE: process.env.POLY_PASSPHRASE || '',

  // AI Analysis
  API_KEY: process.env.API_KEY || '',
};

export function validateEnv() {
  const missing: string[] = [];
  if (!ENV.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!ENV.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!ENV.PRIVATE_KEY) missing.push("PRIVATE_KEY");
  
  // API keys are only strictly required if we are NOT in dry run mode.
  if (!ENV.DRY_RUN) {
    if (!ENV.POLY_API_KEY) missing.push("POLY_API_KEY");
    if (!ENV.POLY_API_SECRET) missing.push("POLY_API_SECRET");
    if (!ENV.POLY_PASSPHRASE) missing.push("POLY_PASSPHRASE");
  }

  if (missing.length > 0) {
    Logger.error(`Missing required ENV variables: ${missing.join(', ')}`);
    (process as any).exit(1);
  }

  if (ENV.DRY_RUN) {
    Logger.warn("!!! RUNNING IN DRY_RUN MODE - NO REAL TRADES WILL BE EXECUTED !!!");
  }

  if (!ENV.API_KEY) {
    Logger.warn("Missing API_KEY. AI Analysis features will be unavailable.");
  }
}
