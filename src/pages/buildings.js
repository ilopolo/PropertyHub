import './main.js';
import { loadAccount } from '../services/auth.js';
import { listUnits, createUnit, verifyRegistryRecord } from '../services/registry.js';
import { listScopeSetups, completeScopeSetup } from '../services/access.js';
import { provenanceFields, readProvenance } from '../ui/provenance.js';
import { bindForm, message, option } from '../ui/forms.js';
import { authError } from '../i18n/auth-bg.js';
import { registryToday, calendarLabel } from '../domain/registry.js';
import { unitDetails } from '../ui/registry.js';

let account;
const scopeSelect = document.querySelector('#scope');
const asOf = document.querySelector('#registry-date');
asOf.value = registryToday();
let loadRevision = 0;
document.querySelector('#setup-provenance').innerHTML = provenanceFields('setup');
document.querySelector('#create-unit').lastElementChild.insertAdjacentHTML('beforebegin', provenanceFields('unit'));
async function showUnits() {
  const revision = ++loadRevision;
  const scope = scopeSelect.value;
  const date = asOf.value;
  const context = account.contexts.find(c => c.scope_id === scopeSelect.value);
  const canManage = context?.can_manage_registry && date === registryToday();
  document.querySelector('#unit-create').hidden = !canManage;
  const list = document.querySelector('#units'); list.textContent = 'Зареждане…';
  document.querySelector('#registry-count').textContent = '';
  let units;
  try { units = await listUnits(scope, date); }
  catch (error) {
    if (revision !== loadRevision) return;
    list.textContent = 'Прегледът не е зареден. Избери обхват и валидна дата и опитай отново.';
    throw error;
  }
  if (revision !== loadRevision) return;
  list.replaceChildren();
  document.querySelector('#registry-count').textContent = `${units.length} обекта с принадлежност към ${calendarLabel(date)}. Това не удостоверява пълнотата на регистъра.`;
  if (!units.length) list.textContent = 'Няма достъпни обекти с принадлежност за избраната дата.';
  const types = { apartment:'Апартамент',shop:'Магазин',office:'Офис',garage:'Гараж',other:'Обект' };
  for (const unit of units) {
    const li = document.createElement('li'); li.className = 'list-group-item text-break';
    const text = document.createElement('p');
    text.textContent = `${types[unit.unit_type]} ${unit.unit_number} · ${unit.floor ? `етаж ${unit.floor}` : 'етаж неизвестен'} · ${unit.area == null ? 'площ неизвестна' : `${unit.area} m²`} · ${unit.verification_status === 'verified' ? 'проверени въведени стойности' : 'нужен преглед'} · Известно от: ${unit.known_from || 'неустановена дата'} · ${unit.source_reference || 'неустановен източник'}`;
    li.dataset.unitId = unit.id;
    li.append(text, unitDetails(unit));
    if (canManage && unit.verification_status !== 'verified') {
      const form = document.createElement('form'); form.className = 'mb-3'; form.id = `verify-${unit.id}`;
      const label = document.createElement('label'); label.className = 'form-label'; label.htmlFor = `note-${unit.id}`; label.textContent = 'Основание за проверката на въведените стойности';
      const note = document.createElement('input'); note.id = label.htmlFor; note.name = 'note'; note.required = true; note.maxLength = 300; note.className = 'form-control mb-2';
      const button = document.createElement('button'); button.className = 'btn btn-outline-secondary'; button.textContent = 'Запиши отделната проверка';
      form.append(label, note, button); li.append(form);
    }
    list.append(li);
    if (li.querySelector('form')) bindForm(`#verify-${unit.id}`, async data => { await verifyRegistryRecord(context.scope_id, 'unit', unit.id, String(data.get('note')).trim()); await showUnits(); message('Проверката е записана. Липсващите стойности остават неизвестни; това не удостоверява финансова готовност.'); });
  }
}
scopeSelect.addEventListener('change', () => showUnits().catch(error => message(authError(error),true)));
bindForm('#registry-filter', async () => { await showUnits(); message('Прегледът към избраната дата е зареден.'); });
bindForm('#create-unit', async (data,form) => {
  await createUnit(scopeSelect.value,String(data.get('number')).trim(),String(data.get('type')),String(data.get('floor')).trim(),String(data.get('area')),readProvenance(data));
  form.reset(); await showUnits(); message('Обектът и принадлежността му към обхвата са записани.');
});
bindForm('#complete-setup', async (data, form) => {
  await completeScopeSetup(String(data.get('request')), String(data.get('address')).trim(), String(data.get('entrance')).trim(), readProvenance(data));
  form.reset(); await refresh(); message('Контекстът и отделното manager назначение са записани. Въведените данни очакват проверка.');
});
async function refresh() {
  scopeSelect.replaceChildren();
  document.querySelector('#units').replaceChildren();
  document.querySelector('#registry').hidden = true;
  document.querySelector('#setup-inbox').hidden = true;
  account = await loadAccount();
  if (account) {
    const setupSelect = document.querySelector('#setup-request'); setupSelect.replaceChildren();
    const setups = (await listScopeSetups()).filter(r => r.target_profile_id === account.profile.id && r.status === 'pending' && Date.parse(r.expires_at) > Date.now());
    setups.forEach(r => option(setupSelect, r.id, r.label));
    document.querySelector('#setup-inbox').hidden = !setups.length;
  }
  if (!account) document.querySelector('#registry-status').textContent = 'Влез с потвърден акаунт за достъп до регистъра.';
  else if (!account.contexts.length) document.querySelector('#registry-status').textContent = 'Няма разрешени обхвати. Нужно е проверено служебно назначение.';
  else {
    document.querySelector('#registry-status').textContent = 'Заредени са разрешените контексти. Данните се филтрират от сървъра.';
    account.contexts.forEach(c => option(scopeSelect,c.scope_id,`${c.organization_name} · ${c.scope_label}`));
    document.querySelector('#registry').hidden = false;
    await showUnits();
  }
}
try { await refresh(); } catch(error) { message(authError(error),true); document.querySelector('#registry-status').textContent = 'Регистърът не е зареден.'; }
