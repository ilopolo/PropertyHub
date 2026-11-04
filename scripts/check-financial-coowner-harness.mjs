import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createRun,withRun,assertIsolatedRun,gateHosted} from './helpers/financial-coowner-run.mjs';
import {observedTransactionRace} from './helpers/financial-coowner-barrier.mjs';
import {runCoownerPhase} from './helpers/financial-coowner-phases.mjs';
const dir='.local/b2-harness-qa/'+randomUUID();await mkdir(dir,{recursive:true});
const demoId='dddddddd-0000-4000-8000-000000000001',checks=[];
const state={writes:new Map(),baseline:{publishA:{hash:'original-A'},protectedDemo:{hash:'durable-demo'},personal:{hash:'personal'},existingAssignments:{hash:'existing-roles'}},calls:0,cleanup:[],crash:false,unknown:false,notApplied:false};
const adapter={
 async preflight(){return{project:'qfybswnezdzzahmozikr',schemaReady:true,isolationVerified:true};},
 async baseline(){return structuredClone(state.baseline);},
 async authorize(j,op){assert(op.args.marker===j.marker,'Foreign marker');assert(!j.protection.resourceIds.includes(op.args.id),'Protected ID');if(op.name==='cleanup-owned')assert(j.temporary.some(r=>r.id===op.args.id&&r.marker===j.marker),'Foreign cleanup ID');},
 async write(j,op){
  const disk=JSON.parse(await readFile(file,'utf8'));assert(disk.baseline&&disk.pending===op.id,'Intent/baseline must be persisted first');state.calls++;
  if(state.notApplied)throw Error('synthetic transport failed before any write');
  const result={id:op.args.id||randomUUID(),marker:j.marker};state.writes.set(op.id,result);
  if(op.name==='cleanup-owned')state.cleanup.push(op.args.id);
  if(state.crash)throw Error('synthetic interruption after committed write');return result;
 },
 async register(j,op,result){if(op.name==='create-role'&&!j.temporary.some(r=>r.id===result.id))j.temporary.push({id:result.id,kind:'role',marker:j.marker,createdByRun:j.run,createdOperation:op.id});},
 async inspect(j,op){if(state.unknown)return{state:'unknown',evidence:'synthetic unavailable receipt'};if(state.writes.has(op.id))return{state:'committed',result:state.writes.get(op.id),evidence:'synthetic authoritative exact operation receipt'};return{state:'not-applied',evidence:'synthetic authoritative receipt and resource absence'};},
 async close(){}
};
const file=dir+'/run.json',protection={demoMarker:'PH-DEMO-V1',resourceIds:[demoId]};
const run=await createRun(file,protection);
const phase=action=>withRun(file,adapter,action);
async function test(name,action){await action();checks.push({name,pass:true});console.log('PASS',name);}
await test('offline/exact-project/mutation gates before adapter loading',async()=>{
 assert.deepEqual(gateHosted([]),{offline:true});
 for(const args of [['--execute'],['--execute','--project-ref','wrong'],['--execute','--allow-hosted','--allow-mutations','--allow-isolated-qa','--project-ref','qfybswnezdzzahmozikr']])assert.throws(()=>gateHosted(args));assert.equal(state.calls,0);
});
await test('baseline before write and refusal of missing schema',async()=>{
 await phase(async c=>{await assert.rejects(c.write('bad','publish',{marker:run.marker}));await c.preflight();await c.baseline();});
 const bad={...adapter,preflight:async()=>({project:run.project,schemaReady:false,isolationVerified:true})};await assert.rejects(withRun(file,bad,c=>c.preflight()));assert.equal(state.calls,0);
});
await test('interrupted after write, restart blocks writes/cleanup, reconcile exact receipt',async()=>{
 state.crash=true;await assert.rejects(phase(c=>c.write('role-1','create-role',{marker:run.marker})));
 assert(JSON.parse(await readFile(file,'utf8')).pending);state.crash=false;
 await phase(async c=>{await assert.rejects(c.write('second','publish',{marker:run.marker}));await assert.rejects(c.cleanup());assert.equal((await c.reconcile()).state,'committed');});
 const before=state.calls;await phase(c=>c.write('role-1','create-role',{marker:run.marker}));assert.equal(state.calls,before);
});
await test('unknown publish outcome never retries or cleans up',async()=>{
 state.crash=true;await assert.rejects(phase(c=>c.write('publish-1','publish',{marker:run.marker})));state.crash=false;state.unknown=true;
 const before=state.calls;await assert.rejects(phase(c=>c.reconcile()));await assert.rejects(phase(c=>c.cleanup()));assert.equal(state.calls,before);state.unknown=false;await phase(c=>c.reconcile());
});
await test('confirmed absent operation may retry once; changed key payload refused',async()=>{
 state.notApplied=true;await assert.rejects(phase(c=>c.write('correction-1','correct',{marker:run.marker})));state.notApplied=false;await phase(c=>c.reconcile());
 await phase(c=>c.write('correction-1','correct',{marker:run.marker}));const n=state.calls;await phase(c=>c.write('correction-1','correct',{marker:run.marker}));assert.equal(state.calls,n);
 await assert.rejects(phase(c=>c.write('correction-1','correct',{marker:run.marker,other:'changed'})));
});
await test('protected demo IDs and foreign cleanup marker refused before write',async()=>{
 const before=state.calls;await assert.rejects(phase(c=>c.write('foreign','cleanup-owned',{id:randomUUID(),marker:'foreign'})));await assert.rejects(phase(c=>c.write('demo','cleanup-owned',{id:demoId,marker:run.marker})));assert.equal(state.calls,before);
 const saved=JSON.parse(await readFile(file,'utf8')),bad=structuredClone(saved);bad.temporary.push({id:randomUUID(),kind:'role',marker:'foreign',createdByRun:run.run,createdOperation:'unknown'});assert.throws(()=>assertIsolatedRun(bad));
 bad.temporary=[];bad.resources.push({id:demoId,marker:run.marker,createdByRun:run.run});assert.throws(()=>assertIsolatedRun(bad));
});
await test('baseline change blocks cleanup without restoring foreign records',async()=>{
 state.baseline.publishA.hash='unexpected-change';const n=state.calls;await assert.rejects(phase(c=>c.cleanup()));assert.equal(state.calls,n);state.baseline.publishA.hash='original-A';
});
await test('own-looking cleanup ID without matching creation receipt is refused',async()=>{
 const saved=await readFile(file,'utf8'),j=JSON.parse(saved);j.temporary[0].id=randomUUID();await writeFile(file,JSON.stringify(j));
 const n=state.calls;await assert.rejects(phase(c=>c.cleanup()));assert.equal(state.calls,n);await writeFile(file,saved);
});
await test('cleanup touches own recorded role only, financial/audit history retained',async()=>{
 const own=JSON.parse(await readFile(file,'utf8')).temporary.map(r=>r.id);await phase(c=>c.cleanup());assert.deepEqual(state.cleanup,own);const j=JSON.parse(await readFile(file,'utf8'));assert.equal(j.phase,'cleaned');assert(j.operations.some(o=>o.key==='publish-1'&&o.state==='committed'));assert.equal(j.pending,null);
});
await test('cleanup HTTP denial is not marked closed or cleaned',async()=>{
 const path=dir+'/denied-cleanup.json',copy=JSON.parse(await readFile(file,'utf8'));copy.phase='setup-done';copy.temporary[0].closed=false;await writeFile(path,JSON.stringify(copy));
 // A distinct cleanup intent tests the provider denial rather than reusing the earlier synthetic success.
 copy.operations=copy.operations.filter(o=>!o.key.startsWith('cleanup:'));await writeFile(path,JSON.stringify(copy));
 const denied={...adapter,write:async()=>({status:403,code:'42501',id:copy.temporary[0].id})};await assert.rejects(withRun(path,denied,c=>c.cleanup()));const current=JSON.parse(await readFile(path,'utf8'));assert.equal(current.temporary[0].closed,false);assert.notEqual(current.phase,'cleaned');
});
await test('native barrier observes distinct waiter before commit; deadlines/finally close only own connections',async()=>{
 const claims={role:'authenticated',sub:randomUUID(),session_id:randomUUID()};
 function nativeFixture({waiter=true,duplicate=false}={}){
  const log=[],closed=[],pids={holder:101,contender:duplicate?101:102,observer:103};let release;
  const blocked=new Promise(resolve=>release=resolve);let released=false;
  const connect=async name=>({
   async query(sql,args=[]){log.push({name,sql});if(sql==='select pg_backend_pid() pid')return{rows:[{pid:pids[name]}]};
    if(sql==='select auth.uid()::text uid')return{rows:[{uid:claims.sub}]};
    if(sql.includes('from pg_locks'))return{rows:[{granted:true,mode:'ShareLock'}]};
    if(sql.includes('from pg_stat_activity'))return{rows:waiter&&!released?[{pid:102,wait_event_type:'Lock',wait_event:'advisory',blockers:[101]}]:[]};
    if(name==='holder'&&['commit','rollback'].includes(sql)){released=true;release();}return{rows:[]};},
   async end(){closed.push(name);}
  });
  return{log,closed,connect,holderAction:async()=>({rows:[{id:'synthetic only'}],rowCount:1,command:'SELECT',_parsers:[()=>{}]}),contenderAction:async()=>{await blocked;return{sameBatch:true};},holderClaims:claims,contenderClaims:claims};
 }
 const good=nativeFixture();let persisted;const evidence=await observedTransactionRace({...good,onObserved:async e=>{persisted=structuredClone(e);}});assert(evidence.pass&&evidence.waiter);assert.deepEqual(persisted.holder,{rows:[{id:'synthetic only'}],rowCount:1,command:'SELECT'});assert.deepEqual(good.closed.sort(),['contender','holder','observer']);
 assert(good.log.some(q=>q.sql.includes("statement_timeout='15000ms'")));
 for(const data of [nativeFixture({waiter:false}),nativeFixture({duplicate:true})]){await assert.rejects(observedTransactionRace({...data,deadlineMs:0}));assert.deepEqual(data.closed.sort(),['contender','holder','observer']);}
 assert(!good.log.some(q=>q.sql.includes('pg_cancel_backend')||q.sql.includes('pg_terminate_backend')));
});
await test('separate executable phases reject incomplete setup/evidence and cannot skip to MVCC',async()=>{
 const p=dir+'/phases.json';await createRun(p,protection);
 const staged={...adapter,setup:async()=>{},assertions:async()=>[],mvcc:async()=>[]};
 await assert.rejects(runCoownerPhase(p,'assertions',staged));await runCoownerPhase(p,'preflight',staged);await assert.rejects(runCoownerPhase(p,'mvcc',staged));
 await runCoownerPhase(p,'setup',staged);await assert.rejects(runCoownerPhase(p,'assertions',staged));
 staged.assertions=async()=>['positive','denials','stale-revoke','duplicates','correction','legacy'].map(id=>({id,pass:true,evidence:'synthetic adapter only'}));
 await runCoownerPhase(p,'assertions',staged);await assert.rejects(runCoownerPhase(p,'mvcc',staged));
 staged.mvcc=async()=>['publish-publish','publish-input','unpaid-correction'].map(id=>({id,pass:true,invariants:true,barrier:{waiter:{synthetic:true},pids:{holder:101,contender:102,observer:103}}}));
 await runCoownerPhase(p,'mvcc',staged);assert.equal(JSON.parse(await readFile(p,'utf8')).phase,'mvcc-done');
});
await writeFile(dir+'/report.json',JSON.stringify({pass:true,harnessOnly:true,hosted:false,mvcc:false,checks,networkCalls:0,credentialsLoaded:false,cleanup:'Synthetic adapters only; all artifacts retained under ignored .local',remaining:'Concrete provider adapter/phase wiring and real PostgreSQL barrier evidence remain separate readiness gates'},null,2));
console.log('PASS harness only; no hosted/MVCC evidence. Report '+dir+'/report.json');
