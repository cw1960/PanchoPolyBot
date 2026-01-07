import { createClient } from '@supabase/supabase-js';

// ------------------------------------------------------------------
// ⚠️ ACTION REQUIRED: REPLACE THESE VALUES WITH YOUR SUPABASE KEYS
// ------------------------------------------------------------------
// NOTE: We use a dummy HTTPS URL here to prevent the app from crashing on startup.
// You must replace these with your actual Supabase Project URL and Anon Key.
const SUPABASE_URL = 'https://INSERT_YOUR_PROJECT_URL.supabase.co';
const SUPABASE_ANON_KEY = 'INSERT_YOUR_ANON_KEY';

if (SUPABASE_URL.includes('INSERT') || SUPABASE_ANON_KEY.includes('INSERT')) {
  console.warn("⚠️ SUPABASE CREDENTIALS MISSING. Please update services/supabaseClient.ts");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
