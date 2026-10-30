import assert from 'node:assert/strict';
import {loadEnvFile} from 'node:process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {registryToday} from '../src/domain/registry.js';
loadEnvFile('.env.rls.local');
const fixtures=JSON.parse(await readFile('.local/persons-qa/fixtures.json','utf8'));
const base=process.env.CHECK_BASE_URL||'http://127.0.0.1:4173';
assert.ok(['http://127.0.0.1:4173','https://propertyhub-ilopolo.netlify.app'].includes(base));
const readOnly=process.argv.includes('--read-only');
const output=base.startsWith('https:')?'.local/persons-qa/live':'.local/persons-qa/browser';await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});const results=[];
let phase='start';
try{
 const context=await browser.newContext({viewport:{width:1440,height:1050}});const page=await context.newPage();const errors=[];let personRows=[];
 if(readOnly) await context.route('**/rest/v1/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  // A fail-closed transport guard independently prevents all registry writes.
  // Only these existing read/provision-own-profile RPCs are used by page initialization.
  const allowedReadRPC=['/rest/v1/rpc/ensure_profile','/rest/v1/rpc/my_contexts','/rest/v1/rpc/read_ownership'];
  if(!['GET','HEAD','OPTIONS'].includes(request.method()) && !allowedReadRPC.includes(path)){
   errors.push('blocked-write-in-read-only');await route.abort();return;
  }
  await route.continue();
 });
 page.on('pageerror',()=>errors.push('pageerror'));page.on('console',m=>{if(m.type()==='error')errors.push('console.error');});
 page.on('response',async r=>{if(r.status()>=400)errors.push('http-error');if(new URL(r.url()).pathname==='/rest/v1/persons' && r.request().method()==='GET'){const rows=await r.json();if(Array.isArray(rows))personRows=rows;}});
 assert.match(process.env.RLS_A_EMAIL,/^rls-a-[a-f0-9]+@propertyhub\.invalid$/);
 await page.goto(base+'/pages/login.html');await page.locator('#login-email').fill(process.env.RLS_A_EMAIL);await page.locator('#login-password').fill(process.env.RLS_A_PASSWORD);await page.locator('#login button').click();await page.waitForURL('**/pages/account.html');
 await page.getByRole('link',{name:'Към регистъра',exact:true}).click();await page.locator('#person-save').waitFor();
 await page.locator('#scope').selectOption(fixtures.scope.A);await page.locator(`[data-person-id="${fixtures.persons.A[0]}"]`).waitFor();
 phase='full-record edit';
 if(!readOnly){
  const row=page.locator(`[data-person-id="${fixtures.persons.A[0]}"]`);
  const revision=personRows.find(p=>p.id===fixtures.persons.A[0]).revision;
  await row.getByRole('button',{name:'Редактирай целия запис'}).click();
  assert.equal(await page.locator('#person-reference').inputValue(),'','Fresh source must be explicit');
  await page.locator('#person-phone').fill('Synthetic phone QA');await page.locator('#person-known').fill(registryToday());
  await page.locator('#person-reference').fill('DEV-03 scoped-person QA 20261030');await page.locator('#person-packet').check();
  const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/rest/v1/rpc/save_scoped_person');
  await page.locator('#person-save button[type="submit"], #person-save button:not([type])').click();assert.equal((await saved).status(),200);
  await page.getByText('Лицето е записано и очаква отделна проверка.',{exact:false}).waitFor();
  await page.reload();await page.locator('#person-save').waitFor();await page.locator('#scope').selectOption(fixtures.scope.A);
  await row.getByText('Synthetic phone QA',{exact:false}).waitFor();
  const actual=personRows.find(p=>p.id===fixtures.persons.A[0]);assert.equal(actual.revision,revision+1);assert.equal(actual.verification_status,'needs_review');
  await row.locator('input[name="note"]').fill('Synthetic browser source reviewed');
  const reviewed=page.waitForResponse(r=>new URL(r.url()).pathname==='/rest/v1/rpc/verify_scoped_person');
  await row.getByRole('button',{name:'Запиши проверката'}).click();assert.ok([200,204].includes((await reviewed).status()));
  await page.getByText('Проверката е записана.',{exact:false}).waitFor();
 }
 for(const width of [375,1440])for(const theme of ['light','dark']){
  phase=`visual ${width}/${theme}`;
  await page.setViewportSize({width,height:1050});await page.evaluate(t=>localStorage.setItem('propertyhub.theme',t),theme);await page.reload();
  await page.locator('#person-save').waitFor();await page.locator('#scope').selectOption(fixtures.scope.A);await page.locator(`[data-person-id="${fixtures.persons.A[0]}"]`).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-bs-theme'),theme);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Horizontal overflow');
  assert.equal(await page.locator('#person-list > li').count(),2);
  const image=`${output}/persons-${width}-${theme}.png`;await page.locator('#persons').screenshot({path:image});results.push({width,theme,screenshot:image,role:'manager',status:'automated PASS; visual pending'});
 }
 phase='scope/date isolation';await page.locator('#scope').selectOption(fixtures.scope.extraA);await page.locator(`[data-person-id="${fixtures.persons.extraA[0]}"]`).waitFor();
 let extraCount=1;try{const created=JSON.parse(await readFile('.local/persons-qa/create-browser.json','utf8'));if(created.status==='PASS')extraCount++;}catch(error){if(error.code!=='ENOENT')throw error;}
 assert.equal(await page.locator('#person-list > li').count(),extraCount);
 await page.locator('#registry-date').fill('2000-01-01');await page.locator('#registry-filter button').click();await page.locator('#persons').waitFor({state:'hidden'});
 assert.deepEqual(errors,[]);await context.close();
 phase='pending denied UI';const pending=await browser.newContext();const p=await pending.newPage();
 await p.goto(base+'/pages/login.html');await p.locator('#login-email').fill(process.env.RLS_PENDING_EMAIL);await p.locator('#login-password').fill(process.env.RLS_PENDING_PASSWORD);await p.locator('#login button').click();await p.waitForURL('**/pages/account.html');await p.goto(base+'/pages/buildings.html');await p.getByText('Няма разрешени обхвати.',{exact:false}).waitFor();assert.equal(await p.locator('#persons').isVisible(),false);await pending.close();
 await writeFile(`${output}/report.json`,JSON.stringify({status:'Automated PASS; visual review pending',results,scopeAndPending:'PASS',mode:readOnly?'live/read-only':'local actual full-record edit + review + persisted reload'},null,2));
 console.log(`PASS: actual browser persons ${readOnly?'read-only':'edit/review'}/reload/scopes/pending, ${results.length} screenshots require visual review.`);
}catch(error){await writeFile(`${output}/failure.json`,JSON.stringify({phase,status:'FAIL',code:error.name},null,2));console.error(`FAIL: persons browser at ${phase}; sensitive details suppressed`);process.exitCode=1;}
finally{await browser.close();}
