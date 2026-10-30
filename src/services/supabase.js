import { createClient } from '@supabase/supabase-js';

let client;
const recoveryKey = 'propertyhub.password-recovery-user';
const recoveryRequestKey = 'propertyhub.password-recovery-requested';
// A tab-local UI hint only. Auth validates the session and password update server-side.
export function clearRecoverySession() { sessionStorage.removeItem(recoveryKey); sessionStorage.removeItem(recoveryRequestKey); }
export function isRecoverySession(userId) { return Boolean(userId) && sessionStorage.getItem(recoveryKey) === userId; }
export function isRecoveryRequested() { return sessionStorage.getItem(recoveryRequestKey) === 'true'; }
export function markRecoveryRequested() { sessionStorage.setItem(recoveryRequestKey, 'true'); }
export function getClient() {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Липсва конфигурация за връзката.');
  if (!key.startsWith('sb_publishable_')) throw new Error('Невалиден публичен ключ.');
  client = createClient(url, key, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } });
  // Clear rendered data in other open tabs when this browser signs out.
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') sessionStorage.setItem(recoveryKey, session.user.id);
    // The SDK also emits SIGNED_IN on reload/focus; preserve the same recovery tab.
    if (event === 'SIGNED_OUT' || event === 'SIGNED_IN' && !isRecoverySession(session?.user.id)) clearRecoverySession();
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
