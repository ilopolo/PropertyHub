import { createClient } from '@supabase/supabase-js';

let client;
export function getClient() {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Липсва конфигурация за връзката.');
  if (!key.startsWith('sb_publishable_')) throw new Error('Невалиден публичен ключ.');
  client = createClient(url, key, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } });
  // Clear rendered data in other open tabs when this browser signs out.
  client.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') setTimeout(() => {
      location.replace(new URL('pages/account.html', new URL(import.meta.env.BASE_URL, location.origin)));
    }, 0);
  });
  return client;
}
export function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}
