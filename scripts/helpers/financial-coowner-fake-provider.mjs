// Isolated harness transport. It does not implement PostgreSQL or prove financial/RLS/MVCC correctness.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {allocatePersonal} from '../../src/domain/personal-allocation.js';
import {fractionUnits} from '../../src/domain/ownership.js';
export function fakeProvider(config,signatures){
 const state={rows:new Map(),roles:[],owners:[],previews:new Map(),batches:new Map(),charges:[],parties:[],receipts:new Map(),epoch:0,epochs:{},pid:300,holder:null,waiting:null,release:null,closed:[],calls:[],crashAfterCommit:false,missing:false};
 const row=(id=randomUUID(),fields={})=>{const r={id,...fields};state.rows.set(id,r);return r;};
 const error=(code,status=400)=>({status,code,data:null,id:null});
 function publish(p,who){
  if(!state.roles.some(r=>r.scope_id===p.scope&&r.who===who&&!r.valid_to&&r.permissions.includes('publish_charges')))return error('42501',403);
  const receipt=state.receipts.get(who+':'+p.request_key);if(receipt)return receipt;
  const b=state.batches.get(p.target);if(b.revision!==p.expected_revision||b.status!=='draft')return error('PT409',409);
  if(state.previews.get(b.claim.preview_id).epoch!==(state.epochs[p.scope]||0))return{...error('PT409',409),errorName:'charge_preview_inputs_changed'};
  if(b.claim.replaces_batch_id){if([...state.batches.values()].some(x=>x.reverses_id===b.claim.replaces_batch_id))return error('PT409',409);const old=state.batches.get(b.claim.replaces_batch_id),reverse=row(undefined,{scope_id:p.scope,status:'published',reverses_id:old.id});state.batches.set(reverse.id,reverse);for(const c of state.charges.filter(c=>c.batch_id===old.id)){const nc=row(undefined,{...c,id:randomUUID(),batch_id:reverse.id,amount:'-'+c.amount});state.charges.push(nc);for(const op of state.parties.filter(x=>x.charge_id===c.id))state.parties.push({...op,charge_id:nc.id,assessed_amount:'-'+op.assessed_amount});}}
  else if([...state.batches.values()].some(x=>x.scope_id===p.scope&&x.status==='published'&&!x.claim?.replaces_batch_id&&x.claim&&!x.reverses_id))return error('PT409',409);
  b.status='published';b.revision++;const x=inputs(b.claim);b.publication_snapshot={inputs:x};
  for(const u of state.previews.get(b.claim.preview_id).result.rows){const c=row(undefined,{batch_id:b.id,scope_id:p.scope,unit_id:u.unit_id,amount:u.amount});state.charges.push(c);for(const op of x.parties.filter(o=>o.unit_id===c.unit_id))state.parties.push({charge_id:c.id,person_id:op.person_id,assessed_amount:op.amount,person_snapshot:op,party_basis:{payer_is_separate:true}});}
  const result={status:200,code:null,id:b.id,data:b.id};state.receipts.set(who+':'+p.request_key,result);return result;
 }
 function inputs(claim){const pv=state.previews.get(claim.preview_id);return{gaps:[],parties:pv.result.rows.flatMap(u=>{const owners=state.owners.filter(o=>o.unit_id===u.unit_id);const a=allocatePersonal({unit_amount_cents:u.amount_cents,regime:'ordinary_fractional',expected_person_ids:owners.map(o=>o.person_id),rows:owners.map(o=>({person_id:o.person_id,ownership_fraction:o.fraction}))});return owners.sort((a,b)=>a.person_id<b.person_id?-1:1).map(o=>{const v=a.rows.find(x=>x.person_id===o.person_id);return{unit_id:u.unit_id,person_id:o.person_id,person_revision:1,ownership_id:o.id,fraction:o.fraction,amount:(BigInt(v.amount_cents)/100n)+'.'+(BigInt(v.amount_cents)%100n).toString().padStart(2,'0'),personal_allocation:v};});})};}
 async function rpc(who,name,p){
  const signature=signatures.get(name);assert(signature,'Unknown concrete RPC: '+name);for(const k of Object.keys(p))assert(signature.includes(k),'Unknown parameter '+name+'.'+k);state.calls.push({who,name,p});
  let data=null;
  if(name==='request_scope_setup')data=row(undefined,{label:p.label,organization_id:p.org}).id;
  else if(name==='complete_scope_setup'){data=row(undefined,{building_id:randomUUID()}).id;state.roles.push(row(undefined,{scope_id:data,profile_id:config.actors.A.profile_id,who:'A',role_code:'manager',permissions:['read_registry','manage_registry'],valid_to:null}));}
  else if(name==='revoke_staff_role'){state.roles.find(r=>r.id===p.role_id).valid_to='ended';}
  else if(name==='assign_staff_role'){const whoKey=Object.keys(config.actors).find(k=>config.actors[k].auth_id===p.target_auth_user_id);data=row(undefined,{who:whoKey,scope_id:p.scope,profile_id:config.actors[whoKey].profile_id,role_code:p.role,permissions:p.permissions,valid_to:null}).id;state.roles.push(state.rows.get(data));}
  else if(name==='create_unit')data=row(undefined,{scope_id:p.scope,unit_number:p.unit_number}).id;
  else if(name==='save_scoped_person')data=row(undefined,{source_reference:p.source_reference}).id;
  else if(name==='apply_ownership_changes'){data=p.changes.map(c=>{if(c.target)state.owners=state.owners.filter(o=>o.id!==c.target);const r=row(undefined,{unit_id:p.unit,...c});state.owners.push(r);return r.id;});}
  else if(name==='save_unit_share_set'){const id=row(undefined,{packet:{rows:p.payload.rows.map(r=>({...r,id:randomUUID()}))}}).id;data={basis_id:randomUUID(),version_id:id,revision:1};}
  else if(name==='save_financial_resolution'||name==='save_financial_rule'||name==='activate_financial_rule')data=row().id;
  else if(name==='load_financial_preview_inputs'){for(const u of [...state.rows.values()].filter(r=>r.unit_number&&r.scope_id===p.scope)){const owners=state.owners.filter(o=>o.unit_id===u.id&&o.valid_from<=p.payload.reference_date);if(owners.reduce((s,o)=>s+fractionUnits(o.fraction),0n)!==10000000000n)return error('23514');}data={input_token:'synthetic-epoch-'+state.epoch};}
  else if(name==='create_financial_preview'){const units=[...state.rows.values()].filter(r=>r.unit_number&&r.scope_id===p.scope).map(r=>r.id).sort();const id=randomUUID();state.previews.set(id,{epoch:state.epochs[p.scope]||0,result:{rows:units.map((unit_id,i)=>({unit_id,amount_cents:i<3?'12501':'12500',amount:i<3?'125.01':'125.00'}))}});data=id;}
  else if(name==='load_charge_batch_inputs_v2'){if(!state.roles.some(r=>r.who===who&&r.scope_id===p.scope&&!r.valid_to))return error('42501',403);data={inputs:inputs(p.payload)};}
  else if(name==='save_charge_batch_v2'){if('amount'in p.payload||'parties'in p.payload)return error('23514');const b=row(undefined,{scope_id:p.scope,claim:p.payload,revision:1,status:'draft'});state.batches.set(b.id,b);data=b.id;}
  else if(name==='review_charge_batch_v2'){if(p.acknowledged_parties.some(a=>a.ownership_regime!=='ordinary_fractional'||!state.owners.some(o=>o.person_id===a.person_id)))return error('23514');const b=state.batches.get(p.target);b.revision++;data=b.id;}
  else if(name==='publish_charge_batch_v2')return publish(p,who);
  else if(name==='charge_batch_feed')data={batches:[]};
  else if(name==='review_ownership'){state.epoch++;state.epochs[p.scope]=(state.epochs[p.scope]||0)+1;}
  else assert(['verify_scoped_person','verify_unit_share_set','save_financial_basis_evidence','save_financial_applicability','review_financial_basis'].includes(name),'Fake transport unsupported RPC '+name);
  return{status:data===null?204:200,code:null,data,id:typeof data==='string'?data:data?.version_id??null};
 }
 async function sql(name,text,args){
  if(text.startsWith('select public.')){const method=text.match(/public\.(\w+)\(/)[1],names=[...text.matchAll(/"(\w+)"=>/g)].map(m=>m[1]),params=Object.fromEntries(names.map((k,i)=>[k,args[i]]));
   if(name==='holder')state.holder=state.lastPid.holder;
   if(name==='contender'){state.waiting=state.lastPid.contender;await new Promise(resolve=>state.release=resolve);}
   const r=await rpc(name==='contender'&&method==='review_ownership'?'A':'B',method,params);if(r.code)throw Object.assign(Error('synthetic native refusal'),{code:r.code});return{rows:[{id:r.id}]};
  }
  if(text==='commit'||text==='rollback'){if(name==='holder'){state.release?.();state.release=null;state.holder=null;}return{rows:[]};}
  if(text==='select pg_backend_pid() pid')return{rows:[{pid:state.lastPid[name]}]};
  if(text==='select auth.uid()::text uid')return{rows:[{uid:config.actors[state.nativeWho[name]||'B'].auth_id}]};
  if(text.includes('set_config')){const c=JSON.parse(args[0]);state.nativeWho[name]=Object.keys(config.actors).find(k=>config.actors[k].auth_id===c.sub);return{rows:[]};}
  if(text.startsWith('begin')||text.startsWith('set local'))return{rows:[]};
  if(text.includes('from pg_locks'))return{rows:[{granted:true,mode:'ShareLock'}]};
  if(text.includes('from pg_stat_activity'))return{rows:state.waiting?[{pid:state.waiting,wait_event_type:'Lock',blockers:[state.holder]}]:[]};
  if(text.includes('supabase_migrations'))return{rows:config.expectedMigrations.map(version=>({version}))};
  if(text.includes('pg_proc'))return{rows:[...signatures].map(([proname,proargnames])=>({proname,proargnames}))};
  if(text.includes('md5(coalesce(jsonb_agg'))return{rows:[{ids:[],hash:'immutable-preexisting-synthetic-baseline'}]};
  if(text.includes('from public.profiles')){const a=Object.values(config.actors).find(a=>a.profile_id===args[0]);return{rows:[{id:a.profile_id,auth_user_id:a.auth_id}]};}
  if(text.includes('from auth.users'))return{rows:[{id:args[0],email_confirmed_at:'synthetic',deleted_at:null}]};
  if(text.includes('join public.organization_memberships'))return{rows:[{role_code:'org_admin',valid_to:null}]};
  if(text.includes('from public.organization_memberships'))return{rows:[{id:randomUUID()}]};
  if(text.includes('charge_publication_day'))return{rows:[{day:'2026-11-03'}]};
  if(text.includes('from public.unit_scope_periods'))return{rows:[{n:1}]};
  if(text.includes('from public.management_units'))return{rows:[args[0]===config.foreign_scope_id?{id:config.foreign_scope_id}:state.rows.get(args[0])].filter(Boolean)};
  if(text.includes('from public.unit_share_versions'))return{rows:[state.rows.get(args[0])]};
  if(text.includes('from public.user_roles'))return{rows:state.roles.filter(r=>text.includes('where profile_id=$1')?r.profile_id===args[0]&&r.scope_id===args[1]&&r.role_code===args[2]&&!r.valid_to:text.includes('valid_to is null')?r.scope_id===args[0]&&r.profile_id===args[1]&&!r.valid_to:r.id===args[1]||r.id===args[0])};
  if(text.includes('count(*)')&&text.includes('public.charges where scope_id'))return{rows:[{charges:state.charges.length,parties:state.parties.length,batches:[...state.batches.values()].filter(b=>b.status==='published').length}]};
  if(text.includes('where reverses_id='))return{rows:[...state.batches.values()].filter(b=>b.reverses_id===args[0])};
  if(text.includes('select count(*)::int n from public.obligation_parties'))return{rows:[{n:state.parties.filter(p=>state.charges.find(c=>c.id===p.charge_id)?.batch_id===args[0]).length}]};
  if(text.includes('from public.charge_batches where id='))return{rows:[state.batches.get(args[0])].filter(Boolean)};
  if(text.includes('from public.charges where batch_id'))return{rows:state.charges.filter(c=>c.batch_id===args[0]).sort((a,b)=>a.unit_id<b.unit_id?-1:1)};
  if(text.includes('from public.obligation_parties where charge_id'))return{rows:state.parties.filter(p=>p.charge_id===args[0]).sort((a,b)=>a.person_id<b.person_id?-1:1)};
  if(text.startsWith('delete from auth.sessions'))return{rows:[]};
  if(text.includes('private.charge_operations')){const a=Object.keys(config.actors).find(k=>config.actors[k].profile_id===args[0]);const r=state.receipts.get(a+':'+args[1]);return{rows:r?[{id:r.id}]:[]};}
  if(text.includes('from public.audit_events'))return{rows:[]};
  throw Error('Unimplemented fake SQL path: '+text.slice(0,95));
 }
 state.lastPid={};state.nativeWho={};
 const transport={project:config.project,invocation:randomUUID(),presence:async()=>({database:!state.missing,A:true,B:true,ca:true,publicClient:true}),
  async connect(name){state.lastPid[name]=++state.pid;return{query:(q,a=[])=>sql(name,q,a),end:async()=>state.closed.push(name)};},
  async login(who){return{claims:{role:'authenticated',sub:config.actors[who].auth_id,session_id:randomUUID()},user:{id:config.actors[who].auth_id},client:{auth:{getSession:async()=>({data:{session:{access_token:'synthetic-in-memory-only'}}}),getUser:async()=>({data:{user:{id:config.actors[who].auth_id}}}),stopAutoRefresh(){}}}};},
  async rpc(s,name,p){const who=Object.keys(config.actors).find(k=>config.actors[k].auth_id===s.user.id);const result=await rpc(who,name,p);if((state.crashAfterCommit&&name==='publish_charge_batch_v2'||state.crashAfterRevoke&&name==='revoke_staff_role'||state.crashAfterAssign&&name==='assign_staff_role')&&!result.code){state.crashAfterCommit=false;state.crashAfterRevoke=false;state.crashAfterAssign=false;throw Error('synthetic post-commit interruption');}return result;}
 };return{transport,state};
}
