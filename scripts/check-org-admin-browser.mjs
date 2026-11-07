import assert from 'node:assert/strict';import{randomUUID,createHash}from'node:crypto';import{mkdir,writeFile,readFile}from'node:fs/promises';
import{chromium}from'playwright';import{createServer}from'vite';import config from'../vite.config.js';
import{orgAdminFixture,orgAdminMigration}from'./helpers/org-admin-fixture.mjs';import{startUnitFileQaServer}from'./helpers/unit-file-qa-server.mjs';
const out='.local/org-admin-lifecycle/browser',base='http://127.0.0.1:5215',checks=[],images=[],errors=[],password=randomUUID();let f,api,vite,browser;
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
try{
 await mkdir(out+'/empty-env',{recursive:true});f=await orgAdminFixture();api=await startUnitFileQaServer(f,password,{port:54395,origin:base});
 vite=await createServer({...config,configFile:false,envDir:out+'/empty-env',cacheDir:out+'/cache',server:{host:'127.0.0.1',port:5215,strictPort:true},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('http://127.0.0.1:54395'),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('sb_publishable_local_org_admin_only')}});await vite.listen();browser=await chromium.launch({channel:'msedge',headless:true});
 async function page(who){const p=await(await browser.newContext({viewport:{width:1440,height:1000}})).newPage();p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());if(who){await p.goto(base+'/pages/login.html');await p.locator('#login-email').fill(who.toLowerCase()+'@propertyhub.invalid');await p.locator('#login-password').fill(password);await p.locator('#login button').click();await p.waitForURL('**/pages/account.html');}await p.goto(base+'/pages/organization-admin.html');await p.locator('#access-state').filter({hasNotText:'Проверка на достъпа…'}).waitFor();return p;}
 async function ready(p){await p.locator('#org-admin-lifecycle[data-state=ready]').waitFor();}
 async function fill(p,operation,{role=null,member=null,reason='Synthetic browser authority review'}={}){await p.locator('#org-admin-operation').selectOption(operation);if(role)await p.locator('#org-admin-role').selectOption(role);if(member){await p.locator('#org-admin-member').selectOption(member);await p.locator('#org-admin-term').selectOption('permanent');}await p.locator('#org-admin-reason').fill(reason);await p.locator('#org-admin-confirm').check();}
 async function submit(p,status=200,navigates=false){const wait=p.waitForResponse(r=>r.url().endsWith('/rpc/org_admin_operation'));await p.locator('#org-admin-submit').click();const response=await wait;assert.equal(response.status(),status);const body=response.request().postDataJSON();let result;if(navigates){const rows=(await f.db.query('select result from private.org_admin_operations where request_key=$1',[body.request_key])).rows;assert.equal(rows.length,1);result=rows[0].result;}else result=await response.json();return{body,result};}
 let p,initialRole;
 await check('anonymous/platform/owner/staff do not inherit admin; other organization sees only its own directory',async()=>{
  for(const who of[null,'platform','owner','A']){const q=await page(who);assert(await q.locator('#org-admin').isHidden());}
  const q=await page('orgB');await ready(q);assert(!(await q.locator('#org-admin-lifecycle').innerText()).includes('Synthetic orgA'));assert.equal(await q.locator('#organization option').count(),1);
  p=await page('orgA');await ready(p);initialRole=await f.adminRole('orgA');
 });
 await check('real directory loading and safe technical error/retry are distinct from empty history',async()=>{
  let release,entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  await p.route('**/rpc/org_admin_directory',async r=>{entered();await gate;await r.continue();});
  await p.locator('#org-admin-refresh').click();await started;await p.locator('#org-admin-lifecycle[data-state=loading]').waitFor();release();await ready(p);await p.unroute('**/rpc/org_admin_directory');
  await p.route('**/rpc/org_admin_directory',r=>r.fulfill({status:503,json:{message:'synthetic internal path /private/do-not-display'}}));await p.locator('#org-admin-refresh').click();await p.locator('#org-admin-lifecycle[data-state=error]').waitFor();assert(!(await p.locator('#org-admin-lifecycle').textContent()).includes('/private/'));await p.unroute('**/rpc/org_admin_directory');await p.getByRole('button',{name:'Провери отново',exact:true}).click();await ready(p);assert(await p.getByText('Няма записани промени през този процес.',{exact:true}).count());
 });
 await check('last-admin refusal preserves form and explains atomic handover',async()=>{
  await fill(p,'grant',{member:await f.member('A')});await p.locator('#org-admin-term').selectOption('finite');await p.locator('#org-admin-ends').fill('not-a-time');await p.locator('#org-admin-submit').click();await p.locator('#org-admin-result').filter({hasText:'Посочи точен срок с часова зона'}).waitFor();assert.equal(await p.locator('#org-admin-ends').inputValue(),'not-a-time');assert.equal((await f.directory()).history.length,0);await p.locator('#org-admin-refresh').click();await ready(p);
  await fill(p,'end',{role:initialRole,reason:'Synthetic refused last admin'});await submit(p,409);await p.locator('#org-admin-result').filter({hasText:'запази действащ администратор'}).waitFor();assert.equal(await p.locator('#org-admin-reason').inputValue(),'Synthetic refused last admin');assert(await p.locator('#org-admin-submit').isEnabled());await p.locator('#org-admin-refresh').click();await ready(p);
 });
 let granted;
 await check('actual frontend/service grant and exact replay preserve one result/history',async()=>{
  await fill(p,'grant',{member:await f.member('A')});granted=await submit(p);await ready(p);assert(granted.result.new_role_id);assert(Number.isSafeInteger(granted.body.expected_revision));
  const b=granted.body;const repeated=await p.evaluate(async b=>(await import('/src/services/org-admin.js')).changeOrgAdmin({org:b.org,key:b.request_key,operation:b.operation,role:b.target_role_id,member:b.target_membership_id,revision:b.expected_revision,ends:b.ends_at,reason:b.reason}),b);assert.deepEqual(repeated,granted.result);assert.equal((await f.directory()).history.length,1);
 });
 await check('stale preview rejects rather than granting another role and keeps entered reason',async()=>{
  await fill(p,'grant',{member:await f.member('doc'),reason:'Synthetic stale intent'});
  await f.operation({key:randomUUID(),member:await f.member('doc'),revision:(await f.directory()).revision});await submit(p,409);await p.locator('#org-admin-result').filter({hasText:'Назначенията са променени'}).waitFor();assert.equal(await p.locator('#org-admin-reason').inputValue(),'Synthetic stale intent');assert.equal((await f.directory()).history.length,2);await p.locator('#org-admin-refresh').click();await ready(p);
 });
 await check('explicit end then self-handover navigates to current account without stale admin content; combined recipient retains staff mode',async()=>{
  await fill(p,'end',{role:granted.result.new_role_id});await submit(p);await ready(p);
  await fill(p,'handover',{role:initialRole,member:await f.member('A')});await submit(p,200,true);await p.waitForURL('**/pages/account.html');assert(await p.locator('#org-admin-change').count()===0);
  const q=await page('A');await ready(q);await q.goto(base+'/pages/dashboard.html');await q.locator('#workspace-context:not([data-state=loading])').waitFor();assert(await q.getByRole('link',{name:'Екип и права',exact:true}).count());assert(await q.getByRole('link',{name:'Сгради и имоти',exact:true}).count());await q.close();
 });
 await check('same unchanged local JWT loses authority; refresh clears protected directory then reload shows no context',async()=>{
  const q=await page('A');await ready(q);const token=await q.evaluate(()=>Object.values(localStorage).find(v=>{try{return JSON.parse(v)?.access_token;}catch{return false;}}));
  const role=await f.adminRole('A');await f.operation({who:'doc',key:randomUUID(),operation:'end',role,revision:(await f.directory('doc')).revision});await q.locator('#org-admin-refresh').click();await q.locator('#org-admin-lifecycle[data-state=no-access]').waitFor();assert.equal(await q.locator('#org-admin-grants').count(),0);
  assert.equal(await q.evaluate(()=>Object.values(localStorage).find(v=>{try{return JSON.parse(v)?.access_token;}catch{return false;}})),token);await q.reload();await q.getByText('Няма активно организационно администриране за този акаунт.',{exact:true}).waitFor();await q.close();
  await f.operation({who:'doc',key:randomUUID(),member:await f.member('orgA'),revision:(await f.directory('doc')).revision});
 });
 await check('mobile/desktop two themes, history/reload and keyboard focus remain readable',async()=>{
  await p.goto(base+'/pages/organization-admin.html');await ready(p);await p.locator('#org-admin-lifecycle details').evaluate(n=>n.open=true);await p.locator('#org-admin-operation').selectOption('grant');
  for(const width of[375,1440])for(const theme of['light','dark']){await p.setViewportSize({width,height:1000});if(await p.locator('html').getAttribute('data-bs-theme')!==theme)await p.locator('#theme-toggle').click();await p.locator('#org-admin-operation').focus();assert(await p.locator('#org-admin-operation').evaluate(n=>document.activeElement===n));await p.keyboard.press('Tab');assert(await p.evaluate(()=>document.activeElement.matches('#org-admin-member')));assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const path=`org-admin-${width}-${theme}.png`;await p.locator('#org-admin-lifecycle').screenshot({path:out+'/'+path});images.push(path);}
  await p.reload();await ready(p);assert((await p.locator('#org-admin-grants').innerText()).includes('приключило'));assert(!/PT409|current_write|\/private\//.test(await p.locator('#org-admin-lifecycle').innerText()));
 });
 assert.deepEqual(errors,[]);await writeFile(out+'/report.json',JSON.stringify({pass:true,at:new Date().toISOString(),migration:orgAdminMigration,hash:createHash('sha256').update((await readFile('supabase/migrations/'+orgAdminMigration,'utf8')).replaceAll('\r\n','\n')).digest('hex'),localOnly:true,hosted:false,mvcc:false,transport:'real local frontend/SDK/HTTP -> disposable PGlite RLS',checks,images,visualInspection:'pending',cleanup:'Own5215/54395/Edge/disposable database closed'},null,2));
}catch(e){await mkdir(out,{recursive:true});await writeFile(out+'/failure.json',JSON.stringify({code:e.code,message:e.message,checks,errors},null,2));console.error(e);process.exitCode=1;}finally{await browser?.close();await vite?.close();await api?.close();await f?.db.close();}
