import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { child } from './lib/logger.js';

const log = child({ mod: 'supabase' });

export const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { 'X-Client-Info': 'hugotaslot-bot/1.0' } },
});

/**
 * Lit / écrit l'état du bot dans public.bot_state (k/v jsonb).
 */
export async function getBotState(key) {
  const { data, error } = await supabase
    .from('bot_state')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') {
    log.warn({ err: error }, `getBotState(${key}) failed`);
    return null;
  }
  return data?.value ?? null;
}

export async function setBotState(key, value) {
  const { error } = await supabase
    .from('bot_state')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) log.warn({ err: error }, `setBotState(${key}) failed`);
}

export async function ping() {
  const { error } = await supabase.from('bot_state').select('key').limit(1);
  return !error;
}
