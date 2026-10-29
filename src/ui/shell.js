import { bg } from '../i18n/bg.js';
import { initializeTheme } from './theme.js';

export function initializeShell() {
  const base = import.meta.env.BASE_URL;
  const routes = [['index.html', bg.home], ['pages/dashboard.html', bg.dashboard], ['pages/buildings.html', bg.buildings]];
  const nav = document.querySelector('#navigation');
  nav.className = 'navbar border-bottom';
  nav.innerHTML = `<div class="container d-flex flex-wrap gap-3 py-2"><a class="navbar-brand fw-bold" href="${base}index.html">${bg.brand}</a><nav aria-label="Основна навигация" class="d-flex flex-wrap gap-2">${routes.map(([path, label]) => `<a class="nav-link px-2 py-2" href="${base}${path}" ${location.pathname === base + path || path === 'index.html' && location.pathname === base ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav><button type="button" id="theme-toggle" class="btn btn-outline-secondary ms-sm-auto" aria-pressed="false">◐ ${bg.theme}</button></div>`;
  initializeTheme(document.querySelector('#theme-toggle'));
}
