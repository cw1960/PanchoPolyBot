/**
 * infra/supabase.ts
 * 
 * Responsibilities:
 * 1. Fetch configuration (read-only mostly).
 * 2. Listen for "Realtime" events (Commands from UI).
 * 3. Log trades and errors back to the database.
 */

export class SupabaseAdapter {
  constructor() {
    // Initialize Supabase Client
  }

  public async fetchActiveMarkets() {
    // Returns list of markets from DB
    return [];
  }

  public async logTrade(tradeData: any) {
    // Writes trade result to DB
  }
}
