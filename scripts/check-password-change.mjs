import assert from 'node:assert/strict';
import {loadEnvFile} from 'node:process';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
loadEnvFile('.env.rls.local');
assert.match(process.env.RLS_PENDING_EMAIL,/^rls-pending-[a-f0-9]+@propertyhub\.invalid$/);
const out='.local/password-policy-qa/change';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});const results=[];
try{
 const context=await browser.newContext();const page=await context.newPage();const errors=[];
 page.on('pageerror',()=>errors.push('pageerror'));page.on('console',m=>{if(m.type()==='error')errors.push('console.error');});
 // Strong guarantee: no password update reaches hosted Auth; synthetic existing password stays unchanged.
 let user,updates=0;
 page.on('response',async r=>{if(new URL(r.url()).pathname==='/auth/v1/user'&&r.request().method()==='GET'&&r.status()===200)user=await r.json();});
 await page.route('**/auth/v1/user',async route=>{
  if(route.request().method()!=='PUT'){await route.continue();return;}
  assert.equal(route.request().postDataJSON().password,'abcdefg1');assert.ok(user);updates++;
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(user)});
 });
 await page.goto('http://127.0.0.1:4173/pages/login.html');await page.locator('#login-email').fill(process.env.RLS_PENDING_EMAIL);await page.locator('#login-password').fill(process.env.RLS_PENDING_PASSWORD);await page.locator('#login button').click();await page.waitForURL('**/pages/account.html');await page.locator('#signed-in:visible').waitFor();
 const details=page.locator('details').filter({has:page.locator('#password-change')});await details.locator('summary').click();
 for(const value of ['abcdef1','abcdefgh','abcdefg1']){
  await page.locator('#change-password').fill(value);await page.locator('#change-password-confirm').fill(value);await page.locator('#password-change button').click();
  if(value==='abcdefg1')await page.getByText('Новата парола е запазена.',{exact:false}).waitFor();
  assert.equal(updates,value==='abcdefg1'?1:0);
 }
 for(const width of [375,1440])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:1000});await page.evaluate(t=>localStorage.setItem('propertyhub.theme',t),theme);await page.reload();await page.locator('#signed-in:visible').waitFor();await details.locator('summary').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const screenshot=`${out}/change-${width}-${theme}.png`;await details.screenshot({path:screenshot});results.push({width,theme,screenshot});
 }
 assert.deepEqual(errors,[]);await context.close();
 await writeFile(`${out}/report.json`,JSON.stringify({status:'UI contract PASS; visual pending',results,hostedPasswordMutation:'NONE; all PUT intercepted',login:'actual existing pending unchanged credentials'},null,2));
 console.log('PASS: own-password change UI boundaries; all password updates intercepted; no existing password modified.');
}catch(error){console.error(`FAIL: password-change UI ${error.name}; sensitive details suppressed`);process.exitCode=1;}
finally{await browser.close();}
