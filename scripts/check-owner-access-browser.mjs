import assert from 'node:assert/strict';
import {loadEnvFile} from 'node:process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
loadEnvFile('.env.rls.local');loadEnvFile('.env.password-policy.local');
const file='.local/owner-access-qa/state.json',state=JSON.parse(await readFile(file,'utf8')),base=process.env.CHECK_BASE_URL||'http://127.0.0.1:4173',readOnly=process.argv.includes('--read-only');
assert.ok(['http://127.0.0.1:4173','https://propertyhub-ilopolo.netlify.app'].includes(base));assert.ok(!base.startsWith('https:')||readOnly,'Live must be read-only');
const out='.local/owner-access-qa/'+(base.startsWith('https:')?'live':'browser');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],images=[];let phase='start';
const persist=()=>writeFile(file,JSON.stringify(state,null,2));
async function session(label){
 assert.match(label==='OWNER'?process.env.PASSWORD_QA_EMAIL:process.env['RLS_'+label+'_EMAIL'],/@propertyhub\.invalid$/,'Synthetic QA only');
 const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage();page.on('pageerror',()=>errors.push('pageerror'));page.on('console',m=>{if(m.type()==='error')errors.push('console.error');});page.on('response',r=>{if(r.status()>=400)errors.push('http'+r.status());});
 if(readOnly)await context.route('**/rest/v1/**',async route=>{const r=route.request();if(!['GET','HEAD','OPTIONS'].includes(r.method())&&!['ensure_profile','my_contexts','my_owned_units','read_ownership','read_occupancy','owner_access_records','organization_staff'].includes(new URL(r.url()).pathname.split('/').at(-1))){errors.push('blocked-write');await route.abort();return;}await route.continue();});
 await page.goto(base+'/pages/login.html');await page.locator('#login-email').fill(label==='OWNER'?process.env.PASSWORD_QA_EMAIL:process.env['RLS_'+label+'_EMAIL']);await page.locator('#login-password').fill(label==='OWNER'?process.env.PASSWORD_QA_PASSWORD:process.env['RLS_'+label+'_PASSWORD']);await page.locator('#login button').click();await page.waitForURL('**/pages/account.html');return {context,page};
}
async function verifier(page){await page.goto(base+'/pages/buildings.html');await page.locator('#scope:enabled').waitFor();if(await page.locator('#scope').inputValue()!==state.scope.A)await page.locator('#scope').selectOption(state.scope.A);await page.locator('#owner-verification[data-ready="true"]:visible').waitFor();}
async function ownerCount(page,count){await page.locator('#refresh-owned-units').click();await page.locator(`#owner-home[data-ready="true"][data-count="${count}"]`).waitFor();}
try{
 phase='synthetic login';const owner=await session('OWNER'),ver=await session('B'),admin=await session('A');await verifier(ver.page);
 phase='explicit verifier delegation UI';await admin.page.goto(base+'/pages/organization-admin.html');const card=admin.page.locator(`[data-staff-role="${state.verifierRole}"]`);await card.waitFor();
 if(!readOnly&&!state.browserDelegationDone){
  for(const enabled of [false,true]){
   const name=enabled?'Разреши проверка на собственически достъп':'Отнеми правото за проверка на собственически достъп';const button=card.getByRole('button',{name,exact:true});
   if(await button.count()){
    await card.locator('form input').fill('Synthetic browser explicit delegation');const response=admin.page.waitForResponse(r=>new URL(r.url()).pathname==='/rest/v1/rpc/set_owner_verifier');await button.click();assert.equal((await response).status(),204);await card.getByRole('button',{name:enabled?'Отнеми правото за проверка на собственически достъп':'Разреши проверка на собственически достъп',exact:true}).waitFor();
   }
  }state.browserDelegationDone=true;await persist();
 }
 await verifier(ver.page);
 phase='owner-link UI revoke and fresh confirmation';
 if(!readOnly&&!state.browserFlowDone){
  // Discovery on the actual UI prevents repeating a completed confirmation after interruption.
  const historyResponse=ver.page.waitForResponse(r=>new URL(r.url()).pathname==='/rest/v1/rpc/owner_access_records'&&r.status()===200);await ver.page.reload();const records=await (await historyResponse).json();await ver.page.locator('#owner-verification[data-ready="true"]:visible').waitFor();
  const completed=records.find(l=>l.evidence_reference==='Synthetic browser owner identity evidence'&&!l.revoked_at);
  if(!completed){
   const active=records.find(l=>l.person_id===state.person.id&&!l.revoked_at);
   if(active){
    const row=ver.page.locator(`[data-owner-link="${active.id}"]`);await row.locator('input[name=evidence]').fill('Synthetic browser revocation evidence');await row.locator('input[name=note]').fill('Synthetic browser revocation basis');const response=ver.page.waitForResponse(r=>new URL(r.url()).pathname==='/rest/v1/rpc/revoke_owner_link');await row.getByRole('button',{name:'Оттегли тази връзка',exact:true}).click();assert.equal((await response).status(),204);await row.getByRole('button').waitFor({state:'hidden'});
   }
   await ownerCount(owner.page,0);const screenshot=out+'/revoked-owner.png';await owner.page.locator('#owner-home').screenshot({path:screenshot});images.push({target:'same open owner session after revoke',screenshot});
   await ver.page.locator('#owner-target').fill(state.auth.OWNER);await ver.page.locator('#owner-person').selectOption(state.person.id);await ver.page.locator('#owner-evidence').fill('Synthetic browser owner identity evidence');await ver.page.locator('#owner-note').fill('Synthetic browser checked identity and ownership');
   state.browserConfirmationPlanned=true;await persist();const response=ver.page.waitForResponse(r=>new URL(r.url()).pathname==='/rest/v1/rpc/confirm_owner_link');await ver.page.locator('#confirm-owner-link button').click();const result=await response;assert.equal(result.status(),200);state.link=await result.json();await persist();
  }else{state.link=completed.id;await persist();}
  await ownerCount(owner.page,1);state.browserFlowDone=true;await persist();
 }
 for(const width of [375,1440])for(const theme of ['light','dark']){
  for(const [name,target,selector]of [['owner',owner,'#owner-home'],['verifier',ver,'#owner-verification'],['delegation',admin,`[data-staff-role="${state.verifierRole}"]`]]){
   phase=`${name} ${width}/${theme}`;await target.page.setViewportSize({width,height:1050});await target.page.evaluate(t=>localStorage.setItem('propertyhub.theme',t),theme);await target.page.reload();
   if(name==='verifier')await verifier(target.page);if(name==='owner')await ownerCount(target.page,1);await target.page.locator(selector).waitFor();
   assert.equal(await target.page.locator('html').getAttribute('data-bs-theme'),theme);assert.equal(await target.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(name==='owner'){assert.equal(await target.page.locator('#contexts li').count(),0);assert.equal(await target.page.locator('#owned-units li').count(),1);}
   const screenshot=`${out}/${name}-${width}-${theme}.png`;await target.page.locator(selector).screenshot({path:screenshot});images.push({name,width,theme,screenshot});
  }
 }
 phase='no inherited verifier UI';await admin.page.goto(base+'/pages/buildings.html');await admin.page.locator('#scope:enabled').waitFor();if(await admin.page.locator('#scope').inputValue()!==state.scope.A)await admin.page.locator('#scope').selectOption(state.scope.A);await admin.page.locator('#scope:enabled').waitFor();assert.equal(await admin.page.locator('#owner-verification').isVisible(),false);
 assert.deepEqual(errors,[]);await writeFile(out+'/report.json',JSON.stringify({status:'Automated PASS; visual review pending',mode:'Real local Edge, existing synthetic sessions; actual permission/link UI writes and same-session owner refresh',images,consolePageHttpErrors:errors},null,2));state.phase='browser-automated-pass-visual-pending';await persist();console.log('PASS: owner/verifier/delegation UI, actual records, same-session revocation; '+images.length+' screenshots need review.');
}catch(error){await writeFile(out+'/failure.json',JSON.stringify({status:'FAIL',phase,error:error.name,detail:phase==='no inherited verifier UI'?String(error.message).slice(0,800):'Details suppressed',errors},null,2));console.error('FAIL: owner browser '+phase+'; sensitive details suppressed');process.exitCode=1;}
finally{await browser.close();}
