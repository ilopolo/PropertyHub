import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
loadEnvFile('.env.rls.local');
const fixtures = JSON.parse(await readFile('.local/rls-fixtures.json','utf8'));
const base = 'http://127.0.0.1:4173';
const output = '.local/registry-snapshot-qa';
await mkdir(output,{recursive:true});
const browser = await chromium.launch({channel:'msedge',headless:true});
const results=[];
let phase='launch';
try {
  const context=await browser.newContext({viewport:{width:1440,height:1100}});
  const page=await context.newPage();
  const errors=[];
  const periods=[];
  page.on('pageerror',()=>errors.push('pageerror'));
  page.on('console',msg=>{if(msg.type()==='error')errors.push('console.error');});
  page.on('response',async response=>{
    if(response.status()>=400)errors.push('http-error');
    if(new URL(response.url()).pathname==='/rest/v1/unit_scope_periods'){
      const data=await response.json();if(Array.isArray(data))periods.push(...data);
    }
  });
  await page.goto(base+'/pages/login.html');
  assert.match(process.env.RLS_A_EMAIL,/^rls-a-[a-f0-9]+@propertyhub\.invalid$/);
  await page.locator('#login-email').fill(process.env.RLS_A_EMAIL);
  await page.locator('#login-password').fill(process.env.RLS_A_PASSWORD);
  await page.locator('#login button').click();
  await page.waitForURL('**/pages/account.html');
  await page.goto(base+'/pages/buildings.html');
  await page.locator('#registry:visible').waitFor();
  await page.locator('#scope').selectOption(fixtures.scope.A);
  await page.waitForFunction(()=>document.querySelector('#registry-count').textContent.includes('обекта'));
  const count=await page.locator('#units > li').count();assert.ok(count>0);
  const id=await page.locator('#units > li').first().getAttribute('data-unit-id');
  const period=periods.find(row=>row.unit_id===id);assert.ok(period);
  phase='before-start';
  await page.locator('#registry-date').fill('1900-01-01');
  await page.locator('#registry-filter button').click();
  await page.waitForFunction(()=>document.querySelector('#registry-count').textContent.startsWith('0 '));
  assert.equal(await page.locator('#units > li').count(),0);
  assert.equal(await page.locator('#unit-create').isVisible(),false);
  phase='inclusive-start';
  await page.locator('#registry-date').fill(period.valid_from);
  await page.locator('#registry-filter button').click();
  await page.waitForFunction(id=>!!document.querySelector(`[data-unit-id="${id}"]`),id);
  assert.ok(await page.locator(`[data-unit-id="${id}"]`).isVisible());
  phase='visual';
  for(const width of [375,1440])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:1100});
    if(await page.locator('html').getAttribute('data-bs-theme')!==theme)await page.locator('#theme-toggle').click();
    await page.reload();
    await page.locator('#registry:visible').waitFor();
    await page.locator('#scope').selectOption(fixtures.scope.A);
    await page.waitForFunction(()=>document.querySelector('#registry-count').textContent.includes('обекта'));
    await page.locator('#units details').first().locator('summary').click();
    const text=await page.locator('#units').textContent();
    assert.match(text,/не е дата на придобиване/);assert.match(text,/финансова готовност/);
    const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,missing:[...document.images].filter(i=>!i.complete||!i.naturalWidth).length}));
    assert.ok(geometry.scroll<=width+1);assert.equal(geometry.missing,0);
    const screenshot=`${output}/registry-${width}-${theme}.png`;
    await page.screenshot({path:screenshot,fullPage:true});
    results.push({width,theme,screenshot,geometry});
  }
  phase='foreign-scope';
  await page.locator('#scope').evaluate((select,id)=>select.add(new Option('Synthetic foreign scope',id)),fixtures.scope.B);
  await page.locator('#scope').selectOption(fixtures.scope.B);
  await page.waitForFunction(()=>document.querySelector('#registry-count').textContent.startsWith('0 '));
  assert.equal(await page.locator('#units > li').count(),0);
  assert.equal(await page.locator('#unit-create').isVisible(),false);
  assert.deepEqual(errors,[]);
  await context.close();
  await writeFile(output+'/report.json',JSON.stringify({status:'PASS; screenshots await visual review',checks:['actual period before start excluded','inclusive start included','foreign scope date-filter query returns no records','reload/themes/geometry'],results,dbWrites:false},null,2));
  console.log('PASS: targeted registry period/RLS read cases and 4 browser snapshots; visual review pending. No registry writes.');
}catch{await writeFile(output+'/report.json',JSON.stringify({status:'FAILED',phase,results},null,2));console.error('FAIL: registry snapshot '+phase+'; sensitive data suppressed');process.exitCode=1;}
finally{await browser.close();}
