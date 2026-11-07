// Local controlled interleavings, not independent-session PostgreSQL/MVCC evidence.
// The hook runs only in the disposable fixture, never in a hosted database.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {registryCsvFixture} from './helpers/registry-csv-fixture.mjs';

const out='.local/p6a-wait-exits',checks=[];
let f;
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
try{
 f=await registryCsvFixture();
 const key=randomUUID(),rows=[f.row('wait-replay')],job=await f.stage(rows,'A',f.scope.A,key);
 const source=await readFile('supabase/migrations/20261106185945_registry_csv_current_rights.sql','utf8');
 const start=source.indexOf('create function private.registry_csv_current_permission(');
 const end=source.indexOf('end $$;',start)+'end $$;'.length;
 await f.db.exec(source.slice(start,end).replace('private.registry_csv_current_permission(','private.registry_csv_test_real_permission('));
 await f.db.exec(`create or replace function private.registry_csv_current_permission(scope uuid,permission text) returns boolean
 language plpgsql volatile security definer set search_path='' as $$
 declare n integer:=coalesce(nullif(current_setting('phqa.checks',true),''),'0')::integer;
 expire_after integer:=coalesce(nullif(current_setting('phqa.expire_after',true),''),'0')::integer;
 allowed boolean;target uuid:=nullif(current_setting('phqa.expire_role',true),'')::uuid;
 begin
  allowed:=private.registry_csv_test_real_permission(scope,permission);
  perform set_config('phqa.checks',(n+1)::text,true);
  if expire_after>0 and n+1=expire_after then
   perform pg_sleep(0.02);
   update public.user_roles set valid_to=greatest(clock_timestamp(),valid_from+interval '1 microsecond') where id=target;
   if not found then raise exception 'Local test role missing';end if;
  end if;
  return allowed;
 end $$;`);

 const counts=async()=>(await f.db.query(`select
  (select count(*)::int from public.units) units,
  (select count(*)::int from public.unit_scope_periods) periods,
  (select count(*)::int from public.external_record_links) links,
  (select count(*)::int from public.import_jobs) jobs,
  (select count(*)::int from public.import_rows) rows,
  (select count(*)::int from public.audit_events) audits`)).rows[0];
 async function refusedAfter({role,after,reason,action}){
  const before=await counts();
  await f.db.exec('begin');
  try{
   await f.db.query("select set_config('phqa.checks','0',true),set_config('phqa.expire_after',$1,true),set_config('phqa.expire_role',$2,true)",[String(after),role]);
   await f.db.exec('savepoint refusal');
   await assert.rejects(action,e=>e.code==='42501'&&e.message===reason);
   await f.db.exec('rollback to savepoint refusal');
   assert.deepEqual(await counts(),before,'Rejected interleaving must not create even partial history');
  }finally{await f.db.exec('rollback');}
 }

 await check('allowed stage replay and request mismatch remain distinct with current rights',async()=>{
  assert.equal((await f.stage(rows,'A',f.scope.A,key)).id,job.id);
  await assert.rejects(()=>f.stage([f.row('changed-packet')],'A',f.scope.A,key),e=>e.code==='PT409'&&e.message==='registry_csv_request_mismatch');
 });
 await check('revoked staging replay refuses after advisory boundary before returning saved payload',async()=>{
  await refusedAfter({role:f.importRole,after:2,reason:'registry_csv_prepare_revoked',action:()=>f.stage(rows,'A',f.scope.A,key)});
 });
 await check('revoked replay also refuses before exposing request mismatch details',async()=>{
  await refusedAfter({role:f.importRole,after:2,reason:'registry_csv_prepare_revoked',action:()=>f.stage([f.row('changed-packet')],'A',f.scope.A,key)});
 });
 await check('new staging refuses after advisory boundary and after scope boundary',async()=>{
  for(const after of [2,4])await refusedAfter({role:f.importRole,after,reason:'registry_csv_prepare_revoked',action:()=>f.stage([f.row('new-stage-'+after)])});
 });
 await check('waiting commit refuses before first write and before stale/mismatch branches',async()=>{
  await refusedAfter({role:f.commitRole,after:2,reason:'registry_csv_commit_revoked',action:()=>f.commit(job,'B')});
  await refusedAfter({role:f.commitRole,after:2,reason:'registry_csv_commit_revoked',action:()=>f.commit(job,'B',randomUUID(),99,'0'.repeat(64))});
 });
 let committed,commitKey;
 await check('current-rights commit and exact replay are allowed, different key is conflict',async()=>{
  commitKey=randomUUID();committed=await f.commit(job,'B',commitKey);assert.equal(committed.created,1);
  assert.deepEqual(await f.commit(job,'B',commitKey),committed);
  await assert.rejects(()=>f.commit(job,'B'),e=>e.code==='PT409'&&e.message==='registry_csv_already_committed');
 });
 await check('revoked commit replay refuses before returning immutable committed receipt',async()=>{
  await refusedAfter({role:f.commitRole,after:2,reason:'registry_csv_commit_revoked',action:()=>f.commit(job,'B',commitKey)});
 });
 await check('export and staging read retain their explicit current-request dependencies',async()=>{
  assert.equal((await f.as('doc','select public.export_registry_units($1) data',[f.scope.A])).rows[0].data.template_version,'units-export-v1');
  assert.equal((await f.inspect(job,'B')).id,job.id);
  await assert.rejects(()=>f.inspect(job,'doc'),e=>e.code==='42501');
  await f.as('orgA','select public.revoke_staff_role($1)',[f.commitRole]);
  await assert.rejects(()=>f.inspect(job,'B'),e=>e.code==='42501');
  await assert.rejects(()=>f.commit(job,'B',commitKey),e=>e.code==='42501');
  await f.as('orgA','select public.revoke_staff_role($1)',[f.exportRole]);
  await assert.rejects(()=>f.as('doc','select public.export_registry_units($1)',[f.scope.A]),e=>e.code==='42501');
 });
 await mkdir(out,{recursive:true});
 await writeFile(out+'/report.json',JSON.stringify({pass:true,localOnly:true,hosted:false,mvcc:false,checks,controlledInterleaving:'Real predicate then test-only role expiration at selected entry/after-advisory boundary; errors/transaction state checked. Not a real lock waiter.'},null,2));
}catch(e){console.error('CSV wait-exit regression failed',e.code??e.name,e.name==='AssertionError'?e.message:'');process.exitCode=1;}finally{await f?.db.close();}
