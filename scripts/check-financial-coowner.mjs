import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {financialCoownerFixture} from './helpers/financial-coowner-fixture.mjs';
import {allocatePersonal} from '../src/domain/personal-allocation.js';
import {chargeClaim,chargePartyReview} from '../src/domain/financial-publish.js';
import {startUnitFileQaServer} from './helpers/unit-file-qa-server.mjs';
const out='.local/finance-coowner-qa',checks=[];await mkdir(out,{recursive:true});
const deny=(p,code='23514')=>assert.rejects(p,e=>e.code===code);
const scalar=async(f,sql,args=[])=>(await f.db.query(sql,args)).rows[0];
const counts=f=>scalar(f,"select (select count(*) from public.charges)::int charges,(select count(*) from public.obligation_parties)::int parties,(select count(*) from public.audit_events where action in('publish_charge_batch','correct_charge_batch'))::int publications");
async function scenario(id,run){const f=await financialCoownerFixture();try{await run(f);checks.push({id,pass:true});console.log('PASS',id);}finally{await f.db.close();}}
try{
 await scenario('B2-T01 SQL exact policy parity with existing B/1, edge cases, UUID ties and input order',async f=>{
  const ids=['aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000003'];
  for(const fractions of [['0.5','0.5'],['0.6','0.4'],['0.3333333333','0.3333333333','0.3333333334'],['0.0000000001','0.9999999999']])for(const amount of ['0','1','2','3','101','999999999999999999']){
   const rows=fractions.map((ownership_fraction,i)=>({person_id:ids[i],ownership_fraction}));
   const expected=allocatePersonal({unit_amount_cents:amount,regime:'ordinary_fractional',expected_person_ids:rows.map(p=>p.person_id),rows});
   for(const roster of [rows,[...rows].reverse()])assert.deepEqual((await scalar(f,'select private.allocate_personal_cents($1,$2) x',[amount,roster])).x,expected);
  }
  for(const [amount,rows] of [['-1',[{person_id:ids[0],ownership_fraction:'1'}]],['1',[]],['1',[{person_id:ids[0],ownership_fraction:'1/3'}]],['1',[{person_id:ids[0],ownership_fraction:'0.9999999999'}]],['1',[{person_id:ids[0],ownership_fraction:'0'}]],['1',[{person_id:ids[0],ownership_fraction:'0.5'},{person_id:ids[0],ownership_fraction:'0.5'}]]])await deny(f.db.query('select private.allocate_personal_cents($1,$2)',[amount,rows]));
  await deny(f.as('doc','select private.allocate_personal_cents($1,$2)',['1',[]]),'42501');
 });
 await scenario('B2-T02 server roster/review at L, whole batch, exact personal/unit/R and immutable snapshot',async f=>{
  const x=(await f.load()).inputs;assert.deepEqual(x.gaps,[]);assert.equal(x.parties.length,5);assert(x.parties.every(p=>p.ownership_review.as_of===f.claim.liability_date&&p.source_row.id===p.ownership_id));
  assert(x.parties.every(p=>!('contact_email' in p.person_source)&&!('contact_phone' in p.person_source)&&!('field_evidence' in p.person_source)));
  for(const row of (await scalar(f,'select result from public.financial_previews where id=$1',[f.preview])).result.rows){
   const parties=x.parties.filter(p=>p.unit_id===row.unit_id),oracle=allocatePersonal({unit_amount_cents:row.amount_cents,regime:'ordinary_fractional',expected_person_ids:parties.map(p=>p.person_id),rows:parties.map(p=>({person_id:p.person_id,ownership_fraction:p.fraction}))});
   assert.deepEqual(parties.map(p=>p.personal_allocation),oracle.rows);
  }
  const id=await f.save();await f.review(id);await f.publish(id);assert.deepEqual(await counts(f),{charges:4,parties:5,publications:1});
  const v2=(await f.as('doc','select public.charge_batch_feed_v2() x')).rows[0].x;
  assert.equal(v2.parties.length,5);assert(v2.charges.every(c=>typeof c.amount==='string'));assert(v2.parties.every(p=>typeof p.assessed_amount==='string'));
  const legacy=(await f.as('doc','select public.charge_batch_feed() x')).rows[0].x;assert.deepEqual([legacy.batches.length,legacy.charges.length,legacy.parties.length,legacy.history.length],[0,0,0,0]);
  await deny(f.as('A','select public.load_charge_batch_inputs($1,$2)',[f.scope.A,f.claim]));
  await deny(f.as('A',"select public.save_charge_batch($1,null,0,$2,$3,'Synthetic old client must not create B')",[f.scope.A,randomUUID(),f.claim]));
  await deny(f.as('doc',"select public.review_charge_batch($1,$2,3,$3,$4,'Synthetic old review path')",[f.scope.A,id,randomUUID(),f.acks(x)]));
  await deny(f.as('doc',"select public.publish_charge_batch($1,$2,3,$3,'Synthetic old publish path')",[f.scope.A,id,randomUUID()]));
  assert((await f.db.query('select c.id from public.charges c join public.obligation_parties p on p.charge_id=c.id group by c.id,c.amount having sum(p.assessed_amount)<>c.amount')).rows.length===0);
  assert.equal((await scalar(f,'select sum(amount)::text sum from public.charges')).sum,'500.00');
  const before=await scalar(f,'select * from public.charge_batches where id=$1',[id]);assert.equal(before.publication_model,'ordinary-coowner-v1');assert(before.publication_snapshot.inputs.parties.every(p=>p.personal_allocation_policy==='largest-remainder-person-id-v1'));
  await deny(f.db.query('update public.charge_batches set pool_amount=1 where id=$1',[id]),'42501');await deny(f.db.query('delete from public.obligation_parties'),'42501');
  assert.deepEqual(await scalar(f,'select * from public.charge_batches where id=$1',[id]),before);
  assert((await f.db.query('select party_basis from public.obligation_parties')).rows.every(p=>p.party_basis.payer_is_separate===true));
 });
 await scenario('B2-T03 explicit rights/RLS, foreign scope, direct writes and forged client identity/amount',async f=>{
  for(const who of ['B','orgA','platform','anon'])await deny(f.load(f.claim,who),'42501');
  // This disposable fixture's "owner" additionally has explicit read_rules; owner-link alone is not the read grant.
  assert.equal((await f.load(f.claim,'owner')).inputs.parties.length,5);
  await deny(f.as('A','select public.load_charge_batch_inputs_v2($1,$2)',[f.scope.B,f.claim]),'42501');
  const id=await f.save();for(const who of ['A','B','orgA','platform','owner','anon'])await deny(f.review(id,1,who),'42501');
  for(const who of ['A','doc'])await deny(f.as(who,'insert into public.obligation_parties(scope_id) values($1)',[f.scope.A]),'42501');
  await deny(f.as('doc','update public.charge_batches set review=$1 where id=$2',[{},id]),'42501');
  for(const[k,v]of Object.entries({amount:'1',parties:[],snapshot:{},debtor:f.person.B,publication_day:'2026-10-02'})){assert.throws(()=>chargeClaim({...f.claim,[k]:v}));await deny(f.load({...f.claim,[k]:v}));}
  const ack=f.acks((await f.load()).inputs);for(const replacement of [{...ack[0],person_id:f.person.B},{...ack[0],amount:'1'},{...ack[0],ownership_id:randomUUID()}])await deny(f.as('doc',"select public.review_charge_batch_v2($1,$2,1,$3,$4,'Synthetic forged personal review')",[f.scope.A,id,randomUUID(),[replacement,...ack.slice(1)]]));
  assert.throws(()=>chargePartyReview([{...ack[0],amount:'1'}]));assert.throws(()=>chargePartyReview([ack[0],ack[0]]));assert.equal(chargePartyReview(ack).length,5);
  for(const who of ['B','platform','orgA'])assert.equal((await f.as(who,'select * from public.charge_batches')).rows.length,0);
  assert.equal((await counts(f)).charges,0);
 });
 await scenario('B2-T04 incomplete/changed/duplicate ownership, exact L review and no partial publication',async f=>{
  const id=await f.save();await f.review(id);
  await f.as('A',"select public.review_ownership($1,$2,null,'2026-10-02','Synthetic changed exact L review')",[f.scope.A,f.units[0]]);await deny(f.publish(id),'PT409');assert.equal((await counts(f)).charges,0);
  // A gap introduced in one row cannot silently remove that object or normalize the others.
  await f.changeOwners([{target:f.ownerIds[1],person_id:f.coowner,fraction:'0.4',valid_from:'2026-10-01',valid_to:null}]);
  await deny(f.refreshPreview());
  // Restore exact total but split one person's interval: unchanged whole-period gate still blocks.
  const current=(await f.db.query("select id from public.ownership_periods where unit_id=$1 and person_id=$2 and record_state='current'",[f.units[0],f.coowner])).rows[0].id;
  await f.changeOwners([{target:current,person_id:f.coowner,fraction:'0.5',valid_from:'2026-10-01',valid_to:'2026-10-03'},{person_id:f.coowner,fraction:'0.5',valid_from:'2026-10-03',valid_to:null}]);await f.reviewSets();
  const claim={...f.claim,preview_id:await f.refreshPreview()};assert((await f.load(claim)).inputs.gaps.some(g=>g.startsWith('coowner_unchanged_complete_interval:')));const blocked=await f.save(claim);await deny(f.review(blocked));assert.equal((await counts(f)).charges,0);
 });
 await scenario('B2-T05 unsupported regime/representation/personal basis and complete unique acknowledgments',async f=>{
  const id=await f.save(),ack=f.acks((await f.load()).inputs);
  for(const patch of [{ownership_regime:'joint_marital'},{ownership_regime:'disputed'},{quota_representation:'rational_required'},{coowner_basis_kind:'automatic_from_owner'},{proportionality_reason:''}])await deny(f.as('doc',"select public.review_charge_batch_v2($1,$2,1,$3,$4,'Synthetic unsupported context')",[f.scope.A,id,randomUUID(),[{...ack[0],...patch},...ack.slice(1)]]));
  for(const rows of [ack.slice(1),[ack[0],ack[0],...ack.slice(2)]])await deny(f.as('doc',"select public.review_charge_batch_v2($1,$2,1,$3,$4,'Synthetic incomplete party set')",[f.scope.A,id,randomUUID(),rows]));
  await f.review(id);await f.publish(id);assert.equal((await counts(f)).parties,5);
 });
 await scenario('B2-T06 actual SDK/service B payload, stale HTTP409 one request and same-session permission denial',async f=>{
  const id=await f.save();let api,client;
  try{
   const pass=randomUUID();api=await startUnitFileQaServer(f,pass,{port:54337,origin:'http://127.0.0.1:5177'});client=createClient('http://127.0.0.1:54337','sb_publishable_local_qa_only',{auth:{persistSession:false,autoRefreshToken:false}});assert(!(await client.auth.signInWithPassword({email:'doc@propertyhub.invalid',password:pass})).error);globalThis.__coownerClient=client;
   const source=(await readFile('src/services/financial-publish.js','utf8')).replace("import {getClient,unwrap} from './supabase.js';","const getClient=()=>globalThis.__coownerClient;const unwrap=({data,error})=>{if(error)throw error;return data;};").replace("'../domain/financial-publish.js'",JSON.stringify(new URL('../src/domain/financial-publish.js',import.meta.url).href)).replace("'../domain/financial-preview.js'",JSON.stringify(new URL('../src/domain/financial-preview.js',import.meta.url).href));
   const service=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
   const x=await service.loadChargeBatchInputs(f.scope.A,f.claim);await service.reviewChargeBatch(f.scope.A,id,1,randomUUID(),f.acks(x.inputs),'Synthetic actual service proportional review');
   let requests=0;const original=client.rest.fetch;client.rest.fetch=async(...args)=>{requests++;return original(...args);};const stale=await client.rpc('publish_charge_batch_v2',{scope:f.scope.A,target:id,expected_revision:1,request_key:randomUUID(),note:'Synthetic stale B publish'}).retry(false);assert.equal(stale.status,409);assert.equal(requests,1);assert.deepEqual(await counts(f),{charges:0,parties:0,publications:0});
   const jwt=(await client.auth.getSession()).data.session.access_token;await f.as('orgA','select public.revoke_staff_role($1)',[f.publisherRole]);await deny(service.publishChargeBatch(f.scope.A,id,2,randomUUID(),'Synthetic revoked publish'),'42501');assert.equal((await client.auth.getSession()).data.session.access_token,jwt);
   assert.deepEqual(api.failures.map(e=>e.code),['PT409','42501']);
  }finally{delete globalThis.__coownerClient;if(client){await client.auth.signOut();client.auth.stopAutoRefresh();}await api?.close();}
 });
 await scenario('B2-T07 idempotency and business duplicate guards; serialized local callers are not MVCC',async f=>{
  const a=await f.save(),b=await f.save();await f.review(a);await f.review(b);const key=randomUUID();assert.equal(await f.publish(a,2,key),a);assert.equal(await f.publish(a,2,key),a);await deny(f.publish(a,2,randomUUID()),'PT409');await deny(f.publish(b),'PT409');assert.deepEqual(await counts(f),{charges:4,parties:5,publications:1});
 });
 await scenario('B2-T08 full unpaid N-party reversal/replacement, unchanged unit R, before/after history and A routing',async f=>{
  const original=await f.save();await f.review(original);await f.publish(original);const before=await scalar(f,'select * from public.charge_batches where id=$1',[original]);
  await f.as('orgA','select public.revoke_staff_role($1)',[f.preparerRole]);await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['read_registry','manage_registry','prepare_charges','correct_finance'])",[f.org.A,f.auth.A,f.scope.A]);
  const withoutModel={...f.claim,replaces_batch_id:original};delete withoutModel.publication_model;await deny(f.save(withoutModel));
  // Correct a documented source fact through the existing append-only registry RPC, not a direct row rewrite.
  await f.changeOwners([{target:f.ownerIds[0],person_id:f.person.A,fraction:'0.6',valid_from:'2026-10-01',valid_to:null},{target:f.ownerIds[1],person_id:f.coowner,fraction:'0.4',valid_from:'2026-10-01',valid_to:null}]);await f.reviewSets();
  const nextPreview=await f.refreshPreview();
  const corrected=await f.save({...f.claim,preview_id:nextPreview,replaces_batch_id:original,evidence_reference:'Synthetic corrected personal evidence and exact source version; no unit recalculation'});await f.review(corrected);await f.publish(corrected);
  const reversal=await scalar(f,'select id,publication_model from public.charge_batches where reverses_id=$1',[original]);assert.equal(reversal.publication_model,'ordinary-coowner-v1');assert.equal((await scalar(f,'select count(*)::int n from public.obligation_parties p join public.charges c on c.id=p.charge_id where c.batch_id=$1',[reversal.id])).n,5);
  const after=await scalar(f,'select publication_snapshot from public.charge_batches where id=$1',[corrected]);assert.equal(after.publication_snapshot.personal_changes.before.length,5);assert.equal(after.publication_snapshot.personal_changes.after.length,5);assert.deepEqual(await scalar(f,'select * from public.charge_batches where id=$1',[original]),before);
  assert(after.publication_snapshot.personal_changes.after.some(p=>p.unit_id===f.units[0]&&p.fraction==='0.6000000000'));
  assert.equal((await scalar(f,'select sum(amount)::text sum from public.charges')).sum,'500.00');assert.equal((await scalar(f,'select sum(assessed_amount)::text sum from public.obligation_parties')).sum,'500.00');
  const packet={...f.packet,rows:f.packet.rows.map(r=>({...r,percentage:'25.00000000'}))};
  const shares=(await f.as('A',"select public.save_unit_share_set($1,$2,1,$3,$4,'Synthetic new building distribution, not a personal correction') x",[f.scope.A,f.share.basis_id,randomUUID(),packet])).rows[0].x;
  const saved=(await scalar(f,'select packet from public.unit_share_versions where id=$1',[shares.version_id])).packet;
  await f.as('A',"select public.verify_unit_share_set($1,$2,2,'2026-11-02','Synthetic denominator checked','Synthetic participants checked',$3,'Synthetic new source set verified')",[f.scope.A,shares.version_id,saved.rows.map(r=>r.id)]);
  f.selection={...f.selection,share_version_id:shares.version_id};
  const changedPreview=await f.refreshPreview(),next=await f.save({...f.claim,preview_id:changedPreview,replaces_batch_id:corrected});await f.review(next);
  await assert.rejects(f.publish(next),e=>e.code==='23514'&&e.message==='coowner_correction_preserve_unit_amounts');
  await f.db.exec('create table public.payments(id uuid)');await assert.rejects(f.publish(next),e=>e.code==='23514'&&e.message==='charge_payment_correction_contract_required');assert.equal((await scalar(f,"select count(*)::int n from public.charge_batches where kind='reversal'")).n,1);
 });
 await writeFile(out+'/db-service.json',JSON.stringify({pass:true,hosted:false,mvcc:false,checks,runtime:'Disposable PGlite; real SDK/HTTP service; simulated identities and serialized local transactions',cleanup:'All own DB/HTTP/SDK sessions closed; no credentials or hosted/demo operations',remaining:['Hosted B2 scoped API and UI','Controlled independent PostgreSQL publish/input/review/revoke/correction races','Exact rational quotas; separate natural Publish A rollover']},null,2));console.log('PASS B/2 eight local groups. NOT hosted/MVCC.');
}catch(e){await writeFile(out+'/failure.json',JSON.stringify({checks,code:e.code,message:e.message,where:e.where,stack:e.code?undefined:e.stack},null,2));console.error(e.code||'',e.message,e.where||'');process.exitCode=1;}
