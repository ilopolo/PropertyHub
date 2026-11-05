import {setWorkspaceScope} from './workspace-context.js';
const el=(tag,text,cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
export function renderWorkspace({model:m,errors},context,menu,links,add,dashboard){
  context.replaceChildren();context.dataset.state=errors.length?'partial':!m.signedIn?'signed-out':m.contexts.length?'ready':'no-context';
  if(m.platform)add(menu,'pages/platform-admin.html','Управление на PropertyHub');
  if(m.organizations.length)add(menu,'pages/organization-admin.html','Екип и права');
  const actions=[];
  if(m.contexts.some(c=>c.registry))actions.push(['pages/buildings.html','Сгради и имоти']);
  if(m.contexts.some(c=>c.tickets))actions.push(['pages/tickets.html','Сигнали']);
  if(m.contexts.some(c=>c.finance))actions.push(['pages/finances.html','Финанси']);
  if(m.contexts.some(c=>c.expenses))actions.push(['pages/finances.html#expenses','Разходи']);
  if(m.contexts.some(c=>c.mode==='owner'))actions.push(['pages/account.html#owner-home','Моите имоти']);
  if(m.ownerFinance)actions.push(['pages/account.html#my-finances','Моите финанси']);
  for(const n of document.querySelectorAll('[data-workspace-registry]'))n.hidden=!m.contexts.some(c=>c.registry);
  actions.forEach(([p,t])=>add(links,p,t));
  if(!m.signedIn){context.append(el('span','Влез в акаунта си, за да видиш разрешените дейности. '));add(context,'pages/login.html','Вход');}
  else if(!m.contexts.length){context.append(el('span',errors.length?'Достъпът не е зареден изцяло. Това не означава липса на данни. ':m.ownerFinance?'Достъпна е твоята лична финансова история. Нямаш текущ оперативен контекст. ':m.platform?'Платформен достъп. За работа със сграда е нужно отделно служебно назначение. ':'Нямаш оперативен контекст. За работа със сграда е нужно служебно назначение или отделно проверен собствен достъп. '));add(context,'pages/account.html','Към акаунта и достъпа');}
  else{
    const label=el('label','Текущ контекст','form-label me-2'),select=el('select','','form-select workspace-select');select.id='workspace-scope';label.htmlFor=select.id;
    m.contexts.forEach(c=>{const o=el('option',[c.organization,c.label,c.mode==='owner'?'Моите имоти':'Служебен'].filter(Boolean).join(' · '));o.value=c.key;select.append(o);});
    const key='propertyhub.workspace.'+m.profileId;let saved;try{saved=sessionStorage.getItem(key);}catch{}
    if(m.contexts.some(c=>c.key===saved))select.value=saved;
    const fullLabel=el('p','','d-sm-none mt-2 mb-0');
    const remember=c=>{select.value=c.key;fullLabel.textContent=[c.organization,c.label,c.mode==='owner'?'Моите имоти':'Служебен'].filter(Boolean).join(' · ');try{sessionStorage.setItem(key,c.key);}catch{}};
    select.addEventListener('change',()=>{const c=m.contexts.find(c=>c.key===select.value);remember(c);setWorkspaceScope(c.id);});
    window.addEventListener('workspace-scope',e=>{const c=m.contexts.find(c=>c.id===e.detail&&c.mode===m.contexts.find(x=>x.key===select.value)?.mode)||m.contexts.find(c=>c.id===e.detail);if(c)remember(c);});
    context.append(label,select,fullLabel);remember(m.contexts.find(c=>c.key===select.value));setWorkspaceScope(m.contexts.find(c=>c.key===select.value).id);
  }
  if(errors.length)context.append(el('p','Част от услугите не отговориха. Обнови страницата, преди да продължиш.','text-warning mt-2 mb-0'));
  if(dashboard){dashboard.replaceChildren();dashboard.dataset.state=errors.length?'partial':'ready';dashboard.append(el('h2','Твоите дейности','h4'));if(!actions.length)dashboard.append(el('p',m.platform?'Отвори „Управление на PropertyHub“ от менюто „Акаунт“.':m.signedIn?'Все още няма разрешени оперативни дейности. Провери достъпа в акаунта си.':'Влез, за да заредиш разрешените дейности.'));actions.forEach(([p,t])=>add(dashboard,p,t));if(m.organizations.length)add(dashboard,'pages/organization-admin.html','Екип и права');}
}
