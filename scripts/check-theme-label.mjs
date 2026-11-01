import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const base='http://127.0.0.1:4173',out='.local/theme-label-qa';
const pages=['index.html','pages/dashboard.html','pages/buildings.html','pages/account.html','pages/admin.html','pages/login.html','pages/register.html','pages/platform-admin.html','pages/organization-admin.html'];
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],checks=[],images=[];
async function verify(page,theme){
 const action=theme==='dark'?'Светла тема':'Тъмна тема',button=page.locator('#theme-toggle');
 await page.waitForFunction(t=>document.documentElement.dataset.bsTheme===t,theme);
 assert.equal(await button.innerText(),'◐ '+action);assert.equal(await button.getAttribute('title'),action);assert.equal(await button.getAttribute('aria-label'),action);assert.equal(await button.getAttribute('aria-pressed'),String(theme==='dark'));
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');
 const box=await button.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=page.viewportSize().width+1,'Button clipped');
}
try{
 for(const width of [375,1440])for(const preferred of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height:1000},colorScheme:preferred}),page=await context.newPage();
  // No signed-in state, credentials, network recordings or backend calls.
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){errors.push('blocked external request');return route.abort();}return route.continue();});
  page.on('pageerror',()=>errors.push('pageerror'));page.on('console',m=>{if(m.type()==='error')errors.push('console.error');});page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status());});
  for(const path of pages){
   await page.goto(base+'/'+path);await verify(page,preferred);
   // Four clicks on every shared-shell page, checking both actions and persisted state.
   for(let i=0;i<4;i++){
    await page.locator('#theme-toggle').click();const theme=i%2===0?(preferred==='light'?'dark':'light'):preferred;
    await verify(page,theme);assert.equal(await page.evaluate(()=>localStorage.getItem('propertyhub.theme')),theme);
   }
   for(const theme of [preferred,preferred==='light'?'dark':'light']){
    if(await page.locator('html').getAttribute('data-bs-theme')!==theme)await page.locator('#theme-toggle').click();
    await page.reload();await verify(page,theme);
    // Actual shared navigation and browser history keep the same preference.
    const target=path==='index.html'?'pages/dashboard.html':'index.html';
    await page.locator(path==='index.html'?'#navigation a[href="/pages/dashboard.html"]':'#navigation a.navbar-brand').click();await page.waitForURL(base+'/'+target);await verify(page,theme);
    await page.goBack();await verify(page,theme);
    if(path==='index.html'&&preferred==='light'){
     const filename=`${out}/navigation-${width}-${theme}.png`;await page.locator('#navigation').screenshot({path:filename,animations:'disabled'});images.push(filename);
    }
   }
   if(await page.locator('html').getAttribute('data-bs-theme')!==preferred)await page.locator('#theme-toggle').click();
   checks.push({width,system:preferred,path,multipleToggles:4,reloadAndNavigation:['light','dark']});
  }
  await context.close();
 }
 // Invalid/missing preference still falls back to the system; blocked storage still toggles.
 for(const storage of ['invalid','blocked']){
  const context=await browser.newContext({colorScheme:'dark'}),page=await context.newPage();
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  await context.addInitScript(mode=>{if(mode==='blocked'){Storage.prototype.getItem=()=>{throw new DOMException('Unavailable','SecurityError');};Storage.prototype.setItem=()=>{throw new DOMException('Unavailable','SecurityError');};}else localStorage.setItem('propertyhub.theme','invalid');},storage);
  await page.goto(base+'/index.html');await verify(page,'dark');await page.locator('#theme-toggle').focus();await page.keyboard.press('Enter');await verify(page,'light');await context.close();
 }
 assert.deepEqual(errors,[]);await writeFile(out+'/report.json',JSON.stringify({status:'PASS;4 screenshots pending actual visual inspection',pages:pages.length,contexts:4,pageCases:checks.length,checks,images,errors,extra:['invalid preference fallback','blocked storage toggling','native keyboard activation'],hostedRequests:0},null,2));
 console.log(`PASS: ${checks.length} real Edge page/viewport/system cases, repeated toggle/reload/navigation,4 PNG pending visual inspection; no backend requests.`);
}catch(error){console.error('FAIL: '+error.message);await writeFile(out+'/failure.json',JSON.stringify({message:error.message,errors},null,2));process.exitCode=1;}
finally{await browser.close();}
