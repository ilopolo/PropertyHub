import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRun,gateHosted,withRun,targetProject} from './helpers/financial-coowner-run.mjs';
import {runCoownerPhase} from './helpers/financial-coowner-phases.mjs';
import {recoverDeadRunLock} from './helpers/financial-coowner-lock.mjs';
import {assertIsolatedDemoBoundary} from './helpers/demo-guard.mjs';
export async function main(args,dependencies={}){
 const value=k=>args[args.indexOf(k)+1],phase=args.includes('--phase')?value('--phase'):'plan';
 if(!args.includes('--online')){assert(!args.includes('--execute'),'--online is required before execute');return{offline:true,phases:['init','preflight','setup','assertions','mvcc','reconcile','cleanup','recover-lock'],credentialsLoaded:false};}
 const gated=gateHosted(args);assert(!gated.offline,'Online without execute refused');assert(args.includes('--run')&&/^[a-f0-9-]{36}$/.test(value('--run')),'Exact run UUID required');
 assert(['init','preflight','setup','assertions','mvcc','reconcile','cleanup','recover-lock'].includes(phase),'Exact phase required before transport loading');
 const file=gated.manifest,root=resolve(value('--root')||'.');assert(args.includes('--root'),'Explicit original checkout root required');
 assert(relative(root,file).replaceAll('\\','/').startsWith('.local/'),'Manifest must be inside the checkout ignored .local');
 if(phase==='init'){
  assert(args.includes('--config'),'Reviewed config path required');const config=JSON.parse(await readFile(resolve(value('--config')),'utf8'));assert.equal(config.project,targetProject);
  assert(Object.keys(config).every(k=>['project','org_id','foreign_scope_id','actors','expectedMigrations'].includes(k)),'Config accepts identifiers/history only, never credentials');
  assert(Object.values(config.actors).every(a=>Object.keys(a).every(k=>['auth_id','profile_id'].includes(k))),'Actor config accepts exact IDs only');
  const demo=JSON.parse(await readFile(resolve(root,'.local/demo-context/manifest.json'),'utf8'));assert.equal(demo.marker,'PH-DEMO-V1');
  const ids=[...new Set((JSON.stringify(demo).match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/gi)||[]).map(id=>id.toLowerCase()))];assert(ids.length>0);assert(!ids.includes(config.org_id.toLowerCase()),'Demo org is protected');
  let created=true;try{await createRun(file,{demoMarker:'PH-DEMO-V1',resourceIds:ids},value('--run'));}catch(e){if(e.code!=='EEXIST')throw e;created=false;}
  await withRun(file,{},async ctx=>{assert.equal(ctx.j.run,value('--run'));assert.equal(ctx.j.phase,'new');assert.equal(ctx.j.operations.length,0);if(ctx.j.config)assert.deepEqual(ctx.j.config,config,'Init config changed');ctx.j.config=config;assertIsolatedDemoBoundary(demo,ctx.j);await ctx.save();});
  return{created,resumed:!created,run:value('--run'),credentialsLoaded:false};
 }
 if(phase==='recover-lock'){assert(args.includes('--owner-pid'),'Exact recorded owner PID required');return recoverDeadRunLock(file,value('--run'),Number(value('--owner-pid')));}
 const j=JSON.parse(await readFile(file,'utf8'));assert.equal(j.run,value('--run'));assert.equal(j.project,targetProject);assert(j.config,'Interrupted init: resume the exact init before loading credentials');
 assertIsolatedDemoBoundary(JSON.parse(await readFile(resolve(root,'.local/demo-context/manifest.json'),'utf8')),j);
 const transport=dependencies.transport??await (await import('./helpers/financial-coowner-transport.mjs')).loadNativeTransport(root,{...j.config,run:j.run});
 const adapter=dependencies.adapter??(await import('./helpers/financial-coowner-provider.mjs')).createProvider(j.config,transport);
 await runCoownerPhase(file,phase,adapter);return{run:j.run,phase,hostedExecuted:!dependencies.transport,harnessOnly:!!dependencies.transport};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error('B2 driver stopped:',e.code||e.name,'; inspect the run journal. No automatic retry.');process.exitCode=1;});
