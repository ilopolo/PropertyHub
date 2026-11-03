import { bg } from '../i18n/bg.js';
import { initializeTheme } from './theme.js';
import {loadWorkspace} from '../services/workspace.js';
import {renderWorkspace} from './workspace-shell.js';

export function initializeShell() {
  const base = import.meta.env.BASE_URL;
  const routes = [['index.html', bg.home], ['pages/dashboard.html', bg.dashboard]];
  const nav = document.querySelector('#navigation');
  nav.className = 'navbar border-bottom';
  nav.innerHTML = `<div class="container d-flex flex-wrap gap-3 py-2"><a class="navbar-brand fw-bold" href="${base}index.html">${bg.brand}</a><nav aria-label="Основна навигация" class="d-flex flex-wrap gap-2">${routes.map(([path, label]) => `<a class="nav-link px-2 py-2" href="${base}${path}" ${location.pathname === base + path || path === 'index.html' && location.pathname === base ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav><button type="button" id="theme-toggle" class="btn btn-outline-secondary ms-sm-auto" aria-pressed="false">◐ ${bg.theme}</button></div>`;
  initializeTheme(document.querySelector('#theme-toggle'));
  const links=nav.querySelector('nav'),wrap=nav.firstElementChild;
  const menu=document.createElement('details');menu.className='workspace-profile';
  const summary=document.createElement('summary');summary.textContent='Акаунт';summary.className='btn btn-outline-secondary';menu.append(summary);
  const add=(parent,path,label)=>{const a=document.createElement('a');a.href=base+path;a.textContent=label;a.className='nav-link px-2 py-2';if(location.pathname===base+path)a.setAttribute('aria-current','page');parent.append(a);};
  add(menu,'pages/account.html','Акаунт и достъп');wrap.insertBefore(menu,wrap.lastElementChild);
  add(menu,'pages/dashboard.html','Табло — моите дейности');
  const context=document.createElement('div');context.id='workspace-context';context.className='w-100 small';context.dataset.state='loading';context.setAttribute('role','status');context.textContent='Зареждане на достъпа…';wrap.append(context);
  const dashboard=document.querySelector('#workspace-actions');
  loadWorkspace().then(data=>renderWorkspace(data,context,menu,links,add,dashboard)).catch(()=>{
    context.dataset.state='error';context.textContent='Достъпът не може да се зареди. Обнови страницата или провери акаунта си.';
    if(dashboard){dashboard.dataset.state='error';dashboard.textContent='Дейностите не са заредени поради техническа грешка. Опитай отново.';}
  });
}
