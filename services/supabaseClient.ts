import { createClient } from '@supabase/supabase-js';

// ------------------------------------------------------------------
// ⚠️ ACTION REQUIRED: REPLACE THESE VALUES WITH YOUR SUPABASE KEYS
// ------------------------------------------------------------------
const SUPABASE_URL = 'INSERT_SUPABASE_URL_HERE';
const SUPABASE_ANON_KEY = 'INSERT_SUPABASE_ANON_KEY_HERE';

if (SUPABASE_URL.includes('INSERT') || SUPABASE_ANON_KEY.includes('INSERT')) {
  console.error("⚠️ SUPABASE CREDENTIALS MISSING. Please update services/supabaseClient.ts");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
