// QA harness only. No provider imports, env loading, network or product arithmetic.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,readFile,rename,unlink,access} from 'node:fs/promises';
import {hostname} from 'node:os';
import {dirname,resolve} from 'node:path';
export const targetProject='qfybswnezdzzahmozikr';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const secretKey=/password|access_token|refresh_token|session_token|authorization|database_url|secret|connectionstring/i;
function safe(value){
 if(value&&typeof value==='object')for(const[k,v]of Object.entries(value)){assert(!secretKey.test(k),'Secret-bearing journal field refused');safe(v);}
 if(typeof value==='string')assert(!/^(?:eyJ[\w-]+\.[\w-]+\.|postgres(?:ql)?:\/\/|sb_secret_|sbp_)/.test(value),'Secret-bearing journal value refused');
 return value;
}
export function runIdentity(id=randomUUID()){assert(uuid.test(id),'Invalid run UUID');return{run:id,marker:'PH-QA-B2-'+id,project:targetProject};}
export function assertIsolatedRun(j){
 assert.equal(j.project,targetProject,'Wrong project');assert.deepEqual({run:j.run,marker:j.marker,project:j.project},runIdentity(j.run));
 assert(j.protection?.demoMarker==='PH-DEMO-V1'&&Array.isArray(j.protection.resourceIds)&&j.protection.resourceIds.length>0,'Protected demo manifest/baseline required');
 const protectedIds=new Set(j.protection.resourceIds);const owned=j.resources||[];
 for(const r of owned){assert(uuid.test(r.id)&&r.marker===j.marker&&r.createdByRun===j.run,'Foreign resource marker refused');assert(!protectedIds.has(r.id),'Protected demo resource refused');}
 for(const r of j.temporary||[]){assert(uuid.test(r.id)&&r.marker===j.marker&&r.createdByRun===j.run&&r.createdOperation,'Unowned cleanup resource refused');assert(['role','assignment','session','owner-link'].includes(r.kind),'Financial/foreign cleanup kind refused');assert(!protectedIds.has(r.id),'Protected demo assignment/session refused');}
 return true;
}
export function gateHosted(args){
 if(!args.includes('--execute'))return{offline:true};
 assert(args.includes('--allow-hosted')&&args.includes('--allow-mutations')&&args.includes('--allow-isolated-qa'),'Explicit hosted/mutation/isolation flags required');
 const value=name=>args[args.indexOf(name)+1];assert(args.includes('--project-ref')&&value('--project-ref')===targetProject,'Exact project ref required');
 assert(args.includes('--manifest')&&value('--manifest'),'Exact run manifest path required');return{offline:false,manifest:resolve(value('--manifest'))};
}
export async function createRun(file,protection,id){
 const j={schema:'ph-b2-run-v1',...runIdentity(id),protection,revision:0,phase:'new',baseline:null,resources:[],temporary:[],operations:[],checks:[],pending:null};safe(j);assertIsolatedRun(j);
 await mkdir(dirname(file),{recursive:true});const handle=await open(file,'wx');try{await handle.writeFile(JSON.stringify(j,null,2));await handle.sync();}finally{await handle.close();}return j;
}
export async function withRun(file,adapter,action){
 // A crashed process leaves the lock intact. Never steal it on a timeout; inspect the PID first.
 const lock=file+'.lock',recovering=async()=>access(file+'.recovery-lock').then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
 assert(!await recovering(),'Lock recovery in progress');let handle;try{handle=await open(lock,'wx');}catch(e){if(e.code==='EEXIST')throw Error('Run locked: inspect/reconcile its process; do not delete or steal a live lock');throw e;}
 if(await recovering()){await handle.close();await unlink(lock);throw Error('Lock recovery in progress');}
 await handle.writeFile(JSON.stringify({pid:process.pid,host:hostname(),at:new Date().toISOString()}));await handle.sync();
 let j;
 try{
  j=JSON.parse(await readFile(file,'utf8'));safe(j);assertIsolatedRun(j);assert.equal(j.schema,'ph-b2-run-v1');if(j.baseline)assert.equal(digest(j.baseline.snapshot),j.baseline.hash,'Saved baseline digest mismatch');
  const save=async()=>{safe(j);assertIsolatedRun(j);j.revision++;const tmp=file+'.'+j.revision+'.'+randomUUID()+'.tmp';const f=await open(tmp,'wx');try{await f.writeFile(JSON.stringify(j,null,2));await f.sync();}finally{await f.close();}await rename(tmp,file);};
  const checkpoint=async phase=>{assert(!j.pending,'Reconcile unknown result before phase change');j.phase=phase;await save();};
  const preflight=async()=>{
   assert(!j.pending,'Reconcile first');const result=await adapter.preflight(j);safe(result);
   assert.equal(result.project,targetProject);assert.equal(result.schemaReady,true,'Missing schema is a preflight blocker, never an authorization PASS');
   assert.equal(result.isolationVerified,true,'Actual non-demo isolation required');j.preflight=result;await save();return result;
  };
  const baseline=async()=>{
   assert(j.preflight?.schemaReady,'Preflight required');assert(!j.pending,'Reconcile first');
   if(j.baseline){await verifyBaseline();return j.baseline;}
   assert(j.operations.length===0,'Baseline must precede mutations');const snapshot=await adapter.baseline(j);safe(snapshot);
   assert(snapshot.publishA&&snapshot.protectedDemo&&snapshot.personal&&snapshot.existingAssignments,'Complete protected baseline required');
   j.baseline={at:new Date().toISOString(),snapshot,hash:digest(snapshot)};await save();return j.baseline;
  };
  const verifyBaseline=async()=>{assert(j.baseline,'Baseline required');const current=await adapter.baseline(j);assert.equal(digest(current),j.baseline.hash,'Protected baseline changed: stop without broad restoration');return true;};
  const reconcile=async()=>{
   assert(j.pending,'No unknown operation');const op=j.operations.find(o=>o.id===j.pending);assert(op&&op.state==='intent','Bad operation journal');
   // inspect must use authoritative receipts/exact marker/business IDs, not transport status or a missing response.
   const result=await adapter.inspect(j,op);safe(result);
   assert(['committed','not-applied','unknown'].includes(result.state),'Invalid reconciliation evidence');
   op.observations??=[];op.observations.push(result);await save();
   if(result.state==='unknown')throw Error('Unknown outcome remains blocked; no replay or cleanup');
   assert(result.evidence,'Authoritative reconciliation evidence required');
   op.state=result.state;op.result=result.result??null;j.pending=null;
   if(result.state==='committed')await adapter.register(j,op,result.result);
   await save();return result;
  };
  const write=async(key,name,args)=>{
   assert(j.preflight?.schemaReady&&j.baseline,'Preflight and persisted baseline required before write');assert(!j.pending,'Reconciliation required before another write');safe(args);
   await adapter.authorize(j,{name,args});
   const canonical={name,args},prior=j.operations.findLast(o=>o.key===key);
   if(prior){assert.equal(prior.inputHash,digest(canonical),'Operation key/input changed');if(prior.state==='committed')return prior.result;assert.equal(prior.state,'not-applied','Unknown operation cannot be replayed');}
   const op={id:randomUUID(),key,name,args,inputHash:digest(canonical),marker:j.marker,state:'intent',intentAt:new Date().toISOString()};j.operations.push(op);j.pending=op.id;await save();
   // If call or result persistence fails, keep pending. No catch-and-retry, including after client timeouts.
   const result=await adapter.write(j,op);safe(result);op.result=result;op.state='committed';await adapter.register(j,op,result);j.pending=null;await save();return result;
  };
  const cleanup=async()=>{
   assert(!j.pending,'Reconcile before cleanup');assert(j.baseline,'Baseline required');assertIsolatedRun(j);await verifyBaseline();
   for(const item of j.temporary.filter(r=>!r.closed).sort((a,b)=>(a.kind==='session')-(b.kind==='session'))){
    const created=j.operations.find(o=>o.id===item.createdOperation);assert(created?.state==='committed'&&created.result?.id===item.id,'Cleanup requires the exact successful own creation receipt');
    const result=await write('cleanup:'+item.kind+':'+item.id,'cleanup-owned',{kind:item.kind,id:item.id,scope_id:item.scope_id??null,marker:j.marker});assert(!result.code&&(!('status'in result)||result.status>=200&&result.status<300),'Cleanup refused: keep exact resource open for reconciliation');item.closed=true;await save();
   }
   // Retain all scope/financial/audit resources. No data-delete interface is exposed.
   await verifyBaseline();await checkpoint('cleaned');return j;
  };
  return await action({j,save,checkpoint,preflight,baseline,verifyBaseline,write,reconcile,cleanup});
 }finally{try{await adapter.close?.();}finally{await handle.close();await unlink(lock);}}
}
