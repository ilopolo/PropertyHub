import './main.js';
import { loadAdministration } from '../services/administration.js';
import { requestScopeSetup, listScopeSetups, revokeScopeSetup, organizationStaff, assignStaff, revokeStaff } from '../services/access.js';
import { bindForm, message, option } from '../ui/forms.js';
import { dateTime } from '../ui/provenance.js';
import { authError } from '../i18n/auth-bg.js';

let account;
const organization = document.querySelector('#organization');
async function showOrganization() {
  const org = organization.value;
  const scopes = document.querySelector('#staff-context'); scopes.replaceChildren();
  account.contexts.filter(c => c.organization_id === org && c.can_manage_members).forEach(c => option(scopes, c.scope_id, c.scope_label));
  document.querySelector('#assign-staff button').disabled = !scopes.options.length;
  document.querySelector('#assign-staff button').dataset.unavailable = String(!scopes.options.length);
  const staff = document.querySelector('#staff'); staff.replaceChildren();
  const setups = document.querySelector('#setups'); setups.replaceChildren();
  const [roles, requests] = await Promise.all([organizationStaff(org), listScopeSetups()]);
  if (org !== organization.value) return;
  for (const role of roles) {
    const card = document.createElement('article'); card.className = 'card card-body text-break';
    const text = document.createElement('p');
    const active = Date.parse(role.valid_from) <= Date.now() && (!role.valid_to || Date.now() < Date.parse(role.valid_to));
    text.textContent = `${role.display_name} · ${role.role_code} · ${active ? 'текущ период' : 'извън текущ период'} · ${role.permissions.join(', ')} · Обхват: ${role.scope_id || 'организация'} · Назначение: ${role.role_id} · Профил: ${role.profile_id}`;
    card.append(text);
    if (active && ['manager', 'controller'].includes(role.role_code)) {
      const button = document.createElement('button'); button.className = 'btn btn-outline-danger align-self-start'; button.textContent = 'Отнеми това служебно назначение';
      button.addEventListener('click', async () => { button.disabled = true; try { await revokeStaff(role.role_id); await refresh(); message('Назначението е прекратено.'); } catch (e) { message(authError(e), true); button.disabled = false; } }); card.append(button);
    }
    staff.append(card);
  }
  for (const request of requests.filter(r => r.organization_id === org)) {
    const card = document.createElement('article'); card.className = 'card card-body text-break';
    const text = document.createElement('p'); text.textContent = `${request.label} · ${request.status === 'fulfilled' ? 'приета' : request.status === 'revoked' ? 'оттеглена' : Date.parse(request.expires_at) <= Date.now() ? 'изтекла' : 'чака приемане'} · Профил: ${request.target_profile_id} · Срок: ${dateTime(request.expires_at)} (Europe/Sofia)`; card.append(text);
    if (request.status === 'pending') {
      const button = document.createElement('button'); button.className = 'btn btn-outline-danger align-self-start'; button.textContent = 'Оттегли началното назначение';
      button.addEventListener('click', async () => { button.disabled = true; try { await revokeScopeSetup(request); await refresh(); message('Началното назначение е оттеглено.'); } catch (e) { message(authError(e), true); button.disabled = false; } }); card.append(button);
    }
    setups.append(card);
  }
  if (!setups.children.length) setups.textContent = 'Няма начални заявки.';
  if (!staff.children.length) staff.textContent = 'Няма назначения.';
}
async function refresh() {
  const selected = organization.value;
  account = await loadAdministration();
  organization.replaceChildren();
  const orgs = account?.adminOrganizations || [];
  document.querySelector('#org-admin').hidden = !orgs.length;
  document.querySelector('#access-state').textContent = orgs.length ? 'Всяко действие проверява актуалните организационни права на сървъра.' : 'Няма активно организационно администриране за този акаунт.';
  orgs.forEach(o => option(organization, o.id, o.name));
  if (orgs.some(o => o.id === selected)) organization.value = selected;
  if (orgs.length) await showOrganization();
}
bindForm('#scope-setup', async (data, form) => { await requestScopeSetup(organization.value, String(data.get('target')).trim(), String(data.get('label')).trim()); form.reset(); await refresh(); message('Началното назначение очаква приемане от точния получател.'); });
bindForm('#assign-staff', async (data, form) => { await assignStaff(organization.value, String(data.get('auth')).trim(), String(data.get('scope')), String(data.get('role'))); form.reset(); await refresh(); message('Назначението е записано.'); });
organization.addEventListener('change', () => showOrganization().catch(e => message(authError(e), true)));
try { await refresh(); } catch (error) { message(authError(error), true); }
