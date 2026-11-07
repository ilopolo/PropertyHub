// Targeted local regression only. No hosted Auth or independent-session MVCC proof.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {registryCsvFixture} from './helpers/registry-csv-fixture.mjs';

const out='.local/p6a-current-rights',checks=[];
let f;
const pause=()=>new Promise(resolve=>setTimeout(resolve,35));
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const denied=async fn=>{await assert.rejects(fn,error=>error.code==='42501');};
try{
 f=await registryCsvFixture({currentRights:false});
 const stageKey=randomUUID(),sourceRows=[f.row('clock-guard')];
 const job=await f.stage(sourceRows,'A',f.scope.A,stageKey);
 await check('original transaction-clock defect reproduced locally then rolled back',async()=>{
  await f.db.exec('begin');
  try{
   await pause();
   await f.db.query('update public.user_roles set valid_to=clock_timestamp() where id=$1',[f.commitRole]);
   const r=await f.commit(job,'B');
   assert.equal(r.created,1,'Original guard reproduction must reach the real write');
  }finally{await f.db.exec('rollback');}
  assert.equal((await f.inspect(job)).status,'ready');
 });
 await f.db.exec('begin;'+await readFile('supabase/migrations/20261106185945_registry_csv_current_rights.sql','utf8')+'commit;');
 await check('expired commit grant refuses in the older transaction without partial records',async()=>{
  const before=(await f.db.query('select count(*)::int n from public.units')).rows[0].n;
  await f.db.exec('begin');
  try{
   await pause();
   await f.db.query('update public.user_roles set valid_to=clock_timestamp() where id=$1',[f.commitRole]);
   await f.db.exec('savepoint rejected_commit');
   await denied(()=>f.commit(job,'B'));
   await f.db.exec('rollback to savepoint rejected_commit');
   assert.equal((await f.db.query('select count(*)::int n from public.units')).rows[0].n,before);
   assert.equal((await f.db.query('select status from public.import_jobs where id=$1',[job.id])).rows[0].status,'ready');
  }finally{await f.db.exec('rollback');}
 });
 await check('expired prepare grant refuses stage/replay; no private helper privilege is added',async()=>{
  await f.db.exec('begin');
  try{
   await pause();
   await f.db.query('update public.user_roles set valid_to=clock_timestamp() where id=$1',[f.importRole]);
   await f.db.exec('savepoint rejected_stage');
   await denied(()=>f.stage([f.row('revoked-stage')],'A'));
   await f.db.exec('rollback to savepoint rejected_stage');
   await denied(()=>f.stage(sourceRows,'A',f.scope.A,stageKey));
   await f.db.exec('rollback to savepoint rejected_stage');
  }finally{await f.db.exec('rollback');}
  const r=(await f.db.query("select has_function_privilege('authenticated','private.registry_csv_current_permission(uuid,text)','EXECUTE') a,has_function_privilege('anon','private.registry_csv_current_permission(uuid,text)','EXECUTE') n")).rows[0];
  assert(!r.a&&!r.n);
  await denied(()=>f.as('A',"select private.registry_csv_current_permission($1,'read_registry')",[f.scope.A]));
 });
 await check('valid explicit staging/commit/replay and exact current-date periods remain intact',async()=>{
  const key=randomUUID(),result=await f.commit(job,'B',key);
  assert.equal(result.created,1);
  assert.deepEqual(await f.commit(job,'B',key),result);
  const p=(await f.db.query('select valid_from::text d from public.unit_scope_periods where unit_id=any($1::uuid[])',[result.unit_ids])).rows;
  assert(p.every(x=>x.d===f.today));
  const reordered=await f.stage([f.row('clock-guard')]);
  assert.equal((await f.commit(reordered)).unchanged,1);
 });
 await mkdir(out,{recursive:true});
 await writeFile(out+'/report.json',JSON.stringify({pass:true,localOnly:true,hosted:false,mvcc:false,checks,originalDefectReproduced:true,correctiveMigrationAppliedHosted:false},null,2));
}catch(e){console.error('CSV current-rights local regression failed',e.code??e.name);process.exitCode=1;}finally{await f?.db.close();}
