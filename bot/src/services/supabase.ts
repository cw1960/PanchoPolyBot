import { createClient } from '@supabase/supabase-js';
import { ENV } from '../config/env';
import { Logger } from '../utils/logger';

// We use the Service Role Key here because this runs on a secure VPS
// and needs to bypass RLS for administrative tasks/logging.
export const supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  }
});

export const logEvent = async (level: 'INFO' | 'WARN' | 'ERROR', message: string) => {
  try {
    await supabase.from('bot_events').insert({
      level,
      message: `[${ENV.BOT_ID}] ${message}`
    });
  } catch (err) {
    Logger.error("Failed to push log to Supabase", err);
  }
};
