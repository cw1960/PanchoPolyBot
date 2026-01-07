/**
 * infra/logger.ts
 * 
 * Responsibilities:
 * 1. Standardize log format (Timestamp, Level, Component).
 * 2. Maybe send critical logs to Supabase/Discord in the future.
 */

export const Logger = {
  info: (msg: string) => console.log(`[INFO] ${new Date().toISOString()}: ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${new Date().toISOString()}: ${msg}`),
  warn: (msg: string) => console.warn(`[WARN] ${new Date().toISOString()}: ${msg}`),
};
