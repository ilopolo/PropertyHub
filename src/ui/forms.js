import { authError } from '../i18n/auth-bg.js';

export function message(text, danger = false) {
  const node = document.querySelector('#message');
  node.textContent = text;
  node.className = `alert ${danger ? 'alert-danger' : 'alert-info'}`;
  node.hidden = !text;
}
export function bindForm(id, action) {
  document.querySelector(id)?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const buttons = [...form.querySelectorAll('button')];
    buttons.forEach(b => b.disabled = true);
    message('Изпълнява се…');
    try { await action(new FormData(form), form); }
    catch (error) { message(authError(error), true); }
    finally { buttons.forEach(b => b.disabled = false); }
  });
}
export function option(select, value, label) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  select.append(node);
}
