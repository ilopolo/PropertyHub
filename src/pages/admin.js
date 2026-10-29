import './main.js';
import { loadAccount } from '../services/auth.js';
import { getClient, unwrap } from '../services/supabase.js';
import { activateOrganization, listRequests, createContext, assignStaff, revokeStaff } from '../services/access.js';
import { bindForm, message, option } from '../ui/forms.js';
import { authError } from '../i18n/auth-bg.js';

let account;
async function refresh() {
  account = await loadAccount();
  if (!account) { document.querySelector('#access-state').textContent = 'Влез с потвърден акаунт.'; return; }
  const now = Date.now();
  const roles = account.roles.filter(r => Date.parse(r.valid_from) <= now && (!r.valid_to || now < Date.parse(r.valid_to)));
  const platform = roles.some(r => r.role_code === 'platform_admin');
  const memberships = unwrap(await getClient().from('organization_memberships').select('id,organization_id,profile_id,status,valid_from,valid_to').eq('profile_id', account.profile.id));
  const orgIds = memberships.filter(m => m.status === 'active' && Date.parse(m.valid_from) <= now && (!m.valid_to || now < Date.parse(m.valid_to)) && roles.some(r => r.role_code === 'org_admin' && r.membership_id === m.id)).map(m => m.organization_id);
  const orgs = account.organizations.filter(o => o.status === 'active' && orgIds.includes(o.id));
  document.querySelector('#platform').hidden = !platform;
  document.querySelector('#org-admin').hidden = !orgs.length;
  document.querySelector('#access-state').textContent = platform || orgs.length ? 'Всяко действие проверява актуалните права на сървъра.' : 'Няма активно административно назначение за този акаунт.';
  const orgSelect = document.querySelector('#context-org'); orgSelect.replaceChildren();
  orgs.forEach(o => option(orgSelect, o.id, o.name));
  const scopes = document.querySelector('#staff-context'); scopes.replaceChildren();
  account.contexts.filter(c => c.can_manage_members).forEach(c => option(scopes, c.scope_id, `${c.organization_name} · ${c.scope_label}`));
  document.querySelector('#assign-staff button').disabled = !scopes.options.length;
  if (platform) {
    const list = document.querySelector('#pending-requests'); list.replaceChildren();
    const requests = (await listRequests()).filter(r => r.status === 'pending');
    if (!requests.length) list.textContent = 'Няма чакащи заявки.';
    for (const request of requests) {
      const card = document.createElement('div'); card.className = 'card card-body';
      const title = document.createElement('p'); title.textContent = request.request_payload.name;
      const requester = document.createElement('p'); requester.className = 'small text-break'; requester.textContent = `Профил на подателя: ${request.requester_profile_id} · Заявка: ${request.id}`;
      const button = document.createElement('button'); button.className = 'btn btn-success align-self-start'; button.textContent = 'Активирай проверената организация';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await activateOrganization(request.id); await refresh(); message('Организацията и първото org admin назначение са записани.'); }
        catch(error) { message(authError(error), true); button.disabled = false; }
      });
      card.append(title, requester, button); list.append(card);
    }
  }
}
bindForm('#create-context', async (data,form) => {
  const id = await createContext(String(data.get('org')),String(data.get('address')).trim(),String(data.get('label')).trim(),String(data.get('entrance')).trim());
  form.reset(); await refresh(); message(`Контекстът е записан: ${id}. За регистъра назначи отделно служебно право.`);
});
bindForm('#assign-staff', async data => {
  const scope = String(data.get('scope'));
  const context = account.contexts.find(c => c.scope_id === scope && c.can_manage_members);
  if (!context) throw new Error('Context unavailable');
  const id = await assignStaff(context.organization_id, String(data.get('auth')).trim(), scope, String(data.get('role')));
  await refresh(); message(`Назначението е записано. ID за отнемане: ${id}`);
});
bindForm('#revoke-staff', async data => { await revokeStaff(String(data.get('id')).trim()); await refresh(); message('Служебното назначение е прекратено.'); });
try { await refresh(); } catch(error) { message(authError(error),true); document.querySelector('#access-state').textContent = 'Достъпът не е зареден.'; }
