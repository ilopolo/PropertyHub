import { getClient, unwrap, isRecoverySession, clearRecoverySession, markRecoveryRequested } from './supabase.js';

export const callbackUrl = () => new URL('pages/account.html', new URL(import.meta.env.BASE_URL, location.origin)).href;
export async function register(email, password, displayName) {
  clearRecoverySession();
  return unwrap(await getClient().auth.signUp({ email, password, options: { emailRedirectTo: callbackUrl(), data: { display_name: displayName } } }));
}
export async function login(email, password) {
  clearRecoverySession();
  return unwrap(await getClient().auth.signInWithPassword({ email, password }));
}
export async function logout() {
  unwrap(await getClient().auth.signOut({ scope: 'local' }));
}
export async function resendConfirmation(email) {
  clearRecoverySession();
  return unwrap(await getClient().auth.resend({ type: 'signup', email, options: { emailRedirectTo: callbackUrl() } }));
}
export async function requestPasswordReset(email) {
  clearRecoverySession();
  const result = unwrap(await getClient().auth.resetPasswordForEmail(email, { redirectTo: callbackUrl() }));
  markRecoveryRequested();
  return result;
}
export async function loadPasswordRecovery() {
  const { session } = unwrap(await getClient().auth.getSession());
  if (!session || !isRecoverySession(session.user.id)) return null;
  const { user } = unwrap(await getClient().auth.getUser());
  return user.email_confirmed_at && user.id === session.user.id ? user : null;
}
export async function resetPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('Invalid password length');
  if (!await loadPasswordRecovery()) throw new Error('Recovery session required');
  unwrap(await getClient().auth.updateUser({ password }));
  clearRecoverySession();
}
export async function loadAccount() {
  const { data: { session }, error } = await getClient().auth.getSession();
  if (error) throw error;
  if (!session) return null;
  const { user } = unwrap(await getClient().auth.getUser());
  if (!user.email_confirmed_at) throw new Error('Потвърди имейла си преди достъп.');
  // Metadata supplies a display label only. All permissions come from current DB grants.
  const name = typeof user.user_metadata?.display_name === 'string' ? user.user_metadata.display_name.slice(0, 100).trim() : '';
  unwrap(await getClient().rpc('ensure_profile', { display_name: name || 'Потребител' }));
  const profile = unwrap(await getClient().from('profiles').select('id,display_name,status,theme').single());
  const roles = unwrap(await getClient().from('user_roles').select('id,role_code,membership_id,scope_id,permissions,valid_from,valid_to'));
  const organizations = unwrap(await getClient().from('organizations').select('id,name,organization_kind,status'));
  const contexts = unwrap(await getClient().rpc('my_contexts'));
  return { user, profile, roles, organizations, contexts };
}
export async function updateProfile(displayName) {
  const account = await loadAccount();
  if (!account) throw new Error('Влез в акаунта си.');
  return unwrap(await getClient().from('profiles').update({ display_name: displayName }).eq('id', account.profile.id).select('id,display_name').single());
}
