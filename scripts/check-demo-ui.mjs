import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createServer} from 'vite';
import {workspaceModel} from '../src/domain/workspace.js';
import {demoUiFixture,demoIds as d} from './helpers/demo-ui-fixture.mjs';

const out='.local/demo-ui-qa',images=[],errors=[],checks=[];
for(const role of ['platform','staff','cashier','owner','none']){
 const f=demoUiFixture(role),m=workspaceModel({profile:f.profile,roles:f.roles,contexts:f.contexts,organizations:f.organizations},{platform:role==='platform',adminOrganizations:[],memberships:f.members},{owned:f.owned,drafts:f.drafts,preview:f.preview,charges:f.charges,tickets:[]});
 assert.equal(m.platform,role==='platform');assert.equal(m.contexts.some(c=>c.registry),role==='staff');assert.equal(m.contexts.some(c=>c.finance),['staff','cashier'].includes(role));assert.equal(m.contexts.some(c=>c.mode==='owner'),role==='owner');
}
checks.push('five pure role models: no platform/admin operational inheritance');
let vite,browser;
try{
 await mkdir(out,{recursive:true});
 vite=await createServer({server:{host:'127.0.0.1',port:5175,strictPort:true},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('http://127.0.0.1:54332'),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('sb_publishable_local_ui_fixture_only')}});await vite.listen();
 browser=await chromium.launch({channel:'msedge',headless:true});
 async function open(role,width=1440,theme='light'){
  const f=demoUiFixture(role),context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();
  const exp=Math.floor(Date.now()/1000)+3600,token=[{alg:'HS256',typ:'JWT'},{sub:d.profile,role:'authenticated',exp},'local-ui-only'].map(x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url')).join('.');
  const user={id:d.profile,email:'synthetic-ui@propertyhub.invalid',email_confirmed_at:'2026-01-01T00:00:00Z',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{display_name:'Синтетичен преглед'}};
  await context.addInitScript(({token,user,exp,theme})=>{if(!localStorage.getItem('sb-127-auth-token'))localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:token,refresh_token:'local-fixture-only',token_type:'bearer',expires_at:exp,user}));if(!localStorage.getItem('propertyhub.theme'))localStorage.setItem('propertyhub.theme',theme);},{token,user,exp,theme});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!f.fail)errors.push(m.text());});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='127.0.0.1'){errors.push('External network attempt blocked');return route.abort();}
   if(url.port!=='54332')return route.continue();
   const reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)});
   if(route.request().method()==='OPTIONS')return reply({});
   if(url.pathname==='/auth/v1/user')return reply(user);
   if(url.pathname==='/auth/v1/logout')return reply({});
   if(url.pathname.startsWith('/rest/v1/rpc/')){
    const name=url.pathname.split('/').at(-1),payload=route.request().postDataJSON()||{};f.requests.push({name,payload});
    if(f.delay)await new Promise(resolve=>setTimeout(resolve,200));
    if(f.fail===name)return reply({code:'FIXTURE_TECHNICAL',message:'Synthetic unavailable service'},503);
    if(name==='ensure_profile')return reply(null);
    if(name==='my_contexts')return reply(f.revoked?[]:f.contexts);
    if(name==='my_owned_units')return reply(f.revoked?[]:f.owned);
    if(name==='ticket_feed')return reply([]);
    if(name==='unit_share_feed')return reply({units:[],bases:[],versions:[],reviews:[],can_manage:false});
    if(name==='financial_draft_feed')return reply(f.revoked?{...f.drafts,scopes:[]}:f.drafts);
    if(name==='financial_preview_feed')return reply(f.revoked?{...f.preview,scopes:[]}:f.preview);
    if(name==='charge_batch_feed')return reply(f.revoked?{...f.charges,scopes:[]}:f.charges);
    if(name==='save_financial_resolution'){f.drafts.resolutions.push({...payload.payload,id:d.rule,scope_id:payload.scope,revision:1,verification_status:'needs_review',evidence_gaps:['meeting'],evidence:null});return reply(d.rule);}
    if(name==='load_financial_preview_inputs')return reply({input_token:'synthetic-exact-revision',inputs:{collection_amount:'100.00',units:[{unit_id:d.unit}]}});
    if(name==='create_financial_preview'){
     f.preview.previews=[{id:d.rule,scope_id:payload.scope,reference_date:'2026-11-03',rule_id:d.rule,share_version_id:d.shares,input_token:'synthetic-exact-revision',recorded_at:'2026-11-03',note:'Synthetic saved UI preview',inputs:{collection_amount:'100.00',share_revision:1,share_review_id:d.shares,activation_snapshot:{basis:{reference:'Синтетичен протокол',meeting_date:'2026-11-03'}},share_snapshot:{common_parts_reference:'Общи части на демо сградата'},building_id:d.scope,units:[{unit_id:d.unit,unit_number:'1',percentage:'100',owners_context:[{label:'Демо собственик',fraction:'1'}]}]},result:{total_cents:'10000',rows:[{unit_id:d.unit,amount:'100.00',residual_cent:false,floor_cents:'10000',remainder_numerator:'0',remainder_denominator:'10000000000'}]}}];
     return reply(d.rule);
    }
    if(['list_unit_documents','owner_access_records'].includes(name))return reply([]);
    errors.push('Unexpected local RPC '+name);return reply({code:'UI_FIXTURE_MISSING'},400);
   }
   const table=url.pathname.split('/').at(-1),data={profiles:f.profile,user_roles:f.revoked?[]:f.roles,organizations:f.organizations,organization_memberships:f.members,access_requests:[],scope_setup_requests:[],units:[],unit_scope_periods:[],persons:[],management_units:[]}[table];
   if(f.fail===table)return reply({code:'FIXTURE_TECHNICAL'},503);
   if(data===undefined){errors.push('Unexpected local table '+table);return reply({code:'UI_FIXTURE_MISSING'},400);}return reply(data);
  });
  const go=async(path)=>{await page.goto('http://127.0.0.1:5175/'+path);await page.locator('#workspace-context:not([data-state=loading])').waitFor();};
  return {f,page,context,go};
 }
 for(const role of ['platform','staff','cashier','owner','none','org-admin']){
  const x=await open(role);const {page:p}=x;await x.go('pages/dashboard.html');
  await p.locator('.workspace-profile summary').click();
  assert.equal(await p.getByRole('link',{name:'Управление на PropertyHub',exact:true}).count(),role==='platform'?1:0);
  assert.equal(await p.locator('.workspace-profile').getByRole('link',{name:'Екип и права',exact:true}).count(),role==='org-admin'?1:0);
  assert(!x.f.requests.some(r=>r.name==='ensure_profile'),'shell/dashboard must not provision a profile');
  if(role==='platform'){
   await p.locator('.workspace-profile summary').focus();await p.keyboard.press('Enter');assert.equal(await p.locator('.workspace-profile').getAttribute('open'),null);await p.keyboard.press('Enter');assert.notEqual(await p.locator('.workspace-profile').getAttribute('open'),null);
   await x.go('pages/platform-admin.html');await p.locator('.workspace-profile summary').click();await p.getByRole('link',{name:'Табло — моите дейности',exact:true}).click();await p.waitForURL('**/pages/dashboard.html');await p.locator('#workspace-actions[data-state=ready]').waitFor();assert.equal(await p.locator('nav[aria-label="Основна навигация"]').getByRole('link',{name:'Табло',exact:true}).count(),1);
  }
  if(['platform','staff','cashier','owner'].includes(role)){await p.setViewportSize({width:role==='platform'?375:1440,height:1000});const path=`${out}/dashboard-${role}.png`;await p.screenshot({path,fullPage:true});images.push(path);await p.setViewportSize({width:1440,height:1000});}
  const nav=p.locator('nav[aria-label="Основна навигация"]');
  assert.equal(await nav.getByRole('link',{name:'Сгради и имоти',exact:true}).count(),role==='staff'?1:0);
  assert.equal(await nav.getByRole('link',{name:'Финанси',exact:true}).count(),['staff','cashier'].includes(role)?1:0);
  assert.equal(await nav.getByRole('link',{name:'Моите имоти',exact:true}).count(),role==='owner'?1:0);
  if(['staff','cashier'].includes(role)){
   await p.locator('#workspace-scope').selectOption('staff:'+d.other);await p.reload();await p.locator('#workspace-scope').waitFor();assert.equal(await p.locator('#workspace-scope').inputValue(),'staff:'+d.other);
   await p.locator('nav[aria-label="Основна навигация"]').getByRole('link',{name:'Финанси',exact:true}).click();await p.waitForURL('**/pages/finances.html');await p.locator('#workspace-context:not([data-state=loading])').waitFor();await p.locator('#finance-drafts[data-ready=true]').waitFor();assert.equal(await p.locator('#finance-scope').inputValue(),d.other);
   await p.locator('#workspace-scope').selectOption('staff:'+d.scope);assert.equal(await p.locator('#finance-scope').inputValue(),d.scope);assert.equal(await p.locator('[name=preview_scope]').inputValue(),d.scope);assert.equal(await p.locator('[name=charge_scope]').inputValue(),d.scope);
   assert(await p.locator('[data-finance-form=resolution]').count());
  }else{
   await x.go('pages/finances.html');await p.locator('#finance-drafts[data-ready=true]').waitFor();assert.equal(await p.locator('#finance-drafts').getAttribute('data-state'),'no-access');assert.equal(await p.locator('[data-finance-form]').count(),0);
  }
  if(role==='owner'){await x.go('pages/tickets.html');await p.locator('#ticket-list[data-ready=true]').waitFor();assert.equal(await p.locator('#ticket-create').isVisible(),true);assert.equal(await p.locator('#ticket-list').getAttribute('data-state'),'empty');x.f.fail='ticket_feed';await p.getByRole('button',{name:'Обнови сигналите'}).click();await p.locator('#ticket-list[data-state=error]').waitFor();assert((await p.locator('#ticket-list').textContent()).includes('техническа грешка'));x.f.fail=null;}
  if(role==='staff'){
   await x.go('pages/buildings.html');await p.getByText('Разрешен служебен контекст: Демо сграда — вход А',{exact:true}).waitFor();assert.equal(await p.locator('#unit-create').isVisible(),true);
   await p.locator('#workspace-scope').selectOption('staff:'+d.other);await p.getByText('Разрешен служебен контекст: Демо сграда — вход Б',{exact:true}).waitFor();
  }
  for(const width of [375,1440])for(const theme of ['light','dark']){
   if(!p.url().endsWith('pages/finances.html'))await x.go('pages/finances.html');await p.setViewportSize({width,height:1000});await p.evaluate(t=>localStorage.setItem('propertyhub.theme',t),theme);await p.reload();await p.locator('#finance-drafts[data-ready=true]').waitFor();assert.equal(await p.locator('html').getAttribute('data-bs-theme'),theme);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const toggle=p.locator('#theme-toggle');assert((await toggle.textContent()).includes(theme==='dark'?'Светла тема':'Тъмна тема'));await toggle.click();await toggle.click();
   if(['platform','staff','owner','cashier'].includes(role)&&width===(role==='staff'||role==='owner'?1440:375)&&theme===(role==='platform'||role==='owner'?'light':'dark')){const path=`${out}/${role}-${width}-${theme}.png`;await p.screenshot({path,fullPage:true});images.push(path);}
  }
  checks.push(role+': navigation, permitted/empty finance state, reload,375/1440light/dark,theme toggles,no overflow');
  await x.context.close();
 }
 const x=await open('staff'),p=x.page;await x.go('pages/finances.html');await p.locator('#finance-drafts[data-ready=true]').waitFor();
 const form=p.locator('[data-finance-form=resolution]');
 for(const[k,v]of Object.entries({title:'Синтетичен ремонт',reference:'Демо протокол',meeting_date:'2026-11-03',effective_from:'2026-11-03',source_reference:'Само локален UI fixture',known_from:'2026-11-03',note:'Локална проверка на съществуващото действие'}))await form.locator(`[name=${k}]`).fill(v);
 await form.getByRole('button',{name:'Запази чернова',exact:true}).click();await p.locator('[data-resolution]').waitFor();assert(x.f.requests.some(r=>r.name==='save_financial_resolution'&&r.payload.scope===d.scope));
 const preview=p.locator('[data-preview-form]');await preview.locator('[name=rule_id]').selectOption(d.rule);await preview.locator('[name=share_version_id]').selectOption(d.shares);await preview.getByRole('button',{name:'Провери точните входове'}).click();await preview.locator('.preview-input-status').filter({hasText:'100.00'}).waitFor();
 await preview.locator('[name=note]').fill('Synthetic UI action');await preview.getByRole('button',{name:'Фиксирай preview'}).click();await p.locator('[data-preview-unit]').waitFor();assert(x.f.requests.some(r=>r.name==='create_financial_preview'));assert((await p.locator('[data-preview-unit]').textContent()).includes('100.00 EUR'));
 assert(!await p.getByText('Няма начисления, плащания или движение на пари.',{exact:false}).count());
 assert(await p.evaluate(()=>{const r=document.querySelector('#finance-drafts'),form=r.querySelector('form'),help=[...r.children].find(n=>n.tagName==='DETAILS');return Boolean(form.compareDocumentPosition(help)&Node.DOCUMENT_POSITION_FOLLOWING);}));
 x.f.fail='financial_draft_feed';await p.getByRole('button',{name:'Обнови',exact:true}).click();await p.locator('#finance-drafts[data-state=error]').waitFor();assert((await p.locator('#finance-drafts').textContent()).includes('техническа грешка'));assert.equal(await p.locator('#financial-preview').getAttribute('data-state'),'ready');
 x.f.fail=null;x.f.revoked=true;await p.reload();await p.locator('#workspace-context[data-state=no-context]').waitFor();assert.equal(await p.locator('#workspace-scope').count(),0);await p.locator('#finance-drafts[data-state=no-access]').waitFor();
 checks.push('existing resolution save and preview RPC actions; actions before help; technical failure distinct from empty; revoked inputs discard remembered context');await x.context.close();
 const y=await open('none');y.f.delay=true;await y.page.goto('http://127.0.0.1:5175/pages/dashboard.html');assert.equal(await y.page.locator('#workspace-context').getAttribute('data-state'),'loading');await y.page.locator('#workspace-context[data-state=no-context]').waitFor();await y.context.close();
 const z=await open('platform');z.f.fail='profiles';await z.go('pages/dashboard.html');assert.equal(await z.page.locator('#workspace-context').getAttribute('data-state'),'error');assert.equal(await z.page.getByRole('link',{name:'Управление на PropertyHub',exact:true}).count(),0);await z.context.close();checks.push('org-admin team link without operational inheritance; keyboard menu; owner signal form; workspace loading and technical error');
 assert.deepEqual(errors,[]);
 await writeFile(out+'/report.json',JSON.stringify({pass:true,hosted:false,runtime:'Actual headless Edge/Vite with intercepted local synthetic SDK HTTP; external network blocked',checks,images,visualInspection:'pending actual review',cleanup:'browser/Vite closed in finally; no hosted resources'},null,2));console.log('PASS Demo/UI-1 domain and actual browser fixtures; screenshots require actual review.');
}finally{await browser?.close();await vite?.close();}
