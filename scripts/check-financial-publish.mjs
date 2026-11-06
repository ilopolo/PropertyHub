import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {financialPublishFixture} from './helpers/financial-publish-fixture.mjs';
import {startUnitFileQaServer} from './helpers/unit-file-qa-server.mjs';
import {chargeClaim,chargePartyReview} from '../src/domain/financial-publish.js';
const out='.local/finance-publish-qa',checks=[];await mkdir(out,{recursive:true});
const from=Number(process.argv.find(a=>a.startsWith('--from='))?.split('=')[1]||1);
if(from>1){const prior=JSON.parse(await readFile(out+'/db-service.json','utf8'));checks.push(...prior.checks.filter(c=>Number(c.id.match(/T(\d+)/)[1])<from));}
const deny=(p,code='23514')=>assert.rejects(p,e=>e.code===code);
async function count(f){return(await f.db.query(`select (select count(*) from public.charges)::int charges,(select count(*) from public.obligation_parties)::int parties,(select count(*) from public.audit_events where action='publish_charge_batch')::int publications`)).rows[0];}
async function nextPreview(f){const x=(await f.as('A','select public.load_financial_preview_inputs($1,$2) x',[f.scope.A,f.selection])).rows[0].x;return(await f.as('A',"select public.create_financial_preview($1,$2,$3,$4,'Synthetic changed context, explicit new preview') id",[f.scope.A,f.selection,x.input_token,randomUUID()])).rows[0].id;}
async function ownership(f,changes){const ids=(await f.as('A',"select public.apply_ownership_changes($1,$2,$3,$4,'Synthetic explicit interval correction','document','Synthetic dated source','2026-10-01','Explicit local fixture coverage') ids",[f.scope.A,f.units[0],randomUUID(),JSON.stringify(changes)])).rows[0].ids;for(const id of ids)await f.as('A',"select public.review_ownership($1,$2,$3,$4,'Synthetic row review')",[f.scope.A,f.units[0],id,f.today]);await f.as('A',"select public.review_ownership($1,$2,null,'2026-11-02','Synthetic complete changed set')",[f.scope.A,f.units[0]]);return ids;}
const ownerId=async f=>(await f.db.query("select id from public.ownership_periods where scope_id=$1 and unit_id=$2 and record_state='current'",[f.scope.A,f.units[0]])).rows[0].id;
async function scenario(id,fn){if(Number(id.match(/T(\d+)/)[1])<from)return;const f=await financialPublishFixture();try{await fn(f);checks.push({id,local:'PASS'});await writeFile(out+'/db-service.json',JSON.stringify({pass:false,hosted:false,checks,inProgress:true},null,2));console.log('PASS',id);}finally{await f.db.close();}}
try{
 await scenario('PUBA-T01 valid whole batch / explicit personal review',async f=>{
  const x=await f.load();assert.deepEqual(x.inputs.gaps,[]);assert.equal(x.inputs.parties.length,4);assert.equal(x.inputs.interval_from,'2026-10-01');assert.equal(x.inputs.interval_to,'2026-11-04');
  assert.throws(()=>chargeClaim({...f.claim,amount:'1'}));assert.throws(()=>chargePartyReview([]));await deny(f.save(f.claim,null,null),'PT409');const id=await f.save();await deny(f.publish(id,1));await deny(f.save(f.claim,id,null),'PT409');await deny(f.review(id,null),'PT409');assert.equal((await count(f)).charges,0);
  const wrong=f.acks(x.inputs);wrong[0].person_id=f.person.B;await deny(f.as('doc',"select public.review_charge_batch($1,$2,1,$3,$4,'Synthetic forged party')",[f.scope.A,id,randomUUID(),wrong]));
  await f.review(id);await deny(f.publish(id,null),'PT409');await f.publish(id);assert.deepEqual(await count(f),{charges:4,parties:4,publications:1});
 });
 await scenario('PUBA-T02 one co-owned unit blocks every row',async f=>{
  const person=(await f.as('A',"select public.save_scoped_person($1,null,0,'physical','Synthetic co-owner',null,null,'active','document','Synthetic identity','2026-10-01') id",[f.scope.A])).rows[0].id;
  await f.as('A',"select public.verify_scoped_person($1,$2,1,'Synthetic identity checked')",[f.scope.A,person]);
  await ownership(f,[{target:await ownerId(f),person_id:f.person.A,fraction:'0.5',valid_from:'2026-10-01',valid_to:null},{person_id:person,fraction:'0.5',valid_from:'2026-10-01',valid_to:null}]);
  const p={...f.claim,preview_id:await nextPreview(f)},x=await f.load(p);assert(x.inputs.gaps.some(g=>g.startsWith('sole_owner_interval:')));const id=await f.save(p);await deny(f.review(id));assert.equal((await count(f)).charges,0);
 });
 await scenario('PUBA-T03 ownership change within M..T blocks whole batch',async f=>{
  await ownership(f,[{target:await ownerId(f),person_id:f.person.A,fraction:'1',valid_from:'2026-10-01',valid_to:'2026-10-02'},{person_id:f.person.A,fraction:'1',valid_from:'2026-10-02',valid_to:null}]);
  const p={...f.claim,preview_id:await nextPreview(f)};assert((await f.load(p)).inputs.gaps.length);const id=await f.save(p);await deny(f.review(id));assert.equal((await count(f)).charges,0);
 });
 await scenario('PUBA-T04 missing/outside/unreviewed L, stale and date rollover',async f=>{
  for(const liability_date of [null,'2026-09-30','2026-11-04']){const id=await f.save({...f.claim,liability_date});await deny(f.review(id));}
  for(const unit of f.units)await f.as('A',"select public.review_ownership($1,$2,null,'2026-11-04','Synthetic future preview context only')",[f.scope.A,unit]);
  const selection=f.selection;f.selection={...selection,reference_date:'2026-11-04'};const future=await f.save({...f.claim,preview_id:await nextPreview(f)});await deny(f.review(future));f.selection=selection;
  const id=await f.save({...f.claim,liability_date:'2026-10-01'});await f.review(id);await deny(f.publish(id,1),'PT409');
  await f.save(f.claim,id,2);await deny(f.publish(id,3));await f.review(id,3);
  // Test clock is replaced only inside disposable PGlite, never exposed to an API or hosted project.
  await f.db.exec("create or replace function private.charge_publication_day() returns date language sql volatile set search_path='' as $$select date '2026-11-04'$$");await deny(f.publish(id,4),'PT409');assert.equal((await count(f)).charges,0);
  await f.save(f.claim,id,4);await f.review(id,5);await f.publish(id,6);assert.equal((await count(f)).charges,4);
 });
 await scenario('PUBA-T05 future P does not assert future ownership',async f=>{
  await ownership(f,[{target:await ownerId(f),person_id:f.person.A,fraction:'1',valid_from:'2026-10-01',valid_to:'2026-11-04'}]);
  const p={...f.claim,liability_date:'2026-11-03',preview_id:await nextPreview(f)};const x=await f.load(p);assert.deepEqual(x.inputs.gaps,[]);assert.equal(x.inputs.due_date,'2026-11-15');assert.equal(x.inputs.parties.find(p=>p.unit_id===f.units[0]).valid_to,'2026-11-04');const id=await f.save(p);await f.review(id);await f.publish(id);
 });
 await scenario('PUBA-T06 explicit rights / foreign scope / same-session revoke / real HTTP409',async f=>{
  const id=await f.save();for(const who of ['A','B','owner','orgA','platform','anon'])await deny(f.review(id,1,who),'42501');for(const who of ['doc','owner','B','orgA','platform','anon'])await deny(f.save(f.claim,null,0,who),'42501');
  for(const who of ['orgA','platform','B'])assert.equal((await f.as(who,'select id from public.charge_batches')).rows.length,0);
  await deny(f.as('doc','update public.charge_batches set revision=99 where id=$1',[id]),'42501');await deny(f.as('A','insert into public.charges(scope_id) values($1)',[f.scope.A]),'42501');
  await deny(f.as('A','select public.load_charge_batch_inputs($1,$2)',[f.scope.B,f.claim]),'42501');
  let api,client;try{const pass=randomUUID();api=await startUnitFileQaServer(f,pass);client=createClient('http://127.0.0.1:54331','sb_publishable_local_qa_only',{auth:{persistSession:false,autoRefreshToken:false}});assert(!(await client.auth.signInWithPassword({email:'doc@propertyhub.invalid',password:pass})).error);globalThis.__publishClient=client;
   let source=(await readFile('src/services/financial-publish.js','utf8')).replace("import {getClient,unwrap} from './supabase.js';","const getClient=()=>globalThis.__publishClient;const unwrap=({data,error})=>{if(error)throw error;return data;};").replace("'../domain/financial-publish.js'",JSON.stringify(new URL('../src/domain/financial-publish.js',import.meta.url).href)).replace("'../domain/financial-preview.js'",JSON.stringify(new URL('../src/domain/financial-preview.js',import.meta.url).href));const service=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
   const x=await service.loadChargeBatchInputs(f.scope.A,f.claim);await service.reviewChargeBatch(f.scope.A,id,1,randomUUID(),f.acks(x.inputs),'Synthetic actual service review');
   let requests=0;const original=client.rest.fetch;client.rest.fetch=async(...a)=>{requests++;return original(...a);};const stale=await client.rpc('publish_charge_batch',{scope:f.scope.A,target:id,expected_revision:1,request_key:randomUUID(),note:'Synthetic stale request'}).retry(false);assert.equal(stale.status,409);assert.equal(requests,1);assert.equal((await count(f)).charges,0);
   const jwt=(await client.auth.getSession()).data.session.access_token;await f.as('orgA','select public.revoke_staff_role($1)',[f.publisherRole]);await deny(service.publishChargeBatch(f.scope.A,id,2,randomUUID(),'Synthetic revoked session'),'42501');assert.equal((await client.auth.getSession()).data.session.access_token,jwt);
   await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['publish_charges'])",[f.org.A,f.auth.doc,f.scope.A]);await service.publishChargeBatch(f.scope.A,id,2,randomUUID(),'Synthetic current permission after reload');assert.equal((await count(f)).charges,4);assert.deepEqual(api.failures.map(x=>x.code),['PT409','42501']);
  }finally{delete globalThis.__publishClient;if(client){await client.auth.signOut();client.auth.stopAutoRefresh();}await api?.close();}
 });
 await scenario('PUBA-T07 server input versions / forged amounts / changed source before publish',async f=>{
  for(const[k,v]of Object.entries({amount:'1',parties:[],snapshot:{},actor:f.profile.A,publication_day:'2026-10-02'}))await deny(f.load({...f.claim,[k]:v}));
  const id=await f.save();await f.review(id);await f.as('A',"select public.review_ownership($1,$2,null,'2026-11-02','Synthetic review input changed')",[f.scope.A,f.units[0]]);await deny(f.publish(id),'PT409');assert.equal((await count(f)).charges,0);
  const p={...f.claim,preview_id:await nextPreview(f)};await f.save(p,id,2);await f.review(id,3);await f.publish(id,4);
 });
 await scenario('PUBA-T08 same-key receipt and different-key business duplicate',async f=>{
  const a=await f.save(),b=await f.save();await f.review(a);await f.review(b);const key=randomUUID();assert.equal(await f.publish(a,2,key),a);assert.equal(await f.publish(a,2,key),a);await deny(f.as('doc',"select public.publish_charge_batch($1,$2,2,$3,'Synthetic changed payload same key')",[f.scope.A,a,key]),'PT409');await deny(f.publish(b),'PT409');await deny(f.publish(a,2,randomUUID()),'PT409');assert.deepEqual(await count(f),{charges:4,parties:4,publications:1});
  await f.as('orgA','select public.revoke_staff_role($1)',[f.publisherRole]);await deny(f.publish(a,2,key),'42501');
 });
 await scenario('PUBA-T09 local competing callers; hosted independent MVCC still required',async f=>{
  const a=await f.save(),b=await f.save();await f.review(a);await f.review(b);
  // PGlite operations are deliberately serialized. This proves final business invariant, not PostgreSQL MVCC.
  const results=await Promise.allSettled([f.publish(a),f.publish(b)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'PT409');assert.equal((await count(f)).charges,4);
 });
 await scenario('PUBA-T10 exact accepted R / immutable snapshot / correction history',async f=>{
  const id=await f.save();await f.review(id);await f.publish(id);const before=(await f.db.query('select * from public.charge_batches where id=$1',[id])).rows[0];const preview=(await f.db.query('select result from public.financial_previews where id=$1',[f.preview])).rows[0].result;
  const rows=(await f.db.query('select unit_id,amount::text,input_snapshot from public.charges where batch_id=$1 order by unit_id',[id])).rows;assert.deepEqual(rows.map(r=>[r.unit_id,r.amount,r.input_snapshot]),preview.rows.map(r=>[r.unit_id,r.amount,r]));assert.equal(rows.reduce((s,r)=>s+BigInt(r.amount.replace('.','')),0n),50000n);
  await deny(f.db.query("update public.charges set amount=1 where batch_id=$1",[id]),'42501');await deny(f.db.query('delete from public.charge_batches where id=$1',[id]),'42501');
  await deny(f.save({...f.claim,replaces_batch_id:id}),'42501');
  await f.as('orgA','select public.revoke_staff_role($1)',[f.preparerRole]);await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['read_registry','manage_registry','prepare_charges','correct_finance'])",[f.org.A,f.auth.A,f.scope.A]);
  const corrected=await f.save({...f.claim,replaces_batch_id:id,evidence_reference:'Synthetic corrected explicit evidence v2'});await f.review(corrected);await f.publish(corrected);assert.deepEqual((await f.db.query('select * from public.charge_batches where id=$1',[id])).rows[0],before);assert.equal((await f.db.query('select sum(amount)::text sum from public.charges')).rows[0].sum,'500.00');assert.equal((await f.db.query("select count(*)::int n from public.charge_batches where kind='reversal'")).rows[0].n,1);
  await f.db.exec('create table public.payments(id uuid)');const second=await f.save({...f.claim,replaces_batch_id:corrected});await f.review(second);await deny(f.publish(second));assert.equal((await f.db.query("select count(*)::int n from public.charge_batches where kind='reversal'")).rows[0].n,1);
 });
 await scenario('PUBA-T11 debtor not payer / read projection / no automatic personal access',async f=>{
  const id=await f.save();await f.review(id);await f.publish(id);const parties=(await f.db.query('select person_id,party_basis from public.obligation_parties')).rows;assert(parties.every(p=>p.person_id===f.person.A&&p.party_basis.payer_is_separate===true));
  assert.equal((await f.db.query("select count(*)::int n from information_schema.columns where table_schema='public' and table_name in('charges','obligation_parties','charge_batches') and column_name like '%payer%'")).rows[0].n,0);
  assert.equal((await f.as('owner','select public.charge_batch_feed() x')).rows[0].x.batches.length,1);assert.equal((await f.as('B','select public.charge_batch_feed() x')).rows[0].x.batches.length,0);await deny(f.as('anon','select public.charge_batch_feed()'),'42501');
  await f.as('orgA','select public.revoke_staff_role($1)',[f.readerRole]);assert.equal((await f.as('owner','select public.charge_batch_feed() x')).rows[0].x.batches.length,0); // Existing owner link alone is insufficient.
  assert.equal((await f.db.query("select has_function_privilege('authenticated','private.charge_publication_inputs(uuid,jsonb)','execute') allowed")).rows[0].allowed,false);
 });
 await writeFile(out+'/db-service.json',JSON.stringify({pass:true,hosted:false,runtime:'Disposable PGlite + real SDK/HTTP; simulated identities; serialized database, NOT PostgreSQL MVCC proof',checks,cleanup:'All disposable DBs and own HTTP/SDK sessions closed; no hosted operations',remaining:['Hosted all eleven cases, actual same-JWT revocation','Controlled independent PostgreSQL publish-vs-publish, input-edit/revoke and midnight interleavings; no partial/repeated rows']},null,2));
 console.log('PASS publish A: eleven local groups; hosted/MVCC NOT executed.');
}catch(e){await writeFile(out+'/failure.json',JSON.stringify({code:e.code,message:e.message,where:e.where,stack:e.code?undefined:e.stack,checks},null,2));console.error('Publish A failure:',e.code||'',e.message);process.exitCode=1;}
