// Actual Edge + Vite + supabase-js HTTP + disposable PostgreSQL; mocked Auth only.
// Local evidence, never hosted Auth/RLS acceptance. No env files/hosted requests.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createServer} from 'vite';
import {unitFileFixture} from './helpers/unit-file-fixture.mjs';
import {startUnitFileQaServer} from './helpers/unit-file-qa-server.mjs';
const out='.local/tickets-qa/browser';await mkdir(out,{recursive:true});
const f=await unitFileFixture(),password=randomUUID(),errors=[],images=[],checks=[];let api,vite,browser;
try{
 await f.as('orgA','select public.revoke_staff_role($1)',[f.docRole]);
 const grant=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['manage_tickets']) id",[f.org.A,f.auth.doc,f.scope.A])).rows[0].id;
 api=await startUnitFileQaServer(f,password);
 vite=await createServer({server:{host:'127.0.0.1',port:5173,strictPort:true},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('http://127.0.0.1:54331'),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('sb_publishable_local_qa_only')}});await vite.listen();
 browser=await chromium.launch({channel:'msedge',headless:true});
 async function open(label){
  const ctx=await browser.newContext({viewport:{width:1440,height:1100}}),page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await ctx.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  if(label){await page.goto('http://127.0.0.1:5173/pages/login.html');await page.locator('#login-email').fill(label.toLowerCase()+'@propertyhub.invalid');await page.locator('#login-password').fill(password);await page.locator('#login button').click();await page.waitForURL('**/pages/account.html');}
  await page.goto('http://127.0.0.1:5173/pages/tickets.html');if(label)await page.locator('#ticket-list[data-ready=true]').waitFor();else await page.getByText('Влез с потвърден акаунт за разрешените сигнали.').waitFor();return page;
 }
 const owner=await open('owner');assert.equal(await owner.locator('#ticket-unit option').count(),1);assert.equal(await owner.locator('input[type=file]').count(),0);
 await owner.locator('#ticket-title').fill('Synthetic: теч в общата тръба');await owner.locator('#ticket-description').fill('Синтетичен сигнал за локалния тест. Няма лични данни.');await owner.locator('#new-ticket button').click();await owner.locator('[data-ticket]').waitFor();
 const id=(await f.db.query('select id from public.work_items')).rows[0].id;
 assert.equal((await f.db.query('select reporter_profile_id from public.work_items')).rows[0].reporter_profile_id,f.profile.owner);
 assert.equal(await owner.locator('[data-ticket] form').count(),0);checks.push('owner create through real service/SDK/HTTP; correct persisted author/unit; no staff/file controls');
 const staff=await open('doc');await staff.locator('[data-ticket] form').waitFor();
 const org=await open('orgA');await org.goto('http://127.0.0.1:5173/pages/organization-admin.html');
 await org.locator('#staff-context option').first().waitFor({state:'attached'});await org.locator('#staff-context').selectOption(f.scope.A);await org.locator('#staff-auth').fill(f.auth.doc);await org.locator('#staff-role').selectOption('ticket_manager');await org.locator('#assign-staff button').click();await org.locator('#message').filter({hasText:'Назначението е записано.'}).waitFor();
 const actualGrant=(await f.db.query('select permissions from public.user_roles where id=$1',[grant])).rows[0];assert.deepEqual(actualGrant.permissions,['manage_tickets']);await org.context().close();checks.push('organization assignment UI/service maps ticket package to explicit manage_tickets only');
 for(const [page,label]of [[owner,'owner'],[staff,'staff']])for(const width of [375,1440])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:1100});await page.evaluate(t=>localStorage.setItem('propertyhub.theme',t),theme);await page.reload();await page.locator('#ticket-list[data-ready=true]').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.bsTheme),theme);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const file=`${out}/${label}-${width}-${theme}.png`;await page.screenshot({path:file,fullPage:true});images.push(file);
 }
 for(const [status,button]of [['accepted','Приет'],['in_progress','В работа'],['completed','Приключен'],['in_progress','Отвори повторно']]){
  await staff.locator('[data-ticket] textarea').fill('Синтетично основание / резултат');await staff.locator('[data-ticket] button').click();
  await staff.waitForFunction(({id,status})=>document.querySelector(`[data-ticket="${id}"] .fw-bold`)?.textContent===`Статус: ${status}`,{id,status:{accepted:'Приет',in_progress:'В работа',completed:'Приключен'}[status]});
 }
 const history=(await f.db.query('select * from public.work_item_events where item_id=$1',[id])).rows;assert.equal(history.length,5);
 await owner.reload();await owner.locator('#ticket-list[data-ready=true]').waitFor();assert.equal(await owner.locator('[data-ticket] li').count(),5);checks.push('staff four transitions through actual service; owner history/reload, database revisions/events verified');
 for(const label of [null,'B','orgA','platform','A','pending']){const page=await open(label);assert.equal(await page.locator('[data-ticket]').count(),0);assert.equal(await page.locator('#ticket-create').isVisible(),false);await page.context().close();}
 checks.push('anonymous/foreign scope/org admin/platform admin/registry-only/pending have no signal/control access');
 await f.as('orgA','select public.revoke_staff_role($1)',[grant]);await staff.getByRole('button',{name:'Обнови сигналите'}).click();await staff.getByText('Няма разрешени сигнали.').waitFor();
 await f.as('A','select public.revoke_owner_link($1,$2,$3,$4)',[f.scope.A,f.link,'Synthetic','Synthetic']);await owner.getByRole('button',{name:'Обнови сигналите'}).click();await owner.getByText('Няма разрешени сигнали.').waitFor();assert.equal(await owner.locator('#ticket-create').isVisible(),false);
 checks.push('same open local browser session loses list/actions after role/link revocation on refresh');
 await owner.getByRole('link',{name:'Табло',exact:true}).click();await owner.getByRole('link',{name:'Сигнали',exact:true}).first().click();await owner.locator('#ticket-list[data-ready=true]').waitFor();checks.push('real navigation back to signal screen');
 assert.deepEqual(errors,[]);assert.deepEqual(api.failures,[]);
 await writeFile(out+'/report.json',JSON.stringify({pass:true,hosted:false,checks,images,consoleErrors:errors,transportFailures:api.failures},null,2));console.log('PASS tickets actual local browser/API:',checks.length,'groups;',images.length,'screenshots (visual review still required)');
}finally{await browser?.close();await vite?.close();await api?.close();await f.db.close();}
