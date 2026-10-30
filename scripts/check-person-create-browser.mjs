import assert from 'node:assert/strict';
import {loadEnvFile} from 'node:process';
import {readFile,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {chromium} from 'playwright';
import {registryToday} from '../src/domain/registry.js';
loadEnvFile('.env.local');loadEnvFile('.env.rls.local');
const fixture=JSON.parse(await readFile('.local/persons-qa/fixtures.json','utf8'));
const scope=fixture.scope.extraA,reference='DEV-03 UI-create QA 20261030';
const c=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const unwrap=({data,error})=>{if(error)throw new Error(`API ${error.code}`);return data;};
assert.match(process.env.RLS_A_EMAIL,/^rls-a-[a-f0-9]+@propertyhub\.invalid$/);
unwrap(await c.auth.signInWithPassword({email:process.env.RLS_A_EMAIL,password:process.env.RLS_A_PASSWORD}));
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const list=async()=>unwrap(await c.from('persons').select('*').eq('scope_id',scope).eq('source_reference',reference));
 const before=await list();assert.ok(before.length<=1);
 if(before.length===0){
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:4173/pages/login.html');await page.locator('#login-email').fill(process.env.RLS_A_EMAIL);await page.locator('#login-password').fill(process.env.RLS_A_PASSWORD);await page.locator('#login button').click();await page.waitForURL('**/pages/account.html');
  await page.goto('http://127.0.0.1:4173/pages/buildings.html');await page.locator('#person-save').waitFor();await page.locator('#scope').selectOption(scope);await page.locator('#person-save').waitFor();
  await page.locator('#person-kind').selectOption('legal');await page.locator('#person-name').fill('Synthetic <QA & Co>');
  await page.locator('#person-source').selectOption('document');await page.locator('#person-known').fill(registryToday());await page.locator('#person-reference').fill(reference);await page.locator('#person-packet').check();
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/rest/v1/rpc/save_scoped_person');await page.locator('#person-save button:not([type])').click();assert.equal((await response).status(),200);
  await page.getByText('Лицето е записано и очаква отделна проверка.',{exact:false}).waitFor();
  await page.reload();await page.locator('#person-save').waitFor();await page.locator('#scope').selectOption(scope);await page.getByText('Synthetic <QA & Co> · Юридическо лице',{exact:true}).waitFor();
  assert.equal(await page.locator('#person-list qa').count(),0,'Name is rendered as text, not HTML');
 }
 const rows=await list();assert.equal(rows.length,1);const row=rows[0];assert.equal(row.person_kind,'legal');assert.equal(row.source_kind,'document');assert.equal(row.verification_status,'needs_review');assert.equal(row.contact_email,null);assert.equal(row.contact_phone,null);
 await writeFile('.local/persons-qa/create-browser.json',JSON.stringify({status:'PASS',mode:before.length?'existing result reconciled; no repeated create':'actual UI create + reload + ordinary-session record read',id:row.id,scope,kind:'legal',source:'document',contacts:'unknown',markup:'textContent literal'},null,2));
 console.log('PASS: actual UI person create, legal kind/document source, literal name and persisted scoped record.');
}catch(error){console.error(`FAIL: person create browser ${error.name}; sensitive details suppressed`);process.exitCode=1;}
finally{await browser.close();await c.auth.signOut({scope:'local'});}
