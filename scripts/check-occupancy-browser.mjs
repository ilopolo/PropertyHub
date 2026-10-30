import assert from 'node:assert/strict';
import {loadEnvFile} from 'node:process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
loadEnvFile('.env.rls.local');
const fixture=JSON.parse(await readFile('.local/occupancy-qa/state.json','utf8'));
const base=process.env.CHECK_BASE_URL||'http://127.0.0.1:4173',readOnly=process.argv.includes('--read-only');
assert.ok(['http://127.0.0.1:4173','https://propertyhub-ilopolo.netlify.app'].includes(base));
assert.ok(readOnly||base.startsWith('http:')); // live verification never writes registry facts
const out=base.startsWith('https:')?'.local/occupancy-qa/live':'.local/occupancy-qa/browser';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});const results=[];let phase='start',activePage;
const mutationFile='.local/occupancy-qa/browser-mutations.json';let mutations={};try{mutations=JSON.parse(await readFile(mutationFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const source='DEV-03 browser occupancy source';
async function selectContext(page,label){
 await page.locator('#scope:enabled').waitFor();
 if(await page.locator('#registry-date').inputValue()!==fixture.dates.today){await page.locator('#registry-date').fill(fixture.dates.today);await page.locator('#registry-filter button').click();await page.locator('#scope:enabled').waitFor();}
 if(await page.locator('#scope').inputValue()!==fixture.scope[label]){await page.locator('#scope').selectOption(fixture.scope[label]);await page.locator('#scope:enabled').waitFor();}
 await page.locator('#occupancy-unit:enabled').waitFor();
 if(await page.locator('#occupancy-unit').inputValue()!==fixture.units[label])await page.locator('#occupancy-unit').selectOption(fixture.units[label]);
 await page.waitForFunction(({scope,unit})=>{const r=document.querySelector('#occupancy');return r.dataset.ready==='true'&&r.dataset.loadedScope===scope&&r.dataset.loadedUnit===unit&&r.dataset.loadedDate===document.querySelector('#registry-date').value&&!document.querySelector('#scope').disabled;},{scope:fixture.scope[label],unit:fixture.units[label]});
}
try{
 for(const label of ['A','B']){
  phase=`${label} login`;const context=await browser.newContext({viewport:{width:1440,height:1050}});const page=await context.newPage();activePage=page;const errors=[];let data;
  page.on('pageerror',()=>errors.push('pageerror'));page.on('console',m=>{if(m.type()==='error')errors.push('console.error');});
  page.on('response',async r=>{if(r.status()>=400)errors.push('http-error');if(new URL(r.url()).pathname==='/rest/v1/rpc/read_occupancy'&&r.status()===200)data=await r.json();});
  if(readOnly)await context.route('**/rest/v1/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;
   if(!['GET','HEAD','OPTIONS'].includes(request.method())&&!['/rest/v1/rpc/ensure_profile','/rest/v1/rpc/my_contexts','/rest/v1/rpc/read_ownership','/rest/v1/rpc/read_occupancy'].includes(path)){errors.push('blocked-write');await route.abort();return;}await route.continue();
  });
  else await context.route('**/rest/v1/rpc/apply_occupancy_changes',async route=>{
   // Save the exact synthetic request before sending it, for recovery after interruption.
   mutations[label]={...mutations[label],planned:route.request().postDataJSON()};await writeFile(mutationFile,JSON.stringify(mutations,null,2));await route.continue();
  });
  assert.match(process.env[`RLS_${label}_EMAIL`],/^rls-(a|b)-[a-f0-9]+@propertyhub\.invalid$/);
  await page.goto(base+'/pages/login.html');await page.locator('#login-email').fill(process.env[`RLS_${label}_EMAIL`]);await page.locator('#login-password').fill(process.env[`RLS_${label}_PASSWORD`]);await page.locator('#login button').click();await page.waitForURL('**/pages/account.html');
  await page.getByRole('link',{name:'Към регистъра',exact:true}).click();await selectContext(page,label);
  phase=`${label} atomic UI batch`;
  if(!readOnly){
   const completed=data.records.filter(r=>r.record_state==='current'&&r.source_reference===source);
   if(!completed.length){
    if(label==='B'){
     await page.locator('#occupancy-summary').getByText('Броят е неизвестен.',{exact:false}).waitFor();await page.setViewportSize({width:375,height:1050});
     const screenshot=out+'/unknown-before-zero.png';await page.locator('#occupancy').screenshot({path:screenshot});results.push({target:'unknown count before correction',screenshot});
    }
    const target=label==='A'?fixture.ids['final-people'][0]:fixture.ids['B-unknown'][0];
    await page.locator(`[data-occupancy-id="${target}"]`).getByRole('button',{name:'Коригирай',exact:true}).click();
    const draft=page.locator('#occupancy-drafts fieldset').first();
    if(label==='A')await draft.locator('[name="occupant_kind"]').selectOption('tenant_resident');
    else await draft.locator('[name="units"]').fill('0');
    await page.locator('#occupancy-source').selectOption('document');await page.locator('#occupancy-known').fill(fixture.dates.today);await page.locator('#occupancy-reference').fill(source);
    await page.locator('#occupancy-history-note').fill('Synthetic occupancy only known from supplied registry date; no acquisition assertion');await page.locator('#occupancy-reason').fill('Synthetic browser atomic correction / new period');await page.locator('#occupancy-packet').check();
    const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/rest/v1/rpc/apply_occupancy_changes');await page.locator('#occupancy-save > button:not([type])').click();const saved=await response;assert.equal(saved.status(),200);
    const ids=await saved.json();assert.equal(ids.length,1);mutations[label]={...mutations[label],resultIds:ids};await writeFile(mutationFile,JSON.stringify(mutations,null,2));
    await page.getByText('Всички промени са записани заедно.',{exact:false}).waitFor();
   }else{assert.equal(completed.length,1);mutations[label]={...mutations[label],resultIds:completed.map(r=>r.id),reconciled:true};await writeFile(mutationFile,JSON.stringify(mutations,null,2));}
   if(label==='B'&&!data.set_reviewed){
    await page.locator('#occupancy-summary').getByText('Декларирана нула',{exact:false}).waitFor();const screenshot=out+'/declared-zero-before-review.png';await page.locator('#occupancy').screenshot({path:screenshot});results.push({target:'declared zero before verification',screenshot});
   }
   {
    for(const target of mutations[label].resultIds){
     const row=page.locator(`[data-occupancy-id="${target}"]`);if(await row.getByRole('button',{name:'Провери реда',exact:true}).count()){
      await row.locator('form input').fill('Synthetic browser row evidence checked');const reviewed=page.waitForResponse(r=>new URL(r.url()).pathname==='/rest/v1/rpc/review_occupancy');await row.getByRole('button',{name:'Провери реда',exact:true}).click();assert.ok([200,204].includes((await reviewed).status()));await row.getByRole('button',{name:'Провери реда',exact:true}).waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#occupancy').dataset.ready==='true'&&!document.querySelector('#occupancy-body').hidden);
     }
    }
    if(await page.locator('#occupancy-set-review').isVisible()){
     await page.locator('#occupancy-set-note').fill('Synthetic complete coowner set reviewed in browser');const review=page.waitForResponse(r=>new URL(r.url()).pathname==='/rest/v1/rpc/review_occupancy');await page.locator('#occupancy-set-review button').click();assert.ok([200,204].includes((await review).status()));await page.locator('#occupancy-summary').getByText(label==='A'?'Декларираният набор за избраната дата е изрично проверен.':'Изрично потвърдена нула за избраната дата.',{exact:false}).waitFor();
    }
   }
  }
  for(const width of [375,1440])for(const theme of ['light','dark']){
   phase=`${label} ${width}/${theme}`;await page.setViewportSize({width,height:1050});await page.evaluate(t=>localStorage.setItem('propertyhub.theme',t),theme);await page.reload();
   await selectContext(page,label);
   await page.locator('#occupancy-summary').getByText(label==='A'?'Декларираният набор за избраната дата е изрично проверен.':'Изрично потвърдена нула за избраната дата.',{exact:false}).waitFor();
   assert.equal(data.count_value,label==='A'?'2.0000':'0.0000');assert.equal(data.set_reviewed,true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('html').getAttribute('data-bs-theme'),theme);
   const screenshot=`${out}/occupancy-${label}-${width}-${theme}.png`;await page.locator('#occupancy').screenshot({path:screenshot});results.push({label,width,theme,screenshot,status:'Automated PASS; visual pending'});
  }
  phase=`${label} history`;await page.locator('#occupancy details summary').click();assert.ok(await page.locator('#occupancy-history > li').count()>0);if(label==='A'){const screenshot=out+'/history-1440-dark.png';await page.locator('#occupancy-history > li').first().screenshot({path:screenshot});results.push({target:'original history record',screenshot});}
  assert.deepEqual(errors,[]);await context.close();
 }
 phase='pending UI';const context=await browser.newContext();const p=await context.newPage();await p.goto(base+'/pages/login.html');await p.locator('#login-email').fill(process.env.RLS_PENDING_EMAIL);await p.locator('#login-password').fill(process.env.RLS_PENDING_PASSWORD);await p.locator('#login button').click();await p.waitForURL('**/pages/account.html');await p.goto(base+'/pages/buildings.html');await p.getByText('Няма разрешени обхвати.',{exact:false}).waitFor();assert.equal(await p.locator('#occupancy').isVisible(),false);await context.close();
 await writeFile(out+'/report.json',JSON.stringify({status:'Automated PASS; visual pending',mode:readOnly?'read-only transport guarded':'actual A declared-status correction + B unknown-to-zero correction, row/set verification',results,pending:'No registry or occupancy UI'},null,2));console.log(`PASS: occupancy browser ${readOnly?'read-only':'actual batch/review'}/reload/themes/scopes/pending; ${results.length} images require review.`);
}catch(error){if(activePage&&phase.includes('atomic UI'))await activePage.locator('#occupancy').screenshot({path:out+'/failure-screen.png'}).catch(()=>{});await writeFile(out+'/failure.json',JSON.stringify({phase,name:error.name,status:'FAIL',detail:phase.includes('login')?'login detail suppressed':String(error.message).slice(0,1500)},null,2));console.error(`FAIL: occupancy browser at ${phase}; sensitive details suppressed`);process.exitCode=1;}
finally{await browser.close();}
