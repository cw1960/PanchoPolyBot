import dotenv from 'dotenv';
import { Logger } from '../utils/logger';

dotenv.config();

export const ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  BOT_ID: process.env.BOT_ID || 'polymarket-bot-1',
  POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS || '2000', 10),
};

export function validateEnv() {
  if (!ENV.SUPABASE_URL) {
    Logger.error("Missing SUPABASE_URL in .env");
    (process as any).exit(1);
  }
  if (!ENV.SUPABASE_SERVICE_ROLE_KEY) {
    Logger.error("Missing SUPABASE_SERVICE_ROLE_KEY in .env");
    (process as any).exit(1);
  }
}