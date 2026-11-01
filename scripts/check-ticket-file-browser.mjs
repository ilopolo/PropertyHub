// Actual browser/application/SDK/HTTP + PGlite; local Auth/S3 only, no hosted access.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createServer} from 'vite';
import {ticketFileFixture} from './helpers/ticket-file-fixture.mjs';
import {startUnitFileQaServer} from './helpers/unit-file-qa-server.mjs';
import {createDownloadHandler} from '../supabase/functions/download-ticket-file/handler.js';
const out='.local/ticket-attachment-qa/browser';await mkdir(out,{recursive:true});
const f=await ticketFileFixture(),password=randomUUID(),errors=[],images=[],checks=[];let api,vite,browser;
const pdf=Buffer.from('%PDF-1.7\nSynthetic ticket attachment\n%%EOF'),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6nWQAAAAASUVORK5CYII=','base64');
const hash=b=>createHash('sha256').update(b).digest('hex');
try{
 api=await startUnitFileQaServer(f,password,{bucket:'ticket-private-files',functionName:'download-ticket-file',authorizeRpc:'authorize_ticket_file_download',handlerFactory:createDownloadHandler,mimes:['application/pdf','image/png','image/jpeg']});
 vite=await createServer({server:{host:'127.0.0.1',port:5173,strictPort:true},define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('http://127.0.0.1:54331'),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('sb_publishable_local_qa_only')}});await vite.listen();
 browser=await chromium.launch({channel:'msedge',headless:true});
 async function open(label){
  const ctx=await browser.newContext({viewport:{width:1440,height:1100}}),page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await ctx.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  await page.goto('http://127.0.0.1:5173/pages/login.html');await page.locator('#login-email').fill(label.toLowerCase()+'@propertyhub.invalid');await page.locator('#login-password').fill(password);await page.locator('#login button').click();await page.waitForURL('**/pages/account.html');
  await page.goto('http://127.0.0.1:5173/pages/tickets.html');await page.locator('#ticket-list[data-ready=true]').waitFor();return page;
 }
 const panel=page=>page.locator(`[data-item="${f.ticket}"]`);
 const owner=await open('owner');assert.equal(await panel(owner).locator('input[type=file]').count(),1);
 await panel(owner).locator('input[type=file]').setInputFiles({name:'bad.png',mimeType:'image/png',buffer:pdf});await panel(owner).getByRole('button',{name:'Прикачи файл',exact:true}).click();await panel(owner).getByRole('status').filter({hasText:'Форматът на файла'}).waitFor();assert.equal((await f.db.query('select * from public.ticket_attachments')).rows.length,0);
 await panel(owner).locator('input[type=file]').setInputFiles({name:'синтетичен-сигнал.pdf',mimeType:'application/pdf',buffer:pdf});await panel(owner).getByRole('button',{name:'Прикачи файл',exact:true}).click();await panel(owner).getByText('Готов файл',{exact:true}).waitFor();assert.equal(await panel(owner).locator('input[type=file]').count(),0);
 const downloadPromise=owner.waitForEvent('download');await panel(owner).getByRole('button',{name:'Свали файла',exact:true}).click();const download=await downloadPromise;assert.equal(download.suggestedFilename(),'синтетичен-сигнал.pdf');const chunks=[];for await(const c of await download.createReadStream())chunks.push(c);assert.equal(hash(Buffer.concat(chunks)),hash(pdf));
 checks.push('real owner upload/pending verification/complete/download bytes; malformed image refuses before metadata');
 const staff=await open('doc');assert.equal(await panel(staff).getByRole('button',{name:'Свали файла',exact:true}).count(),1);assert.equal(await panel(staff).getByRole('button',{name:'Премахни файла',exact:true}).count(),1);
 for(const [page,label]of [[owner,'owner'],[staff,'staff']])for(const width of [375,1440])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:1100});await page.evaluate(t=>localStorage.setItem('propertyhub.theme',t),theme);await page.reload();await page.locator('#ticket-list[data-ready=true]').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.dataset.bsTheme),theme);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const contrast=await panel(page).locator('button').evaluateAll(buttons=>{
   const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number),lum=rgb=>rgb.map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[0.2126,0.7152,0.0722][i],0);
   return buttons.map(b=>{let p=b,bg;while(p){bg=getComputedStyle(p).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent')break;p=p.parentElement;}const a=lum(rgb(getComputedStyle(b).color)),c=lum(rgb(bg));return (Math.max(a,c)+0.05)/(Math.min(a,c)+0.05);});
  });assert(contrast.every(r=>r>=4.5),`attachment button normal text contrast ${label}/${width}/${theme}: ${contrast.map(r=>r.toFixed(2)).join(',')}`);
  const file=`${out}/${label}-${width}-${theme}.png`;await page.screenshot({path:file,fullPage:true});images.push(file);
 }
 checks.push('owner/staff 375/1440 light/dark actual load/reload; no horizontal overflow; eight screenshots for separate visual inspection');
 const coowner=await open('B');assert.equal(await coowner.locator(`[data-ticket="${f.ticket}"]`).count(),0);assert.equal(await coowner.locator('input[type=file]').count(),1);await coowner.context().close();
 const registry=await open('A');assert.equal(await registry.locator('input[type=file]').count(),0);await registry.context().close();checks.push('same-unit foreign reporter and registry-only controls denied');
 await panel(owner).getByLabel('Причина за премахване',{exact:true}).fill('Синтетична локална проверка');await panel(owner).getByRole('button',{name:'Премахни файла',exact:true}).click();await panel(owner).getByText('Премахнат файл — историята е запазена.').waitFor();await panel(owner).locator('input[type=file]').waitFor();assert.equal(api.objects.size,0);
 await staff.getByRole('button',{name:'Обнови сигналите',exact:true}).click();await panel(staff).locator('input[type=file]').waitFor();await panel(staff).locator('input[type=file]').setInputFiles({name:'служебно-приложение.png',mimeType:'image/png',buffer:png});await panel(staff).getByRole('button',{name:'Прикачи файл',exact:true}).click();await panel(staff).getByText('Готов файл',{exact:true}).waitFor();
 await owner.reload();await owner.locator('#ticket-list[data-ready=true]').waitFor();assert.equal(await panel(owner).getByRole('button',{name:'Премахни файла',exact:true}).count(),0);assert.equal(await panel(owner).getByRole('button',{name:'Свали файла',exact:true}).count(),1);
 checks.push('owner own-file remove; staff upload; reporter reads staff file but has no remove form');
 await f.as('orgA','select public.revoke_staff_role($1)',[f.ticketRole]);await staff.getByRole('button',{name:'Обнови сигналите',exact:true}).click();await staff.getByText('Няма разрешени сигнали.',{exact:true}).waitFor();assert.equal(await staff.locator('[data-attachment]').count(),0);
 await f.as('A','select public.revoke_owner_link($1,$2,$3,$4)',[f.scope.A,f.link,'Synthetic','Synthetic']);await owner.getByRole('button',{name:'Обнови сигналите',exact:true}).click();await owner.getByText('Няма разрешени сигнали.',{exact:true}).waitFor();assert.equal(await owner.locator('[data-attachment]').count(),0);
 await owner.getByRole('link',{name:'Табло',exact:true}).click();await owner.getByRole('link',{name:'Сигнали',exact:true}).first().click();await owner.locator('#ticket-list[data-ready=true]').waitFor();checks.push('same open local sessions lose file actions after revoke+refresh; real navigation back');
 // Restore only disposable local staff grant, cleanup only this test's file.
 f.ticketRole=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['manage_tickets']) id",[f.org.A,f.auth.doc,f.scope.A])).rows[0].id;
 await staff.reload();await staff.locator('#ticket-list[data-ready=true]').waitFor();const row=panel(staff).locator('[data-attachment]').filter({hasText:'служебно-приложение.png'});await row.getByLabel('Причина за премахване',{exact:true}).fill('Синтетичен cleanup');await row.getByRole('button',{name:'Премахни файла',exact:true}).click();await row.getByText('Премахнат файл — историята е запазена.').waitFor();
 assert.equal(api.objects.size,0);const history=(await f.db.query('select * from public.ticket_attachments')).rows;assert.equal(history.length,2);assert(history.every(d=>d.status==='removed'&&d.bytes_deleted_at));assert.deepEqual(errors,[]);assert.deepEqual(api.failures,[]);
 await writeFile(out+'/report.json',JSON.stringify({pass:true,hosted:false,checks,images,consoleErrors:errors,transfers:api.transfers,cleanup:{objects:0,retainedHistories:2}},null,2));console.log('PASS ticket attachment real local browser:',checks.length,'groups;',images.length,'screenshots — visual inspection still required');
}finally{await browser?.close();await vite?.close();await api?.close();await f.db.close();}
