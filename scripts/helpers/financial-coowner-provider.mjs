// Concrete PostgreSQL/Supabase adapter. Transport is injected; importing never reads env or opens a connection.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {targetProject,assertIsolatedRun} from './financial-coowner-run.mjs';
import {candidate} from '../plan-financial-coowner-hosted.mjs';
import {bindFinancialCoownerCases} from './financial-coowner-provider-cases.mjs';
const tables=['profiles','access_requests','organization_memberships','user_roles','management_assignments','management_units','buildings','units','unit_scope_periods','persons','ownership_periods','ownership_set_reviews','resolutions','allocation_rule_versions','unit_share_bases','unit_share_versions','unit_share_verifications','financial_previews','charge_batches','charges','obligation_parties','audit_events','scope_setup_requests'];
export const requiredRpc=['request_scope_setup','complete_scope_setup','create_unit','assign_staff_role','revoke_staff_role','save_scoped_person','verify_scoped_person','apply_ownership_changes','review_ownership','save_unit_share_set','verify_unit_share_set','save_financial_resolution','save_financial_basis_evidence','save_financial_applicability','review_financial_basis','save_financial_rule','activate_financial_rule','load_financial_preview_inputs','create_financial_preview','load_charge_batch_inputs_v2','save_charge_batch_v2','review_charge_batch_v2','publish_charge_batch_v2','charge_batch_feed_v2'];
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function createProvider(config,t){
 assert.equal(config.project,targetProject);assert(config.org_id&&config.actors?.A?.auth_id&&config.actors?.B?.auth_id,'Reviewed non-demo org and exact synthetic actors required');
 let db,context;const clients={};const one=async(sql,args=[])=>(await query(sql,args)).rows[0];
 const query=async(sql,args=[])=>{db??=await t.connect('controller');return db.query(sql,args);};
 const adapter={
  async preflight(j){
   assertIsolatedRun(j);assert(!j.protection.resourceIds.includes(config.org_id),'Demo organization cannot be a QA target');
   assert.equal(createHash('sha256').update((await readFile(candidate.file,'utf8')).replace(/\r\n/g,'\n').trim()).digest('hex'),candidate.lfTrimSHA256,'Local candidate hash changed');
   const presence=await t.presence();for(const key of ['database','A','B','publicClient','ca'])assert.equal(presence[key],true,'Missing credential/configuration: '+key);
   assert.equal(t.project,targetProject,'Transport target mismatch');
   const versions=(await query('select version from supabase_migrations.schema_migrations order by version')).rows.map(r=>r.version);
   assert.deepEqual(versions,[...config.expectedMigrations].sort(),'Exact expected migration history required');assert(versions.includes(candidate.version),'B2 migration must already be applied separately');
   const signatures=(await query("select p.proname,p.proargnames from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1::text[])",[requiredRpc])).rows;
   for(const name of requiredRpc)assert(signatures.some(r=>r.proname===name),'Missing schema/RPC: '+name);
   for(const [who,a]of Object.entries(config.actors)){
    const p=await one('select id,auth_user_id from public.profiles where id=$1',[a.profile_id]);assert(p&&p.auth_user_id===a.auth_id,'Synthetic identity mismatch: '+who);
    const u=await one('select id,email_confirmed_at,deleted_at from auth.users where id=$1',[a.auth_id]);assert(u?.email_confirmed_at&&!u.deleted_at,'Confirmed existing synthetic Auth account required');
   }
   const roles=(await query("select r.role_code,r.valid_to from public.user_roles r join public.organization_memberships m on m.id=r.membership_id where m.organization_id=$1 and m.profile_id=$2 and m.status='active'",[config.org_id,config.actors.A.profile_id])).rows;
   assert(roles.some(r=>r.role_code==='org_admin'&&!r.valid_to),'Setup actor needs existing explicit org_admin in the NON-DEMO organization; do not grant it automatically');
   const member=await one("select id from public.organization_memberships where organization_id=$1 and profile_id=$2 and status='active'",[config.org_id,config.actors.B.profile_id]);assert(member,'Existing B membership in non-demo org must already be active; do not restore other memberships');
   assert(config.foreign_scope_id&&!j.protection.resourceIds.includes(config.foreign_scope_id),'Reviewed non-demo foreign scope required');
   const foreign=await one("select id from public.management_units where id=$1 and status='active'",[config.foreign_scope_id]);assert(foreign,'Foreign scope must actually exist; missing configuration is not access-denial evidence');
   const today=(await one("select private.charge_publication_day()::text day")).day;
   return{project:targetProject,schemaReady:true,isolationVerified:true,versions,signatures,day:today,transport:'pinned TLS/ordinary sessions; no migrations applied by driver'};
  },
  async baseline(j){
   const prior=j.baseline?.snapshot?.publishA?.tables,rows={};
   for(const table of tables){const ids=prior?.[table]?.ids;rows[table]=await one(`select coalesce(jsonb_agg(id order by id),'[]') ids,md5(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]')::text) hash from public.${table} t ${ids?'where id=any($1::uuid[])':''}`,ids?[ids]:[]);}
   return{publishA:{tables:rows},protectedDemo:{ids:j.protection.resourceIds,hash:sha(rows)},personal:{profiles:rows.profiles,requests:rows.access_requests},existingAssignments:{roles:rows.user_roles,assignments:rows.management_assignments,memberships:rows.organization_memberships}};
  },
  async authorize(j,op){
   assertIsolatedRun(j);assert.equal(op.args.marker,j.marker,'Foreign marker');
   if(op.name==='login'){assert(config.actors[op.args.actor]);return;}
   if(op.name==='cleanup-owned'){assert(j.temporary.some(r=>r.id===op.args.id&&r.marker===j.marker),'Foreign cleanup target');return;}
   if(op.name==='capture-generated'){assert(j.resources.some(r=>r.id===op.args.scope_id&&r.kind==='scope'),'Generated resources need own scope receipt');return;}
   if(op.name==='native-race'){assert(j.resources.some(r=>r.id===op.args.scope_id&&r.kind==='scope'),'Native race outside own scope');assert(['publish-publish','publish-input','unpaid-correction'].includes(op.args.race));return;}
   assert(op.name==='rpc'&&requiredRpc.includes(op.args.rpc),'RPC allowlist refusal');assert(config.actors[op.args.actor]);
   const p=op.args.params;
   if(p.org)assert.equal(p.org,config.org_id);
   if(p.request_id)assert(j.resources.some(r=>r.id===p.request_id&&r.kind==='setup-request'),'Foreign setup request');
   if(p.scope)assert(j.resources.some(r=>r.id===p.scope&&r.kind==='scope'),'Mutation outside own receipted scope');
   if(p.role_id)assert(j.temporary.some(r=>r.id===p.role_id&&r.kind==='role'),'Foreign role revoke');
   if(p.target_auth_user_id)assert(Object.values(config.actors).some(a=>a.auth_id===p.target_auth_user_id));
  },
  async write(j,op){
   const a=op.args;
   if(op.name==='login'){
    const s=await t.login(a.actor);assert.equal(s.user.id,config.actors[a.actor].auth_id);assert.equal((await s.client.auth.getUser()).data.user.id,s.user.id);clients[a.actor]=s;
    return{id:s.claims.session_id,actor:a.actor,status:200};
   }
   if(op.name==='capture-generated'){
    const row=await one("select r.id from public.user_roles r where r.scope_id=$1 and r.id=$2",[a.scope_id,a.id]);assert(row,'Generated role missing');return{id:row.id,status:200};
   }
   if(op.name==='cleanup-owned'){
    const item=j.temporary.find(r=>r.id===a.id);assert(item,'No own receipt');
    if(item.kind==='session'){
     const owner=config.actors[item.actor].auth_id;await query('delete from auth.sessions where id=$1 and user_id=$2',[item.id,owner]);return{id:item.id,status:204};
    }
    assert.equal(item.kind,'role','Unsupported cleanup kind refuses rather than updating directly');
    return{...(await call('A','revoke_staff_role',{role_id:item.id})),id:item.id};
   }
   if(op.name==='native-race')return adapter.executeRace(j,op);
   return call(a.actor,a.rpc,a.params);
  },
  async register(j,op,r){
   assert(r.status>=200&&r.status<500,'Unknown transport result must remain pending');
   if(r.code)return;
   const push=(kind,id,temporary=false,extra={})=>{if(!id)return;const list=temporary?j.temporary:j.resources;if(!list.some(x=>x.id===id))list.push({kind,id,marker:j.marker,createdByRun:j.run,createdOperation:op.id,...extra});};
   if(op.name==='login')push('session',r.id,true,{actor:r.actor});
   if(op.name==='capture-generated')push('role',r.id,true,{scope_id:op.args.scope_id});
   if(op.name==='cleanup-owned'){const item=j.temporary.find(x=>x.id===op.args.id);if(item)item.closed=true;}
   if(op.name==='rpc'){
    const p=op.args.params,name=op.args.rpc;
    const kind={request_scope_setup:'setup-request',complete_scope_setup:'scope',create_unit:'unit',save_scoped_person:'person',save_financial_resolution:'basis',activate_financial_rule:'active',create_financial_preview:'preview',save_charge_batch_v2:'batch',assign_staff_role:'role'}[name];
    if(kind)push(kind,r.id,kind==='role',{scope_id:p.scope??null});
    if(name==='revoke_staff_role'){const item=j.temporary.find(x=>x.id===p.role_id);if(item)item.closed=true;}
   }
  },
  async inspect(j,op){
   const a=op.args,p=a.params||{};let r;
   const yes=result=>({state:'committed',result,evidence:'Authoritative exact ID/marker or actor/request-key receipt SELECT'});
   if(op.name==='capture-generated'){
    assert(j.resources.some(x=>x.kind==='scope'&&x.id===a.scope_id),'Generated resource inspection needs own scope receipt');r=await one('select id from public.user_roles where id=$1 and scope_id=$2',[a.id,a.scope_id]);if(r)return yes({id:r.id,status:200});
   }
   if(op.name==='native-race'&&op.completedNative){r=await one("select id from public.charge_batches where id=$1 and scope_id=$2 and status='published'",[a.a,a.scope_id]);if(r)return yes(op.completedNative);}
   if(op.name==='rpc'&&['save_charge_batch_v2','review_charge_batch_v2','publish_charge_batch_v2'].includes(a.rpc)){
    r=await one('select result_id id from private.charge_operations where actor_id=$1 and request_key=$2',[config.actors[a.actor].profile_id,p.request_key]);if(r)return yes({id:r.id,data:r.id,status:200});
   }
   if(op.name==='rpc'&&a.rpc==='request_scope_setup'){r=await one('select id from public.scope_setup_requests where organization_id=$1 and label=$2',[p.org,p.label]);if(r)return yes({id:r.id,data:r.id,status:200});}
   if(op.name==='rpc'&&a.rpc==='create_unit'){r=await one('select u.id from public.units u join public.unit_scope_periods s on s.unit_id=u.id where s.scope_id=$1 and u.unit_number=$2',[p.scope,p.unit_number]);if(r)return yes({id:r.id,data:r.id,status:200});}
   if(op.name==='rpc'&&a.rpc==='save_scoped_person'&&!p.target){r=await one('select id from public.persons where scope_id=$1 and source_reference=$2',[p.scope,p.source_reference]);if(r)return yes({id:r.id,data:r.id,status:200});}
   if(op.name==='rpc'&&a.rpc==='complete_scope_setup'){r=await one("select scope_id id from public.scope_setup_requests where id=$1 and status='fulfilled'",[p.request_id]);if(r?.id)return yes({id:r.id,data:r.id,status:200});}
   if(op.name==='rpc'&&a.rpc==='apply_ownership_changes'){r=await one('select result_ids from private.ownership_batches where scope_id=$1 and request_key=$2 and actor_id=$3',[p.scope,p.request_key,config.actors[a.actor].profile_id]);if(r)return yes({id:null,data:r.result_ids,status:200});}
   if(op.name==='rpc'&&a.rpc==='save_unit_share_set'){r=await one('select id,basis_id,revision from public.unit_share_versions where recorded_by=$1 and request_key=$2',[config.actors[a.actor].profile_id,p.request_key]);if(r)return yes({id:r.id,data:{basis_id:r.basis_id,version_id:r.id,revision:r.revision},status:200});}
   if(op.name==='rpc'&&a.rpc==='review_ownership'){
    r=p.target?await one("select id from public.ownership_periods where id=$1 and scope_id=$2 and verification_note=$3 and verification_status='verified'",[p.target,p.scope,p.note]):await one('select id from public.ownership_set_reviews where scope_id=$1 and unit_id=$2 and as_of=$3 and note=$4',[p.scope,p.unit,p.as_of,p.note]);if(r)return yes({id:null,data:null,status:204});
   }
   if(op.name==='rpc'&&p.note){r=await one('select target_id id from public.audit_events where actor_profile_id=$1 and reason=$2 and scope_id=$3 order by happened_at desc,id desc limit 1',[config.actors[a.actor].profile_id,p.note,p.scope]);if(r?.id)return yes({id:r.id,data:r.id,status:200});}
   if(op.name==='rpc'&&a.rpc==='assign_staff_role'){r=await one('select id,permissions from public.user_roles where profile_id=$1 and scope_id=$2 and role_code=$3 and valid_to is null',[config.actors[Object.keys(config.actors).find(k=>config.actors[k].auth_id===p.target_auth_user_id)].profile_id,p.scope,p.role]);if(r&&JSON.stringify(r.permissions)===JSON.stringify(p.permissions))return yes({id:r.id,data:r.id,status:200});}
   if(op.name==='rpc'&&a.rpc==='revoke_staff_role'){
    assert(j.temporary.some(x=>x.kind==='role'&&x.id===p.role_id),'Foreign revocation inspection refused');
    r=await one('select valid_to from public.user_roles where id=$1',[p.role_id]);if(r?.valid_to)return yes({id:null,data:null,status:204});
   }
   if(op.name==='cleanup-owned'){
    const item=j.temporary.find(x=>x.id===a.id);assert(item);
    r=item.kind==='role'?await one('select valid_to from public.user_roles where id=$1',[item.id]):await one('select id from auth.sessions where id=$1',[item.id]);
    if(item.kind==='role'?r?.valid_to:!r)return yes({id:item.id,status:204});
   }
   // Absence is not proof of rollback: an HTTP backend might still be running. Never auto-replay such setup.
   return{state:'unknown',evidence:'No conclusive exact receipt yet; inspect server state before retry; no mutations dispatched'};
  },
  async close(){for(const s of Object.values(clients))s.client.auth.stopAutoRefresh();if(db){await db.query('rollback').catch(()=>{});await db.end();db=null;}},
 };
 async function call(who,name,params){assert(clients[who],'Ordinary session not initialized');const session=(await clients[who].client.auth.getSession()).data.session;assert(session?.access_token);const jwt_fingerprint=sha(session.access_token);return{...await t.rpc(clients[who],name,params),jwt_fingerprint};}
 async function auth(ctx,who){context=ctx;if(clients[who])return clients[who];const key='session:'+t.invocation+':'+who;await ctx.write(key,'login',{actor:who,marker:ctx.j.marker});return clients[who];}
 const tools={query,one,call,auth,config,t,clients,adapter};bindFinancialCoownerCases(adapter,tools);return adapter;
}
