import { createClient } from '@supabase/supabase-js';

// ------------------------------------------------------------------
// ⚠️ ACTION REQUIRED: REPLACE THESE VALUES WITH YOUR SUPABASE KEYS
// ------------------------------------------------------------------
const SUPABASE_URL = 'https://bnobbksmuhhnikjprems.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJub2Jia3NtdWhobmlranByZW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4MTIzNjUsImV4cCI6MjA4MzM4ODM2NX0.hVIHTZ-dEaa1KDlm1X5SqolsxW87ehYQcPibLWmnCWg';

if (SUPABASE_URL.includes('INSERT') || SUPABASE_ANON_KEY.includes('INSERT')) {
  console.error("⚠️ SUPABASE CREDENTIALS MISSING. Please update services/supabaseClient.ts");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
