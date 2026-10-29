import './main.js';
import { loadAccount, login, register, logout, resendConfirmation, updateProfile } from '../services/auth.js';
import { requestOrganization, listRequests } from '../services/access.js';
import { authBg, authError, callbackBg } from '../i18n/auth-bg.js';
import { readAuthCallback, callbackNotice } from '../domain/auth-callback.js';
import { bindForm, message } from '../ui/forms.js';

const field = (data, name) => String(data.get(name) || '').trim();
async function refresh() {
  const account = await loadAccount();
  document.querySelector('#signed-out').hidden = Boolean(account);
  document.querySelector('#signed-in').hidden = !account;
  if (!account) return null;
  document.querySelector('#account-name').textContent = account.profile.display_name;
  document.querySelector('#account-uuid').textContent = account.user.id;
  document.querySelector('#profile-name').value = account.profile.display_name;
  document.querySelector('#account-status').textContent = account.profile.status === 'pending' ? authBg.pending : 'Показват се само контекстите, разрешени от текущите назначения.';
  const contexts = document.querySelector('#contexts');
  contexts.replaceChildren();
  for (const context of account.contexts) {
    const li = document.createElement('li');
    li.textContent = `${context.organization_name} · ${context.scope_label}`;
    contexts.append(li);
  }
  if (!account.contexts.length) contexts.textContent = 'Все още няма разрешени управленски обхвати.';
  const requests = await listRequests();
  document.querySelector('#requests').textContent = requests.filter(r => r.requester_profile_id === account.profile.id).map(r => `${r.request_payload.name}: ${r.status === 'pending' ? 'очаква преглед' : r.status === 'fulfilled' ? 'активирана' : 'отказана'}`).join(' · ') || 'Нямаш подадени заявки.';
  document.querySelector('#organization-request').hidden = requests.some(r => r.requester_profile_id === account.profile.id && r.status === 'pending');
  return account;
}
bindForm('#login', async (data, form) => { await login(field(data, 'email'), String(data.get('password'))); form.reset(); await refresh(); message('Успешен вход.'); });
bindForm('#register', async (data, form) => {
  const password = String(data.get('password'));
  if (password !== String(data.get('password-confirm'))) { message('Паролите не съвпадат.', true); return; }
  await register(field(data, 'email'), password, field(data, 'name'));
  form.reset(); await refresh(); message(authBg.signup);
});
bindForm('#resend', async data => { await resendConfirmation(field(data, 'email')); message('Ако заявката е допустима, ще получиш ново писмо за потвърждение.'); });
bindForm('#profile', async data => { await updateProfile(field(data, 'name')); await refresh(); message('Името е запазено.'); });
bindForm('#organization-request', async data => {
  const account = await loadAccount();
  if (!account) throw new Error('Session required');
  await requestOrganization(account.profile.id, field(data, 'name'), field(data, 'kind'));
  await refresh(); message('Заявката очаква проверка. Тя не предоставя права.');
});
document.querySelector('#logout').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  try { await logout(); location.replace(new URL('pages/account.html', new URL(import.meta.env.BASE_URL, location.origin))); }
  catch(error) { message(authError(error), true); event.currentTarget.disabled = false; }
});
const callback = readAuthCallback(new URL(location.href));
try {
  if (callback.hasError) history.replaceState(null, '', location.pathname);
  const account = await refresh();
  const notice = callbackNotice(callback, Boolean(account?.user.email_confirmed_at));
  if (notice) message(callbackBg[notice], !account);
} catch(error) {
  message(callback.present ? callbackBg.session : authError(error), true);
  // A disabled/broken account must still be able to end its local session.
  const { getClient } = await import('../services/supabase.js');
  try {
    const { data: { session } } = await getClient().auth.getSession();
    if (session) {
      const button = document.querySelector('#logout');
      document.querySelector('#message').after(button);
      button.hidden = false;
    }
  } catch { /* The configuration error is already visible. */ }
} finally {
  // The SDK needs the PKCE code during initialization, then it must leave the address bar.
  if (callback.present) history.replaceState(null, '', location.pathname);
}
