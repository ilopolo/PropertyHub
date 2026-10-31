import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {createServer as viteServer} from 'vite';
import {unitFileFixture} from './helpers/unit-file-fixture.mjs';
import {startUnitFileQaServer} from './helpers/unit-file-qa-server.mjs';
const out='.local/unit-file-qa/browser';await mkdir(out,{recursive:true});
const f=await unitFileFixture(),qaPassword=randomUUID();let api,vite,browser,staffPage;const errors=[],images=[],checks=[];
const bytes=Buffer.from('%PDF-1.4\n% Synthetic PropertyHub unit document\n%%EOF\n'),hash=b=>createHash('sha256').update(b).digest('hex');
try{
 api=await startUnitFileQaServer(f,qaPassword);
 vite=await viteServer({plugins:[{name:'qa-error-capture',transform(code,id){if(id.replaceAll('\\','/').endsWith('/src/i18n/auth-bg.js'))return code.replace('export function authError(error) {','export function authError(error) { window.__qaLastError = {message:error.message,stack:error.stack};');}}],server:{host:'127.0.0.1',port:5173,strictPort:true},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('http://127.0.0.1:54331'),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('sb_publishable_local_qa_transport_only')}});await vite.listen();
 browser=await chromium.launch({channel:'msedge',headless:true});
 async function login(label){const context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true}),page=await context.newPage();page.on('pageerror',()=>errors.push('pageerror'));page.on('console',m=>{if(m.type()==='error')errors.push('console.error');});
  // Absolutely no hosted requests, including Auth; no local env credential files are read.
  await context.route('**/*',async route=>{const host=new URL(route.request().url()).hostname;if(!['127.0.0.1','localhost'].includes(host)){errors.push('blocked external request');return route.abort();}return route.continue();});
  await page.goto('http://127.0.0.1:5173/pages/login.html');await page.locator('#login-email').fill(label.toLowerCase()+'@propertyhub.invalid');await page.locator('#login-password').fill(qaPassword);await page.locator('#login button').click();await page.waitForURL('**/pages/account.html');return {context,page};
 }
 const staff=await login('doc'),owner=await login('owner'),org=await login('orgA');staffPage=staff.page;
 await staff.page.goto('http://127.0.0.1:5173/pages/buildings.html');await Promise.race([staff.page.locator(`[data-unit-files="${f.unit.A}"][data-ready="true"]`).waitFor(),staff.page.locator('#message.alert-danger').waitFor().then(()=>{throw Error('Staff screen refused: inspect local QA transport failure log');})]);
 let panel=staff.page.locator(`[data-unit-files="${f.unit.A}"]`);
 for(const width of [375,1440])for(const theme of ['light','dark']){
  await staff.page.bringToFront();await staff.page.setViewportSize({width,height:1100});await staff.page.evaluate(t=>localStorage.setItem('propertyhub.theme',t),theme);await staff.page.reload();await staff.page.waitForFunction(t=>document.documentElement.dataset.bsTheme===t,theme);await staff.page.locator(`[data-unit-files="${f.unit.A}"][data-ready="true"]`).waitFor();
  const filename=`${out}/upload-${width}-${theme}.png`;await panel.screenshot({path:filename,animations:'disabled'});images.push(filename);
 }
 // Declared file type/size rejected before pending metadata is created.
 for(const payload of [{name:'bad.html',mimeType:'text/html',buffer:Buffer.from('synthetic')},{name:'large.pdf',mimeType:'application/pdf',buffer:Buffer.alloc(5242881)}]){
  await panel.locator('input[type=file]').setInputFiles(payload);await panel.getByRole('button',{name:'Качи private файл'}).click();await staff.page.locator('#message.alert-danger').waitFor();assert.equal((await f.db.query('select * from public.documents')).rows.length,0);
 }
 checks.push('browser MIME/size refusal with no metadata write');
 async function upload(audience){await panel.locator('input[type=file]').setInputFiles({name:'synthetic-unit.pdf',mimeType:'application/pdf',buffer:bytes});await panel.locator('select').selectOption(audience);await panel.getByRole('button',{name:'Качи private файл'}).click();await panel.getByRole('button',{name:'Свали PDF'}).waitFor();}
 await upload('staff');await owner.page.reload();await owner.page.locator('#owner-home[data-ready="true"]').waitFor();assert.equal(await owner.page.getByRole('button',{name:'Свали PDF'}).count(),0);checks.push('default staff file hidden from actual owner UI');
 await panel.locator('input[name=note]').fill('Synthetic removal for explicit owner audience');await panel.getByRole('button',{name:'Премахни / отмени'}).click();await panel.getByRole('button',{name:'Качи private файл'}).waitFor();
 await upload('owners');await owner.page.reload();await owner.page.locator('#owner-home[data-ready="true"]').waitFor();
 const ownerPanel=owner.page.locator(`[data-unit-files="${f.unit.A}"]`);await ownerPanel.getByRole('button',{name:'Свали PDF'}).waitFor();assert.equal(await ownerPanel.locator('input[type=file]').count(),0);assert.equal(await ownerPanel.getByRole('button',{name:'Премахни / отмени'}).count(),0);
 const pending=owner.page.waitForEvent('download');await ownerPanel.getByRole('button',{name:'Свали PDF'}).click();const download=await pending;await download.saveAs(out+'/download.pdf');assert.equal(hash(await readFile(out+'/download.pdf')),hash(bytes));checks.push('actual HTTP uploaded/downloaded bytes and SHA256 match via SDK on local QA transport');
 await org.page.goto('http://127.0.0.1:5173/pages/organization-admin.html');assert.ok(await org.page.locator('#staff-role option[value=document_manager]').count());
 await org.page.locator('#staff-role').selectOption('document_manager');await org.page.locator('#staff-auth').fill(f.auth.pending);await org.page.locator('#assign-staff button').click();await org.page.locator('#message.alert-info').filter({hasText:'Назначението е записано.'}).waitFor();
 const assigned=(await f.db.query('select permissions from public.user_roles where profile_id=$1 and scope_id=$2',[f.profile.pending,f.scope.A])).rows[0];assert.deepEqual(assigned.permissions,['read_registry','manage_documents']);checks.push('explicit document-only manager package assigned through real browser form, no registry edit right');
 for(const width of [375,1440])for(const theme of ['light','dark']){
  for(const [label,page,selector]of [['staff',staff.page,`[data-unit-files="${f.unit.A}"]`],['owner',owner.page,'#owner-home'],['delegation',org.page,'#assign-staff']]){
   await page.bringToFront();await page.setViewportSize({width,height:1100});await page.evaluate(t=>localStorage.setItem('propertyhub.theme',t),theme);await page.reload();await page.waitForFunction(t=>document.documentElement.dataset.bsTheme===t,theme);await page.locator(selector).waitFor();if(label!=='delegation')await page.locator(`[data-unit-files="${f.unit.A}"][data-ready="true"]`).waitFor();else await page.locator('#staff-role').selectOption('document_manager');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');const filename=`${out}/${label}-${width}-${theme}.png`;await page.locator(selector).screenshot({path:filename});images.push(filename);
  }
 }
 checks.push('actual local Edge navigation/reload,375/1440,light/dark,staff owner delegation');
 await f.as('A',"select public.revoke_owner_link($1,$2,'Synthetic file test','Synthetic revoke')",[f.scope.A,f.link]);
 await owner.page.locator('#refresh-owned-units').click();await owner.page.locator('#owner-home[data-ready="true"][data-count="0"]').waitFor();assert.equal(await owner.page.getByRole('button',{name:'Свали PDF'}).count(),0);await owner.page.locator('#owner-home').screenshot({path:out+'/revoked-owner.png'});images.push(out+'/revoked-owner.png');checks.push('same open owner browser loses current unit/file after revocation');
 assert.deepEqual(errors,[]);assert.equal(api.transfers.uploads,2);assert.ok(api.transfers.downloads>=3);
 await writeFile(out+'/report.json',JSON.stringify({status:'PASS; screenshots pending actual visual inspection',checks,images,errors,transfers:api.transfers,hosted:false,transport:'Local Node HTTP + PGlite policy fixture; real Edge and SDK bytes, NOT Supabase Storage/Auth runtime'},null,2));console.log('PASS: '+checks.length+' local Edge groups, '+images.length+' PNG awaiting visual inspection; no hosted requests.');
}catch(error){console.error('FAIL: '+error.message);if(staffPage)await writeFile(out+'/failure-text.txt',await staffPage.locator('body').innerText());await writeFile(out+'/failure.json',JSON.stringify({message:error.message,errors,failures:api?.failures,uiError:staffPage?await staffPage.evaluate(()=>window.__qaLastError):null},null,2));process.exitCode=1;}
finally{if(browser)await browser.close();if(vite)await vite.close();if(api)await api.close();await f.db.close();}
