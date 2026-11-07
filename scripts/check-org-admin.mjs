import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {orgAdminFixture,orgAdminMigration} from './helpers/org-admin-fixture.mjs';
import {orgAdminInput} from '../src/domain/org-admin.js';
const checks=[],receiptCases=[],out='.local/org-admin-lifecycle',receiptOnly=process.argv.includes('--receipt-only');let f;
const check=async(name,fn)=>{if(receiptOnly!==name.startsWith('post-receipt'))return;await fn();checks.push(name);console.log('PASS '+name);};
async function tx(fn){await f.db.exec('begin');try{await fn();}finally{await f.db.exec('rollback;reset role');}}
async function state(){return(await f.db.query(`select jsonb_build_object('roles',(select jsonb_agg(to_jsonb(x) order by id) from public.user_roles x),'members',(select jsonb_agg(to_jsonb(x) order by id) from public.organization_memberships x),'profiles',(select jsonb_agg(to_jsonb(x) order by id) from public.profiles x),'audit',(select jsonb_agg(to_jsonb(x) order by id) from public.audit_events x),'ops',(select jsonb_agg(to_jsonb(x) order by actor_id,request_key) from private.org_admin_operations x),'revisions',(select jsonb_agg(to_jsonb(x) order by organization_id) from private.org_admin_revisions x)) s`)).rows[0].s;}
async function denied(fn,code='42501',reason){const before=await state();await f.db.exec('savepoint rejected');try{await assert.rejects(fn,e=>e.code===code&&(!reason||e.message===reason));}finally{await f.db.exec('rollback to rejected;reset role');}assert.deepEqual(await state(),before);}
const grant=async(who='orgA',member='A',extra={})=>f.operation({who,key:randomUUID(),member:await f.member(member),revision:(await f.directory(who)).revision,...extra});
const end=async(who,role,extra={})=>f.operation({who,operation:'end',key:randomUUID(),role,revision:(await f.directory(who)).revision,...extra});
async function boundary(body){const d=(await f.db.query("select pg_get_functiondef('private.assign_staff_role(uuid,uuid,uuid,text,text[])'::regprocedure) d")).rows[0].d;
 const needle='perform pg_advisory_xact_lock(hashtextextended(org::text,0));';assert(d.includes(needle));
 await f.db.exec(`create sequence private.qa_org_boundary_hits;create function private.qa_org_boundary() returns void language plpgsql security definer set search_path='' as $$begin perform nextval('private.qa_org_boundary_hits');${body} end$$;revoke all on function private.qa_org_boundary() from public,anon,authenticated;`);
 await f.db.exec(d.replace(needle,needle+' perform private.qa_org_boundary();'));
}
try{
 f=await orgAdminFixture();const initialRole=await f.adminRole('orgA');
 const financialBefore=(await f.db.query("select jsonb_build_object('payments',(select jsonb_agg(to_jsonb(x)) from public.payments x),'movements',(select jsonb_agg(to_jsonb(x)) from public.money_movements x),'charges',(select jsonb_agg(to_jsonb(x)) from public.charges x),'parties',(select jsonb_agg(to_jsonb(x)) from public.obligation_parties x)) s")).rows[0].s;
 await check('domain exact target, explicit action/revision/reason/term and bounded note',async()=>{
  const p={org:f.org.A,key:randomUUID(),operation:'grant',member:await f.member('A'),revision:0,reason:'Synthetic review'};assert.equal(orgAdminInput(p).expected_revision,0);
  for(const bad of[{operation:''},{key:''},{revision:-1},{actor:f.profile.orgA},{reason:''},{reason:'x'.repeat(301)},{ends:'2026-12-01'},{operation:'handover'}])assert.throws(()=>orgAdminInput({...p,...bad}));
 });
 await check('current org-admin only, foreign scope/platform/staff/owner/pending/anonymous refusal and no direct DML',async()=>tx(async()=>{
  for(const who of['A','orgB','platform','owner','pending','anon'])await denied(()=>f.directory(who));
  await denied(()=>f.directory('orgA',f.org.B));
  await denied(()=>f.as('orgA',"update public.user_roles set valid_to=clock_timestamp() where id=$1",[initialRole]));
  await denied(()=>f.as('orgA','select * from private.org_admin_operations'));
  await denied(()=>f.as('orgA','select private.assert_org_admin_continuity($1)',[f.org.A]));
 }));
 await check('grant exact active member; only manage_members; no operational rights transferred',async()=>tx(async()=>{
  const before=(await f.db.query("select to_jsonb(r) s from public.user_roles r where r.profile_id=$1 and role_code='manager'",[f.profile.A])).rows[0].s;
  const result=await grant();const row=(await f.db.query('select * from public.user_roles where id=$1',[result.new_role_id])).rows[0];
  assert.equal(row.profile_id,f.profile.A);assert.equal(row.scope_id,null);assert.deepEqual(row.permissions,['manage_members']);assert(result.revision>0);
  assert.deepEqual((await f.db.query("select to_jsonb(r) s from public.user_roles r where r.profile_id=$1 and role_code='manager'",[f.profile.A])).rows[0].s,before);
  const data=await f.directory('A');assert(data.members.length&&data.history.length===1);assert.equal(data.history[0].change.to_label,'Synthetic A');assert.equal(data.history[0].change.actor_label,'Synthetic orgA');assert(!JSON.stringify(data).includes(f.auth.A));
 }));
 await check('spoofed foreign membership/role, self grant, unknown operation, missing reason and stale revision roll back',async()=>tx(async()=>{
  const foreign=(await f.db.query('select id from public.organization_memberships where organization_id=$1 limit 1',[f.org.B])).rows[0].id;
  for(const args of[{member:foreign},{member:await f.member('orgA')}])await denied(()=>grant('orgA','A',args));
  await denied(()=>grant('orgA','A',{operation:'unknown'}),'22023');await denied(()=>grant('orgA','A',{reason:''}),'22023');
  await denied(()=>grant('orgA','A',{revision:42}),'PT409','org_admin_stale');
  const foreignRole=(await f.db.query("select id from public.user_roles where profile_id=$1 and role_code='org_admin'",[f.profile.orgB])).rows[0].id;
  await denied(()=>end('orgA',foreignRole));
 }));
 await check('last administrator end refused; failed finite handover leaves no new grant/audit/receipt',async()=>tx(async()=>{
  await denied(()=>end('orgA',initialRole),'PT409','org_admin_last_required');
  await denied(()=>grant('orgA','A',{operation:'handover',role:initialRole,ends:new Date(Date.now()+60000).toISOString()}),'PT409','org_admin_permanent_required');
 }));
 await check('atomic self handover and restored authority use new grant; original interval remains ended',async()=>tx(async()=>{
  const result=await grant('orgA','A',{operation:'handover',role:initialRole});assert.equal(result.ended_role_id,initialRole);assert(result.new_role_id);
  await denied(()=>f.directory('orgA'));
  const restored=await grant('A','orgA');assert.notEqual(restored.new_role_id,initialRole);assert.equal((await f.db.query('select valid_to is not null ended from public.user_roles where id=$1',[initialRole])).rows[0].ended,true);
  assert.equal((await f.directory()).history.length,2);
 }));
 await check('replay identical once; changed request and separate duplicate conflict; revoke denies same-session old receipt',async()=>tx(async()=>{
  const args={key:randomUUID(),member:await f.member('A'),revision:(await f.directory()).revision};const r=await f.operation(args),s=await state();assert.deepEqual(await f.operation(args),r);assert.deepEqual(await state(),s);
  await denied(()=>f.operation({...args,reason:'Changed'}),'PT409','org_admin_request_mismatch');
  await denied(()=>grant(),'PT409','org_admin_already_active');
  await end('A',initialRole);await denied(()=>f.operation(args));await denied(()=>f.directory());
 }));
 await check('finite grant requires permanent other admin; real expiry is separate from explicit end',async()=>tx(async()=>{
  const a=await grant();await end('A',initialRole);
  const r=await grant('A','orgA',{ends:new Date(Date.now()+180).toISOString()});await new Promise(resolve=>setTimeout(resolve,230));
  await denied(()=>f.directory());assert.equal((await f.db.query('select valid_to is not null ended from public.user_roles where id=$1',[r.new_role_id])).rows[0].ended,true);assert((await f.directory('A')).grants.find(g=>g.id===a.new_role_id).current);
 }));
 await check('stale concurrent intents cannot both remove remaining admins; exact global revision is rechecked',async()=>tx(async()=>{
  const a=await grant(),revision=(await f.directory()).revision;await end('orgA',a.new_role_id,{revision});
  await denied(()=>end('orgA',initialRole,{revision}),'PT409','org_admin_stale');
  await denied(()=>end('orgA',initialRole),'PT409','org_admin_last_required');
 }));
 await check('deferred invariant covers membership shortening/inactivation and profile disable/Auth unlink; allowed with another permanent admin',async()=>tx(async()=>{
  const member=await f.member('orgA');
  const mutations=[['update public.organization_memberships set status=\'inactive\' where id=$1',member],['update public.organization_memberships set valid_to=clock_timestamp()+interval \'1 day\' where id=$1',member],["update public.profiles set status='disabled' where id=$1",f.profile.orgA],['update public.profiles set auth_user_id=null where id=$1',f.profile.orgA]];
  for(const[sql,id]of mutations)await denied(async()=>{await f.db.query(sql,[id]);await f.db.exec('set constraints org_admin_continuity immediate');},'PT409');
  await grant();await f.db.query("update public.organization_memberships set status='inactive' where id=$1",[member]);await f.db.exec('set constraints org_admin_continuity immediate');assert(await f.directory('A'));
 }));
 await check('inactive/unconfirmed/expired recipient rejected; historical grants cannot be deleted or reopened',async()=>tx(async()=>{
  await f.db.query("update public.profiles set status='disabled' where id=$1",[f.profile.A]);await denied(()=>grant());await f.db.query("update public.profiles set status='active' where id=$1",[f.profile.A]);
  await f.db.query('update auth.users set email_confirmed_at=null where id=$1',[f.auth.A]);await denied(()=>grant());await f.db.query('update auth.users set email_confirmed_at=clock_timestamp() where id=$1',[f.auth.A]);
  await f.db.query("update public.organization_memberships set valid_to=clock_timestamp()+interval '0.03 second' where id=$1",[await f.member('A')]);await new Promise(resolve=>setTimeout(resolve,50));await denied(()=>grant());await f.db.query('update public.organization_memberships set valid_to=null where id=$1',[await f.member('A')]);
  const r=await grant();await end('orgA',r.new_role_id);
  await denied(()=>f.db.query('update public.user_roles set valid_to=null where id=$1',[r.new_role_id]),'23514','org_admin_history_immutable');
  await denied(()=>f.db.query('delete from public.user_roles where id=$1',[initialRole]),'23514','org_admin_history_immutable');
 }));
 await check('intentional self-end does not excuse a missing member/profile; forced local failure rolls back grant and end',async()=>tx(async()=>{
  await f.db.exec(`create function private.qa_org_disable_after_end() returns trigger language plpgsql security definer set search_path='' as $$begin if old.id='${initialRole}' then update public.profiles set status='disabled' where id=old.profile_id;end if;return new;end$$;create trigger qa_org_disable_after_end after update on public.user_roles for each row execute function private.qa_org_disable_after_end();`);
  await denied(()=>grant('orgA','A',{operation:'handover',role:initialRole}));
 }));
 await check('controlled post-lock revoke boundary uses guarded lifecycle; original staff assignment rolls back',async()=>tx(async()=>{
  await grant();const revision=(await f.directory()).revision;
  await boundary(`perform set_config('request.jwt.claim.sub','${f.auth.A}',true);perform public.org_admin_operation('${f.org.A}','${randomUUID()}','end','${initialRole}',null,${revision},null,'Synthetic revoke at local boundary');perform set_config('request.jwt.claim.sub','${f.auth.orgA}',true);`);
  await denied(()=>f.as('orgA',"select public.assign_staff_role($1,$2,$3,'controller',array['read_registry'])",[f.org.A,f.auth.doc,f.scope.A]));
  assert((await f.db.query('select is_called from private.qa_org_boundary_hits')).rows[0].is_called);
 }));
 await check('controlled post-lock real expiry refusal and preserved-authority positive control are distinct',async()=>tx(async()=>{
  await grant();await end('A',initialRole);await grant('A','orgA',{ends:new Date(Date.now()+180).toISOString()});await boundary('perform pg_sleep(0.22);');
  await denied(()=>f.as('orgA',"select public.assign_staff_role($1,$2,$3,'controller',array['read_registry'])",[f.org.A,f.auth.doc,f.scope.A]));assert((await f.db.query('select is_called from private.qa_org_boundary_hits')).rows[0].is_called);
  assert((await f.as('A',"select public.assign_staff_role($1,$2,$3,'controller',array['read_registry']) id",[f.org.A,f.auth.doc,f.scope.A])).rows[0].id);
 }));
 await check('helpers have closed grants/search_path/volatility and unchanged exact financial history',async()=>{
  const rows=(await f.db.query("select p.proname,p.provolatile,p.proconfig,has_function_privilege('authenticated',p.oid,'execute') allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and(p.proname like '%org_admin%' or p.proname='lock_org_admin')")).rows;
  for(const r of rows.filter(r=>!['is_org_admin','org_admin_profile','current_write_org_admin'].includes(r.proname))){assert.equal(r.provolatile,'v');assert(r.proconfig.includes('search_path=""'));assert.equal(r.allowed,['org_admin_directory','org_admin_operation'].includes(r.proname));}
  assert.deepEqual((await f.db.query("select jsonb_build_object('payments',(select jsonb_agg(to_jsonb(x)) from public.payments x),'movements',(select jsonb_agg(to_jsonb(x)) from public.money_movements x),'charges',(select jsonb_agg(to_jsonb(x)) from public.charges x),'parties',(select jsonb_agg(to_jsonb(x)) from public.obligation_parties x)) s")).rows[0].s,financialBefore);
 });
 await check('fixed-snapshot isolation explicitly rejected; no attempted native/MVCC claim',async()=>{
  await f.db.exec('begin isolation level repeatable read');try{await assert.rejects(()=>f.directory(),e=>e.code==='42501'&&e.message==='current_write_isolation_unsupported');}finally{await f.db.exec('rollback;reset role');}
 });
 await check('existing guarded onboarding still creates organization/member/first admin atomically under final-state triggers',async()=>tx(async()=>{
  const request=(await f.as('pending',"insert into public.access_requests(request_kind,requester_profile_id,request_payload) values('organization_onboarding',$1,$2) returning id",[f.profile.pending,{name:'Synthetic lifecycle onboarding',organization_kind:'self_managed'}])).rows[0].id;
  const org=(await f.as('platform',"select public.activate_organization($1,1,'Synthetic reviewed onboarding') id",[request])).rows[0].id;
  await f.db.exec('set constraints org_admin_continuity immediate');const directory=await f.directory('pending',org);assert.equal(directory.grants.filter(g=>g.current).length,1);assert(directory.revision>0);
 }));
 await check('post-receipt caller/recipient refusals and preserved-authority control reach the actual final guards',async()=>{
  for(const mode of['caller','recipient','allowed'])await tx(async()=>{
   const target=mode==='caller'?f.profile.orgA:f.profile.A;
   await f.db.exec(`create sequence private.qa_post_receipt_hits;create function private.qa_post_receipt() returns trigger language plpgsql security definer set search_path='' as $$begin perform nextval('private.qa_post_receipt_hits');${mode==='allowed'?'':`update public.profiles set status='disabled' where id='${target}';`}return new;end$$;revoke all on function private.qa_post_receipt() from public,anon,authenticated;create trigger qa_post_receipt after insert on private.org_admin_operations for each row execute function private.qa_post_receipt();`);
   if(mode==='allowed'){const result=await grant();assert(result.new_role_id);assert.equal((await f.directory()).history.length,1);assert.equal((await f.db.query('select count(*)::int n from private.org_admin_operations')).rows[0].n,1);}
   else await denied(()=>grant(),'42501','Forbidden');
   assert((await f.db.query('select is_called from private.qa_post_receipt_hits')).rows[0].is_called,'The receipt boundary must be reached, not an entry denial');
   receiptCases.push({case:mode,postReceiptBoundary:true,result:mode==='allowed'?'success':'42501 Forbidden',stateInvariant:mode==='allowed'?'one grant/audit/receipt':'no partial grant/profile/revision/audit/receipt'});console.log('PASS post-receipt '+mode);
  });
 });
 await mkdir(out,{recursive:true});await writeFile(out+(receiptOnly?'/post-receipt.json':'/db.json'),JSON.stringify({pass:true,at:new Date().toISOString(),migration:orgAdminMigration,hash:createHash('sha256').update((await readFile('supabase/migrations/'+orgAdminMigration,'utf8')).replaceAll('\r\n','\n')).digest('hex'),local:true,hosted:false,mvcc:false,checks,receiptCases,controlledBoundary:'single disposable PGlite session, not independent committed native sessions',cleanup:'disposable database closed'},null,2));
}catch(e){await mkdir(out,{recursive:true});await writeFile(out+'/failure.json',JSON.stringify({checks,code:e.code,message:e.message},null,2));console.error(e);process.exitCode=1;}finally{await f?.db.close();}
