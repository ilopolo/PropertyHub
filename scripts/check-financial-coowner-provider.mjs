import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import {resolve} from 'node:path';
import {createRun,withRun} from './helpers/financial-coowner-run.mjs';
import {runCoownerPhase} from './helpers/financial-coowner-phases.mjs';
import {createProvider,requiredRpc} from './helpers/financial-coowner-provider.mjs';
import {fakeProvider} from './helpers/financial-coowner-fake-provider.mjs';
import {recoverDeadRunLock} from './helpers/financial-coowner-lock.mjs';
import {main} from './run-financial-coowner-hosted.mjs';
const signatures=new Map();for(const file of(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()){
 const sql=await readFile('supabase/migrations/'+file,'utf8');for(const m of sql.matchAll(/create(?: or replace)? function public\.(\w+)\s*\(([\s\S]*?)\)\s*returns/gi))signatures.set(m[1],m[2].split(',').map(v=>v.trim().split(/\s+/)[0]).filter(Boolean));
}
for(const rpc of requiredRpc)assert(signatures.has(rpc),rpc+' is missing from actual migrations');
const root='.local/b2-provider-qa/'+randomUUID();await mkdir(root,{recursive:true});
const config={project:'qfybswnezdzzahmozikr',org_id:randomUUID(),foreign_scope_id:randomUUID(),expectedMigrations:['20261103171619'],actors:{A:{auth_id:randomUUID(),profile_id:randomUUID()},B:{auth_id:randomUUID(),profile_id:randomUUID()}}};
const file=root+'/run.json';await createRun(file,{demoMarker:'PH-DEMO-V1',resourceIds:[randomUUID()]});
const fake=fakeProvider(config,signatures),checks=[];let adapter=createProvider(config,fake.transport);
const check=async(name,fn)=>{await fn();checks.push({name,pass:true});console.log('PASS',name);};
try{
 await check('concrete migrations and fake preflight/baseline, missing credential refusal',async()=>{
  fake.state.missing=true;await assert.rejects(runCoownerPhase(file,'preflight',adapter));fake.state.missing=false;await runCoownerPhase(file,'preflight',adapter);
 });
 await check('concrete setup/revocation receipt resume and named RPC arguments match migrations',async()=>{
  fake.state.crashAfterRevoke=true;await assert.rejects(runCoownerPhase(file,'setup',adapter));assert(JSON.parse(await readFile(file,'utf8')).pending);await runCoownerPhase(file,'reconcile',adapter);
  fake.state.crashAfterAssign=true;await assert.rejects(runCoownerPhase(file,'setup',adapter));await runCoownerPhase(file,'reconcile',adapter);
  await runCoownerPhase(file,'setup',adapter);assert(fake.state.roles.length>=3);
 });
 await check('server commit before local receipt, concrete inspect and resumed assertions without duplicate',async()=>{
  fake.state.crashAfterCommit=true;await assert.rejects(runCoownerPhase(file,'assertions',adapter));
  const before=JSON.parse(await readFile(file,'utf8'));assert(before.pending);assert.equal([...fake.state.batches.values()].filter(b=>b.status==='published').length,1);
  fake.transport.invocation=randomUUID();adapter=createProvider(config,fake.transport);await runCoownerPhase(file,'reconcile',adapter);assert.equal(JSON.parse(await readFile(file,'utf8')).pending,null);
  await runCoownerPhase(file,'assertions',adapter);
 });
 await check('concrete native race wiring through fake independent connections, NOT MVCC',()=>runCoownerPhase(file,'mvcc',adapter));
 await check('cleanup failure retained, exact own resume without financial deletion',async()=>{
  const old=fake.transport.rpc;let once=true;fake.transport.rpc=async(...args)=>{const r=await old(...args);if(once&&args[1]==='revoke_staff_role'){once=false;throw Error('synthetic cleanup interruption after server revoke');}return r;};
  await assert.rejects(runCoownerPhase(file,'cleanup',adapter));const j=JSON.parse(await readFile(file,'utf8'));assert(j.pending);const op=j.operations.find(o=>o.id===j.pending);
  fake.transport.rpc=old;await runCoownerPhase(file,'reconcile',adapter);await runCoownerPhase(file,'cleanup',adapter);
  const clean=JSON.parse(await readFile(file,'utf8'));assert.equal(clean.phase,'cleaned');assert(clean.temporary.every(r=>r.closed));assert(fake.state.charges.length>0&&fake.state.parties.length>0);
 });
 await check('CLI offline and wrong project do not load any provider or credentials',async()=>{
  assert((await main([])).offline);await assert.rejects(main(['--online','--execute','--allow-hosted','--allow-mutations','--allow-isolated-qa','--project-ref','wrong','--manifest',file,'--run',randomUUID()]));
 });
 await check('CLI init/preflight injection and fresh demo boundary, no real credentials/network',async()=>{
  const workspace=resolve(root,'cli-workspace'),demo={marker:'PH-DEMO-V1',state:'active',organization_id:randomUUID()};await mkdir(workspace+'/.local/demo-context',{recursive:true});await writeFile(workspace+'/.local/demo-context/manifest.json',JSON.stringify(demo));await writeFile(workspace+'/.local/config.json',JSON.stringify(config));
  const run=randomUUID(),manifest=workspace+'/.local/run.json',args=['--online','--execute','--allow-hosted','--allow-mutations','--allow-isolated-qa','--project-ref',config.project,'--root',workspace,'--manifest',manifest,'--run',run];
  assert((await main([...args,'--phase','init','--config',workspace+'/.local/config.json'])).created);
  assert((await main([...args,'--phase','init','--config',workspace+'/.local/config.json'])).resumed);
  const injected=createProvider(config,fake.transport);await main([...args,'--phase','preflight'],{transport:fake.transport,adapter:injected});assert.equal(JSON.parse(await readFile(manifest,'utf8')).phase,'baseline');
  demo.newProtectedScope=randomUUID();await writeFile(workspace+'/.local/demo-context/manifest.json',JSON.stringify(demo));await assert.rejects(main([...args,'--phase','setup'],{transport:fake.transport,adapter:injected}));
 });
 await check('unknown/live lock refused; dead exact local owner archived without touching pending',async()=>{
  const j=JSON.parse(await readFile(file,'utf8')),lock=file+'.lock';await writeFile(lock,JSON.stringify({pid:12345,host:hostname()}));await assert.rejects(recoverDeadRunLock(file,j.run,12345,()=> 'unknown'));await assert.rejects(recoverDeadRunLock(file,j.run,12345,()=> 'alive'));
  const result=await recoverDeadRunLock(file,j.run,12345,()=> 'dead');assert(result.recovered);assert.equal(JSON.parse(await readFile(file,'utf8')).pending,j.pending);
 });
 await writeFile(root+'/report.json',JSON.stringify({pass:true,harnessOnly:true,hosted:false,mvcc:false,networkCalls:0,credentialsLoaded:false,checks,signatures:'Parsed actual committed/local SQL; runtime named args checked by fake transport',remaining:'Real hosted preflight/access/independent PostgreSQL outcomes remain unexecuted'},null,2));console.log('PASS concrete fake wiring only; '+root+'/report.json');
}catch(e){await writeFile(root+'/failure.json',JSON.stringify({checks,message:e.message,stack:e.stack},null,2));console.error(e.stack);process.exitCode=1;}
