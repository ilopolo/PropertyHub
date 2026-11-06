import { createClient } from '@supabase/supabase-js';

let client;
let identity, revision = 0;
const identityListeners = new Set();
export const sessionRevision = () => revision;
export const sameSession = version => version === revision;
export function onSessionIdentity(listener) {
  identityListeners.add(listener);
  if (identity !== undefined) listener({userId:identity,changed:false,initial:true});
  return () => identityListeners.delete(listener);
}
function observeIdentity(session) {
  const userId=session?.user?.id||null,initial=identity===undefined,changed=!initial&&identity!==userId;
  if(changed)revision++;
  identity=userId;
  for(const listener of identityListeners)listener({userId,initial,changed});
}
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
  // One SDK subscription owns identity changes, including anonymous -> signed in.
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') sessionStorage.setItem(recoveryKey, session.user.id);
    // The SDK also emits SIGNED_IN on reload/focus; preserve the same recovery tab.
    if (event === 'SIGNED_OUT' || event === 'SIGNED_IN' && !isRecoverySession(session?.user.id)) clearRecoverySession();
    observeIdentity(session);
  });
  return client;
}
export function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}
