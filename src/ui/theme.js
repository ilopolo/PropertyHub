import { bg } from '../i18n/bg.js';

export function initializeTheme(button) {
  let saved;
  try { saved = localStorage.getItem('propertyhub.theme'); } catch { /* Storage can be disabled. */ }
  const preferred = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const apply = theme => {
    document.documentElement.dataset.bsTheme = theme;
    const action = theme === 'dark' ? bg.lightTheme : bg.theme;
    button.textContent = `◐ ${action}`;
    button.title = action;
    button.setAttribute('aria-label', action);
    button.setAttribute('aria-pressed', String(theme === 'dark'));
  };
  apply(['light', 'dark'].includes(saved) ? saved : preferred);
  button.addEventListener('click', () => {
    const next = document.documentElement.dataset.bsTheme === 'dark' ? 'light' : 'dark';
    apply(next);
    try { localStorage.setItem('propertyhub.theme', next); } catch { /* Theme still works in memory. */ }
  });
}
