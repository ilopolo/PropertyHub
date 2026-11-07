import {initializeTheme} from './theme.js';
import {loadWorkspace} from '../services/workspace.js';
import {getClient,onSessionIdentity,sessionRevision,sameSession} from '../services/supabase.js';
import {logout} from '../services/auth.js';
import {renderWorkspace} from './workspace-shell.js';
const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
let sessionRedirectScheduled=false;
let initialized=false;
export function leaveSessionPresentation(text){
 hideSessionPresentation(text);
 if(!sessionRedirectScheduled){sessionRedirectScheduled=true;setTimeout(()=>location.replace(import.meta.env.BASE_URL+'pages/account.html'),0);}
}
export function hideSessionPresentation(text='Сесията е приключила. Зарежда се страницата за вход…'){
 document.documentElement.dataset.sessionTransition='true';
 document.querySelectorAll('main input,main textarea').forEach(n=>n.value='');
 document.querySelectorAll('#account-name,#account-uuid,#owned-units,#my-financial-data,#contexts,#requests').forEach(n=>n.replaceChildren());
 document.querySelectorAll('main button').forEach(n=>n.disabled=true);
 document.querySelector('#workspace-context')?.replaceChildren();
 document.querySelectorAll('[data-workspace-link]').forEach(n=>n.remove());
 try{for(const key of Object.keys(sessionStorage))if(key.startsWith('propertyhub.workspace.'))sessionStorage.removeItem(key);}catch{}
 let notice=document.querySelector('#session-notice');if(!notice){notice=el('p','','container alert alert-info my-3');notice.id='session-notice';notice.setAttribute('role','status');document.querySelector('main')?.before(notice);}notice.textContent=text;
}
export function initializeShell(){
 const base=import.meta.env.BASE_URL,nav=document.querySelector('#navigation');if(!nav||initialized)return;initialized=true;nav.className='navbar border-bottom';
 nav.innerHTML=`<div class="container ph-header"><a class="navbar-brand ph-brand" href="${base}index.html" aria-label="PropertyHub — начало"><img class="brand-light" src="${base}branding/logo-light.svg" alt="" width="334" height="64"><img class="brand-dark" src="${base}branding/logo-dark.svg" alt="" width="334" height="64"></a><button type="button" id="theme-toggle" class="btn btn-outline-secondary ph-theme" aria-pressed="false"></button><nav aria-label="Основна навигация" class="ph-primary"><a class="nav-link" href="${base}index.html">Начало</a><a class="nav-link" href="${base}pages/dashboard.html">Табло</a><a class="nav-link" id="header-account" href="${base}pages/account.html" hidden>Акаунт</a><a class="nav-link" href="${base}pages/help.html">Помощ</a></nav><div class="ph-session"><a id="header-login" class="btn btn-outline-secondary" href="${base}pages/login.html">Вход</a><a id="header-register" class="btn btn-success" href="${base}pages/register.html">Регистрация</a><button id="header-logout" type="button" class="btn btn-outline-secondary" hidden>Изход</button></div></div>`;
 initializeTheme(document.querySelector('#theme-toggle'));
 for(const a of nav.querySelectorAll('a'))if(new URL(a.href).pathname===location.pathname||a.getAttribute('href')===base+'index.html'&&location.pathname===base)a.setAttribute('aria-current','page');
 const links=nav.querySelector('nav'),wrap=nav.firstElementChild,menu=el('details','','workspace-profile');menu.hidden=true;menu.append(el('summary','Профил','btn btn-outline-secondary'));wrap.append(menu);
 const add=(parent,path,label)=>{const a=el('a',label,'nav-link');a.href=base+path;a.dataset.workspaceLink='true';if(location.pathname===base+path)a.setAttribute('aria-current','page');parent.append(a);};
 add(menu,'pages/account.html','Акаунт и достъп');add(menu,'pages/dashboard.html','Табло — моите дейности');
 const context=el('div','Зареждане на достъпа…','ph-context small');context.id='workspace-context';context.dataset.state='loading';context.setAttribute('role','status');wrap.append(context);
 const dashboard=document.querySelector('#workspace-actions'),button=document.querySelector('#header-logout');
 const sessionNav=signed=>{document.querySelector('#header-account').hidden=!signed;button.hidden=!signed;menu.hidden=!signed;document.querySelector('#header-login').hidden=signed;document.querySelector('#header-register').hidden=signed;};
 try{onSessionIdentity(({userId,changed})=>{if(changed){leaveSessionPresentation(userId?'Сесията е сменена. Зареждат се текущите разрешени данни…':undefined);for(const n of [button,menu,document.querySelector('#header-account'),document.querySelector('#header-login'),document.querySelector('#header-register')])n.hidden=true;}else if(!sessionRedirectScheduled)sessionNav(Boolean(userId));});getClient();}catch{sessionNav(false);}
 button.addEventListener('click',async()=>{button.disabled=true;try{await logout();leaveSessionPresentation();}catch{button.disabled=false;context.textContent='Изходът не е потвърден. Опитай отново; сесията не е обявена за приключила.';context.dataset.state='error';}});
 const workspaceRevision=sessionRevision();
 loadWorkspace().then(data=>{if(sameSession(workspaceRevision)&&!document.documentElement.dataset.sessionTransition)renderWorkspace(data,context,menu,links,add,dashboard);}).catch(()=>{if(!sameSession(workspaceRevision)||document.documentElement.dataset.sessionTransition)return;context.dataset.state='error';context.textContent='Достъпът не може да се зареди. Обнови страницата или провери акаунта си.';if(dashboard){dashboard.dataset.state='error';dashboard.textContent='Дейностите не са заредени поради техническа грешка. Опитай отново.';}});
 const footer=el('footer','','ph-footer border-top'),inner=el('div','','container py-4');inner.append(el('p','© 2026 Ilian Toshkov. All rights reserved.','mb-1'),el('p','PropertyHub — Developed by Ilian Toshkov.','small mb-2'));const footnav=el('nav','','d-flex flex-wrap gap-3');footnav.setAttribute('aria-label','Помощ и информация');for(const[path,text]of [['pages/help.html','Помощ'],['pages/contact.html','Контакти'],['third-party-notices.txt','Third-party notices']]){const a=el('a',text);a.href=base+path;footnav.append(a);}inner.append(footnav);footer.append(inner);document.body.append(footer);
 window.addEventListener('pageshow',e=>{if(e.persisted){hideSessionPresentation('Проверява се текущата сесия…');location.reload();}});
}
