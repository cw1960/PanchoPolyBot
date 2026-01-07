/**
 * config/env.ts
 * 
 * Responsibilities:
 * 1. Load environment variables from .env
 * 2. Validate that critical keys (Private Keys, API Keys) exist
 * 3. Fail fast if configuration is missing
 */

import dotenv from 'dotenv';

dotenv.config();

export const ENV = {
  // VPS <-> Supabase Connection
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_KEY: process.env.SUPABASE_KEY || '',

  // Polymarket Credentials (VPS only, never shared)
  PRIVATE_KEY: process.env.PRIVATE_KEY || '',
  POLY_API_KEY: process.env.POLY_API_KEY || '',
  POLY_API_SECRET: process.env.POLY_API_SECRET || '',
  POLY_PASSPHRASE: process.env.POLY_PASSPHRASE || '',
};

export function validateEnv() {
  if (!ENV.PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY");
  if (!ENV.SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  // Full validation logic to be added later
}
