import {humanText} from '../ui/public-text.js';
import {leaveSessionPresentation} from '../ui/shell.js';
import './main.js';
import { loadAccount, logout, updateProfile, loadPasswordRecovery, resetPassword, changePassword } from '../services/auth.js';
import { requestOrganization, listRequests, reviseRequest, closeRequest } from '../services/access.js';
import { authBg, authError, callbackBg, recoveryBg, PASSWORD_HINT } from '../i18n/auth-bg.js';
import { readAuthCallback, callbackNotice } from '../domain/auth-callback.js';
import { bindForm, message } from '../ui/forms.js';
import { clearRecoverySession, isRecoveryRequested } from '../services/supabase.js';
import { validNewPassword } from '../domain/password.js';
import {sessionRevision,sameSession} from '../services/supabase.js';
import {initializeOwnedUnits,refreshOwnedUnits} from './owner-access.js';
import {initializeMyFinances,refreshMyFinances} from './owner-finances.js';
initializeOwnedUnits();
initializeMyFinances();

const field = (data, name) => String(data.get(name) || '').trim();
let pendingRequest;
const accountLogout=document.querySelector('#logout'),accountLogoutHost=accountLogout.parentElement;
async function showLoadFailure(error,text=authError(error)){
  if(error.code==='SESSION_CHANGED')return;
  const version=sessionRevision();
  const {getClient}=await import('../services/supabase.js');
  let session;
  try{session=(await getClient().auth.getSession()).data.session;}catch{ /* Keep the safe error below. */ }
  if(!sameSession(version))return;
  document.querySelector('#signed-in').hidden=true;
  document.querySelector('#signed-out').hidden=Boolean(session);
  document.querySelector('#account-name').textContent='';
  document.querySelector('#account-uuid').textContent='';
  document.querySelector('#profile-name').value='';
  message(text,true);
  let panel=document.querySelector('#account-load-error');
  if(!panel){panel=document.createElement('section');panel.id='account-load-error';panel.className='alert alert-warning';document.querySelector('#message').after(panel);}
  panel.replaceChildren();
  const hint=document.createElement('p');hint.textContent='Данните за акаунта не са заредени. Можеш да опиташ отново или да излезеш.';
  const retry=document.createElement('button');retry.type='button';retry.className='btn btn-outline-secondary me-2';retry.id='account-load-retry';retry.textContent='Опитай отново';
  retry.onclick=async()=>{retry.disabled=true;try{await refresh();message('Данните за акаунта са заредени.');}catch(e){await showLoadFailure(e);}finally{if(retry.isConnected)retry.disabled=false;}};
  panel.append(hint,retry);
  if(session){accountLogout.hidden=false;accountLogout.disabled=false;panel.append(accountLogout);}
}
bindForm('#password-change', async (data, form) => {
  const password = String(data.get('password') || '');
  if (password !== String(data.get('password-confirm') || '')) { message(recoveryBg.mismatch, true); return; }
  if (!validNewPassword(password)) { message(PASSWORD_HINT, true); return; }
  await changePassword(password);
  form.reset();
  message(recoveryBg.updated);
});
bindForm('#password-update', async (data, form) => {
  const password = String(data.get('password') || '');
  if (password !== String(data.get('password-confirm') || '')) { message(recoveryBg.mismatch, true); return; }
  if (!validNewPassword(password)) { message(PASSWORD_HINT, true); return; }
  await resetPassword(password);
  form.reset();
  form.hidden = true;
  message(recoveryBg.updated);
});
document.querySelector('#recovery-logout').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  try { await logout(); }
  catch (error) { message(authError(error), true); event.currentTarget.disabled = false; }
});
async function refresh() {
  const version=sessionRevision();
  const account = await loadAccount();
  if(!sameSession(version))return null;
  accountLogoutHost.append(accountLogout);
  document.querySelector('#account-load-error')?.remove();
  document.querySelector('#signed-out').hidden = Boolean(account);
  document.querySelector('#signed-in').hidden = !account;
  if (!account) return null;
  await Promise.all([refreshOwnedUnits(),refreshMyFinances()]);
  if(!sameSession(version))return null;
  document.querySelector('#account-name').textContent = account.profile.display_name;
  document.querySelector('#account-uuid').textContent = account.user.id;
  document.querySelector('#profile-name').value = account.profile.display_name;
  document.querySelector('#account-status').textContent = account.profile.status === 'pending' ? authBg.pending : 'Показват се само контекстите, разрешени от текущите назначения.';
  const contexts = document.querySelector('#contexts');
  contexts.replaceChildren();
  for (const context of account.contexts) {
    const li = document.createElement('li');
    li.textContent = humanText(`${context.organization_name} · ${context.scope_label}`);
    contexts.append(li);
  }
  if (!account.contexts.length) contexts.textContent = 'Все още няма разрешени управленски обхвати.';
  const requests = await listRequests();
  if(!sameSession(version))return null;
  const states = { pending: 'очаква преглед', fulfilled: 'активирана', rejected: 'отказана', revoked: 'оттеглена' };
  document.querySelector('#requests').textContent = requests.filter(r => r.requester_profile_id === account.profile.id).map(r => `${r.request_payload.name}: ${states[r.status]}${r.review_note ? ` · ${r.review_note}` : ''}`).join(' · ') || 'Нямаш подадени заявки.';
  pendingRequest = requests.find(r => r.requester_profile_id === account.profile.id && r.status === 'pending');
  document.querySelector('#organization-request').hidden = Boolean(pendingRequest);
  document.querySelector('#request-actions').hidden = !pendingRequest;
  if (pendingRequest) {
    document.querySelector('#revise-name').value = pendingRequest.request_payload.name;
    document.querySelector('#revise-kind').value = pendingRequest.request_payload.organization_kind;
  }
  return account;
}
bindForm('#revise-request', async data => { await reviseRequest(pendingRequest, field(data, 'name'), field(data, 'kind')); await refresh(); message('Корекцията е запазена. Заявката остава за преглед.'); });
bindForm('#withdraw-request', async (data, form) => { await closeRequest(pendingRequest, 'revoked', field(data, 'note')); form.reset(); await refresh(); message('Заявката е оттеглена.'); });
bindForm('#profile', async data => { await updateProfile(field(data, 'name')); await refresh(); message('Името е запазено.'); });
bindForm('#organization-request', async data => {
  const account = await loadAccount();
  if (!account) throw new Error('Session required');
  await requestOrganization(account.profile.id, field(data, 'name'), field(data, 'kind'));
  await refresh(); message('Заявката очаква проверка. Тя не предоставя права.');
});
document.querySelector('#logout').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  try { await logout(); leaveSessionPresentation(); }
  catch(error) { message(authError(error), true); event.currentTarget.disabled = false; }
});
const callback = readAuthCallback(new URL(location.href));
const recoveryRequested = isRecoveryRequested();
try {
  // A new callback cannot borrow a prior recovery UI hint if its exchange fails.
  if (callback.present) clearRecoverySession();
  if (callback.hasError) history.replaceState(null, '', location.pathname);
  const recovery = !callback.hasError && await loadPasswordRecovery();
  if (recovery) {
    document.querySelector('#signed-out').hidden = true;
    document.querySelector('#signed-in').hidden = true;
    document.querySelector('#password-recovery').hidden = false;
    message(recoveryBg.ready);
  } else {
    const account = await refresh();
    const notice = callbackNotice(callback, Boolean(account?.user.email_confirmed_at));
    if (notice) message(recoveryRequested ? recoveryBg.invalid : callbackBg[notice], recoveryRequested || !account);
  }
} catch(error) {
  await showLoadFailure(error,callback.present ? recoveryRequested ? recoveryBg.invalid : callbackBg.session : authError(error));
} finally {
  // The SDK needs the PKCE code during initialization, then it must leave the address bar.
  if (callback.present) history.replaceState(null, '', location.pathname);
}
