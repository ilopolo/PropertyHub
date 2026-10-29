import './main.js';
import { loadAccount } from '../services/auth.js';
import { listUnits, createUnit } from '../services/registry.js';
import { bindForm, message, option } from '../ui/forms.js';
import { authError } from '../i18n/auth-bg.js';

let account;
const scopeSelect = document.querySelector('#scope');
async function showUnits() {
  const context = account.contexts.find(c => c.scope_id === scopeSelect.value);
  document.querySelector('#unit-create').hidden = !context?.can_manage_registry;
  const list = document.querySelector('#units'); list.textContent = 'Зареждане…';
  const units = await listUnits(scopeSelect.value);
  list.replaceChildren();
  if (!units.length) list.textContent = 'Няма записани обекти или нямаш право за преглед.';
  const types = { apartment:'Апартамент',shop:'Магазин',office:'Офис',garage:'Гараж',other:'Обект' };
  for (const unit of units) {
    const li = document.createElement('li'); li.className = 'list-group-item text-break';
    li.textContent = `${types[unit.unit_type]} ${unit.unit_number} · ${unit.floor ? `етаж ${unit.floor}` : 'етаж неизвестен'} · ${unit.area == null ? 'площ неизвестна' : `${unit.area} m²`}`;
    list.append(li);
  }
}
scopeSelect.addEventListener('change', () => showUnits().catch(error => message(authError(error),true)));
bindForm('#create-unit', async (data,form) => {
  await createUnit(scopeSelect.value,String(data.get('number')).trim(),String(data.get('type')),String(data.get('floor')).trim(),String(data.get('area')));
  form.reset(); await showUnits(); message('Обектът и принадлежността му към обхвата са записани.');
});
try {
  account = await loadAccount();
  if (!account) document.querySelector('#registry-status').textContent = 'Влез с потвърден акаунт за достъп до регистъра.';
  else if (!account.contexts.length) document.querySelector('#registry-status').textContent = 'Няма разрешени обхвати. Нужно е проверено служебно назначение.';
  else {
    document.querySelector('#registry-status').textContent = 'Заредени са разрешените контексти. Данните се филтрират от сървъра.';
    account.contexts.forEach(c => option(scopeSelect,c.scope_id,`${c.organization_name} · ${c.scope_label}`));
    document.querySelector('#registry').hidden = false;
    await showUnits();
  }
} catch(error) { message(authError(error),true); document.querySelector('#registry-status').textContent = 'Регистърът не е зареден.'; }
