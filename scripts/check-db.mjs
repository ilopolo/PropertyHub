import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

process.on('uncaughtException', error => { console.error(`FAILED: ${error.code || ''} ${error.message}`); process.exit(1); });

// Disposable real PostgreSQL engine. Auth/claims below are fixtures, NOT live GoTrue sessions.
const db = new PGlite({ extensions: { btree_gist } });
await db.exec(`create role anon; create role authenticated; create role service_role;
 create schema auth; create schema extensions;
 create table auth.users(id uuid primary key, email_confirmed_at timestamptz, is_anonymous boolean not null default false, raw_app_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;
 grant execute on function auth.uid() to authenticated,anon;
 -- Emulate hosted default ACLs to catch accidental inherited access.
 alter default privileges in schema public grant all on tables to anon,authenticated;
 alter default privileges in schema public grant all on sequences to anon,authenticated;
 alter default privileges in schema public grant execute on functions to anon,authenticated;`);
for (const file of (await readdir('supabase/migrations')).filter(x => x.endsWith('.sql')).sort()) {
  await db.exec(`begin; ${await readFile(`supabase/migrations/${file}`, 'utf8')} commit;`);
  console.log(`APPLIED LOCAL: ${file}`);
}
let checks = 0;
const ids = Object.fromEntries(['platform','orgA','orgB','managerA','managerB','pending','unconfirmed'].map((name,i)=>[name,`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
for (const [name,id] of Object.entries(ids)) await db.query('insert into auth.users(id,email_confirmed_at) values($1,$2)',[id,name==='unconfirmed'?null:new Date()]);
async function as(name,sql,params=[]) {
  await db.exec(`set role ${name==='anon'?'anon':'authenticated'}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[name]||'']);
  try { return await db.query(sql,params); } finally { await db.exec('reset role'); }
}
async function ok(name,fn) { await fn(); checks++; console.log(`PASS: ${name}`); }
async function denied(fn) { await assert.rejects(fn, e=>['42501','23514','23505','23P01','23503'].includes(e.code)); }
const profile={};
for (const name of Object.keys(ids).filter(x=>x!=='unconfirmed')) profile[name]=(await as(name,'select public.ensure_profile($1) id',[name])).rows[0].id;
await ok('pending profile is separate from Auth UUID, no role',async()=>{
 assert.notEqual(profile.pending,ids.pending);
 assert.equal((await as('pending','select status from public.profiles')).rows[0].status,'pending');
 assert.equal((await as('pending','select * from public.user_roles')).rows.length,0);
 assert.equal((await as('pending','select * from public.organizations')).rows.length,0);
});
await ok('unconfirmed account cannot create profile',()=>denied(()=>as('unconfirmed','select public.ensure_profile()')));
await ok('anon cannot create profile/read registry/bootstrap',async()=>{
 await denied(()=>as('anon','select * from public.profiles'));
 await denied(()=>as('anon','select public.ensure_profile()'));
 await denied(()=>as('anon','select private.bootstrap_platform_admin($1)',[ids.platform]));
});
await ok('pending cannot elevate status/auth link or insert role',async()=>{
 await denied(()=>as('pending',"update public.profiles set status='active' where id=$1",[profile.pending]));
 await denied(()=>as('pending','update public.profiles set auth_user_id=$1 where id=$2',[ids.orgA,profile.pending]));
 await denied(()=>as('pending',"insert into public.user_roles(profile_id,role_code,permissions) values($1,'platform_admin',array['manage_platform'])",[profile.pending]));
 assert.equal((await db.query('select count(*)::int n from public.user_roles')).rows[0].n,0);
});
await ok('own preferences update, foreign profile invisible',async()=>{
 await as('pending',"update public.profiles set theme='dark' where id=$1",[profile.pending]);
 assert.equal((await as('pending','select theme from public.profiles')).rows[0].theme,'dark');
 assert.equal((await as('pending','select * from public.profiles where id=$1',[profile.orgA])).rows.length,0);
});
await ok('operator bootstrap exact confirmed UUID, idempotent and one target',async()=>{
 await denied(()=>db.query('select private.bootstrap_platform_admin($1)',[ids.unconfirmed]));
 const a=(await db.query('select private.bootstrap_platform_admin($1) id',[ids.platform])).rows[0].id;
 assert.equal(a,profile.platform);
 assert.equal((await db.query('select private.bootstrap_platform_admin($1) id',[ids.platform])).rows[0].id,a);
 await denied(()=>db.query('select private.bootstrap_platform_admin($1)',[ids.orgA]));
 assert.equal((await db.query("select count(*)::int n from public.audit_events where action='bootstrap_platform_admin'")).rows[0].n,1);
 await denied(()=>as('platform','select private.bootstrap_platform_admin($1)',[ids.platform]));
});
const org={},scope={},role={},unit={};
for (const suffix of ['A','B']) {
 const request=(await as(`org${suffix}`,`insert into public.access_requests(request_kind,requester_profile_id,request_payload) values('organization_onboarding',$1,$2) returning id`,[profile[`org${suffix}`],{name:`Synthetic ${suffix}`,organization_kind:'self_managed'}])).rows[0].id;
 await denied(()=>as(`org${suffix}`,"select public.activate_organization($1,1,'Synthetic review')",[request]));
 org[suffix]=(await as('platform','select public.activate_organization($1,1,$2) id',[request,'Synthetic representation checked'])).rows[0].id;
 assert.equal((await as('platform','select public.activate_organization($1,1,$2) id',[request,'Synthetic representation checked'])).rows[0].id,org[suffix]);
 await denied(()=>as(`org${suffix}`,'select public.create_management_context($1,$2,$3)',[org[suffix],'forbidden','forbidden']));
 const setup=(await as(`org${suffix}`,'select public.request_scope_setup($1,$2,$3) id',[org[suffix],ids[`manager${suffix}`],`Context ${suffix}`])).rows[0].id;
 await denied(()=>as(`org${suffix}`,"select public.complete_scope_setup($1,'forbidden',null,'declaration','Synthetic declaration',current_date)",[setup]));
 scope[suffix]=(await as(`manager${suffix}`,"select public.complete_scope_setup($1,$2,null,'declaration','Synthetic declaration',current_date) id",[setup,`Synthetic address ${suffix}`])).rows[0].id;
 assert.equal((await as(`manager${suffix}`,"select public.complete_scope_setup($1,$2,null,'declaration','Synthetic declaration',current_date) id",[setup,`Synthetic address ${suffix}`])).rows[0].id,scope[suffix]);
 await denied(()=>as(`manager${suffix}`,"select public.complete_scope_setup($1,'changed',null,'declaration','Synthetic declaration',current_date)",[setup]));
 role[suffix]=(await as(`manager${suffix}`,"select id from public.user_roles where role_code='manager'")).rows[0].id;
 unit[suffix]=(await as(`manager${suffix}`,"select public.create_unit($1,$2,$3,source_kind=>'declaration',source_reference=>'Synthetic declaration',known_from=>current_date) id",[scope[suffix],'03','apartment'])).rows[0].id;
}
await ok('two orgs and units actually persisted',async()=>{
 assert.equal((await db.query('select count(*)::int n from public.organizations')).rows[0].n,2);
 assert.equal((await db.query('select count(*)::int n from public.units')).rows[0].n,2);
 assert.equal((await db.query('select count(*)::int n from public.unit_scope_periods')).rows[0].n,2);
});
await ok('explicit initial appointment: wrong recipient, expiry, issuer revocation and cancellation',async()=>{
 const setup=(await as('orgA','select public.request_scope_setup($1,$2,$3) id',[org.A,ids.managerA,'Pending setup'])).rows[0].id;
 const complete=who=>as(who,"select public.complete_scope_setup($1,'Synthetic address',null,'declaration','Synthetic source',current_date)",[setup]);
 await denied(()=>complete('managerB'));
 await denied(()=>complete('orgA'));
 await db.query("update public.profiles set status='disabled' where id=$1",[profile.orgA]);
 await denied(()=>complete('managerA'));
 await denied(()=>as('orgA','select public.revoke_scope_setup($1,1)',[setup]));
 await db.query("update public.profiles set status='active' where id=$1",[profile.orgA]);
 await db.query("update public.scope_setup_requests set expires_at=now()-interval '1 second' where id=$1",[setup]);
 await denied(()=>complete('managerA'));
 await as('orgA','select public.revoke_scope_setup($1,1)',[setup]);
 assert.equal((await db.query('select status from public.scope_setup_requests where id=$1',[setup])).rows[0].status,'revoked');
 assert.equal((await db.query('select count(*)::int n from public.buildings')).rows[0].n,2);
});
await ok('minimal provenance: source required, unknown area retained, verified only by permitted reviewer',async()=>{
 const row=(await as('managerA','select * from public.units where id=$1',[unit.A])).rows[0];
 assert.equal(row.verification_status,'needs_review'); assert.equal(row.source_kind,'declaration');
 assert.equal(row.area,null); assert.equal(row.recorded_by,profile.managerA); assert.ok(row.known_from);
 await denied(()=>as('managerA','select public.create_unit($1,$2,$3)',[scope.A,'no-source','apartment']));
 await denied(()=>as('managerA',"select public.create_unit($1,'future','apartment',source_kind=>'document',source_reference=>'Synthetic',known_from=>(now() at time zone 'Europe/Sofia')::date+1)",[scope.A]));
 await denied(()=>as('managerB',"select public.verify_registry_record($1,'unit',$2,'Synthetic review')",[scope.B,unit.A]));
 await denied(()=>as('orgA',"select public.verify_registry_record($1,'unit',$2,'Synthetic review')",[scope.A,unit.A]));
 await denied(()=>as('managerA',"update public.units set verification_status='verified' where id=$1",[unit.A]));
 await as('managerA',"select public.verify_registry_record($1,'unit',$2,'Synthetic document checked; area remains unknown')",[scope.A,unit.A]);
 const verified=(await as('managerA','select * from public.units where id=$1',[unit.A])).rows[0];
 assert.equal(verified.verification_status,'verified'); assert.equal(verified.verified_by,profile.managerA); assert.equal(verified.area,null);
 assert.equal((await db.query('select count(*)::int n from public.units')).rows[0].n,2);
});
await ok('organization staff projection stays inside own org and does not grant registry access',async()=>{
 const own=(await as('orgA','select * from public.organization_staff($1)',[org.A])).rows;
 assert.ok(own.some(r=>r.role_id===role.A)); assert.ok(!own.some(r=>r.role_id===role.B));
 await denied(()=>as('orgA','select * from public.organization_staff($1)',[org.B]));
 await denied(()=>as('managerA','select * from public.organization_staff($1)',[org.A]));
 assert.equal((await as('orgA','select * from public.units')).rows.length,0);
});
await ok('known-from accepts the Bulgarian date after UTC midnight boundary and rejects the following date',async()=>{
 await db.query("select private.check_provenance('declaration','Synthetic calendar boundary',(now() at time zone 'Europe/Sofia')::date)");
 await denied(()=>db.query("select private.check_provenance('declaration','Synthetic calendar boundary',(now() at time zone 'Europe/Sofia')::date+1)"));
});
await ok('organization request revision, stale review, rejection and withdrawal persist correct lifecycle',async()=>{
 const request=async()=> (await as('pending',"insert into public.access_requests(request_kind,requester_profile_id,request_payload) values('organization_onboarding',$1,$2) returning id",[profile.pending,{name:'Synthetic request',organization_kind:'self_managed'}])).rows[0].id;
 const first=await request();
 await denied(()=>as('orgB',"select public.revise_organization_request($1,1,'Foreign','self_managed')",[first]));
 await as('pending',"select public.revise_organization_request($1,1,'Synthetic community','self_managed')",[first]);
 await denied(()=>as('platform',"select public.activate_organization($1,1,'Stale review')",[first]));
 await denied(()=>as('pending',"select public.close_organization_request($1,2,'rejected','Self approval denied')",[first]));
 await as('platform',"select public.close_organization_request($1,2,'rejected','Synthetic reason')",[first]);
 assert.equal((await db.query('select status from public.access_requests where id=$1',[first])).rows[0].status,'rejected');
 const second=await request();
 await as('pending',"select public.close_organization_request($1,1,'revoked','Withdrawn by synthetic requester')",[second]);
 await denied(()=>as('platform',"select public.activate_organization($1,1,'Withdrawn request')",[second]));
 assert.equal((await db.query('select status from public.access_requests where id=$1',[second])).rows[0].status,'revoked');
 assert.equal((await db.query("select count(*)::int n from public.audit_events where action='request_organization' and target_id in($1,$2)",[first,second])).rows[0].n,2);
 assert.equal((await db.query('select count(*)::int n from public.organizations')).rows[0].n,2);
});
await ok('manager SELECT isolation both directions; pending/platform/org-admin have no operational inheritance',async()=>{
 for(const s of ['A','B']) {
  assert.deepEqual((await as(`manager${s}`,'select id from public.units')).rows.map(x=>x.id),[unit[s]]);
  assert.equal((await as(`manager${s}`,'select * from public.buildings')).rows.length,1);
 }
 for(const n of ['pending','platform','orgA']) assert.equal((await as(n,'select * from public.units')).rows.length,0);
});
await ok('cross-org RPC create/assignment forbidden; no rows added',async()=>{
 await denied(()=>as('managerA','select public.create_unit($1,$2,$3)',[scope.B,'foreign','apartment']));
 await denied(()=>as('orgA','select public.assign_staff_role($1,$2,$3,$4,$5)',[org.A,ids.managerA,scope.B,'manager',['read_registry']]));
 await denied(()=>as('orgA','select public.assign_staff_role($1,$2,$3,$4,$5)',[org.A,ids.orgA,scope.A,'platform_admin',['manage_platform']]));
 await denied(()=>as('orgA','select public.assign_staff_role($1,$2,$3,$4,$5)',[org.A,ids.orgA,scope.A,'manager',['manage_platform']]));
 assert.equal((await db.query('select count(*)::int n from public.units')).rows[0].n,2);
});
await ok('direct INSERT/UPDATE/DELETE and audit writes denied even for manager',async()=>{
 await denied(()=>as('managerA',"insert into public.units(building_id,unit_type,unit_number) select building_id,'apartment','x' from public.units"));
 await denied(()=>as('managerA',"update public.units set unit_number='tampered' where id=$1",[unit.B]));
 await denied(()=>as('managerA','delete from public.units where id=$1',[unit.A]));
 await denied(()=>as('managerA',"insert into public.audit_events(action,target_kind,target_id) values('fake','unit',$1)",[unit.A]));
 assert.equal((await db.query('select unit_number from public.units where id=$1',[unit.B])).rows[0].unit_number,'03');
 assert.equal((await db.query('select count(*)::int n from public.units')).rows[0].n,2);
});
await ok('FK scope mismatch, overlapping periods and invalid area rejected atomically',async()=>{
 await denied(()=>db.query('insert into public.unit_scope_periods(scope_id,unit_id,valid_from) values($1,$2,current_date)',[scope.B,unit.A]));
 await denied(()=>db.query('insert into public.unit_scope_periods(scope_id,unit_id,valid_from) values($1,$2,current_date)',[scope.A,unit.A]));
 await denied(()=>as('managerA','select public.create_unit($1,$2,$3,null,0)',[scope.A,'bad','apartment']));
 assert.equal((await db.query('select count(*)::int n from public.units')).rows[0].n,2);
});
await ok('delegated read-only controller cannot write',async()=>{
 await as('orgA','select public.assign_staff_role($1,$2,$3,$4,$5)',[org.A,ids.pending,scope.A,'controller',['read_registry']]);
 assert.equal((await as('pending','select * from public.units')).rows.length,1);
 await denied(()=>as('pending','select public.create_unit($1,$2,$3)',[scope.A,'forbidden','apartment']));
});
await ok('revocation uses current DB grant with same session identity',async()=>{
 await as('orgA','select public.revoke_staff_role($1)',[role.A]);
 assert.equal((await as('managerA','select * from public.units')).rows.length,0);
 await denied(()=>as('managerA','select public.create_unit($1,$2,$3)',[scope.A,'revoked','apartment']));
 assert.equal((await db.query('select count(*)::int n from public.units')).rows[0].n,2);
});
await ok('deactivated organization closes current access',async()=>{
 await db.query("update public.organizations set status='inactive' where id=$1",[org.B]);
 assert.equal((await as('managerB','select * from public.units')).rows.length,0);
 await denied(()=>as('managerB','select public.create_unit($1,$2,$3)',[scope.B,'inactive','apartment']));
});
await ok('all public tables RLS; no anon grants or public SECURITY DEFINER',async()=>{
 assert.equal((await db.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity")).rows[0].n,0);
 assert.equal((await db.query("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef")).rows[0].n,0);
 for (const t of ['profiles','organizations','organization_memberships','user_roles','role_permissions','audit_events','access_requests','scope_setup_requests','buildings','entrances','management_units','management_assignments','units','unit_scope_periods']) {
  assert.equal((await db.query("select has_table_privilege('anon',$1,'SELECT,INSERT,UPDATE,DELETE') allowed",[`public.${t}`])).rows[0].allowed,false);
 }
});
await ok('disabled identity loses access even with unchanged claims',async()=>{
 await db.query("update public.profiles set status='disabled' where id=$1",[profile.orgA]);
 assert.equal((await as('orgA','select * from public.profiles')).rows.length,0);
 await denied(()=>as('orgA','select public.ensure_profile()'));
 await denied(()=>as('orgA','select public.create_management_context($1,$2,$3)',[org.A,'disabled','disabled']));
});
await ok('deleted or unconfirmed recipient cannot be activated',async()=>{
 const fresh='00000000-0000-4000-8000-000000000099';
 await db.query('insert into auth.users(id,email_confirmed_at) values($1,now())',[fresh]);
 await db.exec('set role authenticated');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[fresh]);
 const pid=(await db.query('select public.ensure_profile() id')).rows[0].id;
 const req=(await db.query("insert into public.access_requests(request_kind,requester_profile_id,request_payload) values('organization_onboarding',$1,$2) returning id",[pid,{name:'Deleted target',organization_kind:'self_managed'}])).rows[0].id;
 await db.exec('reset role');
 await db.query('delete from auth.users where id=$1',[fresh]);
 await denied(()=>as('platform',"select public.activate_organization($1,1,'Synthetic review')",[req]));
 assert.equal((await db.query('select status from public.access_requests where id=$1',[req])).rows[0].status,'pending');
 assert.equal((await db.query('select count(*)::int n from public.organizations')).rows[0].n,2);
});
await db.close();
console.log(`PASS: ${checks} PostgreSQL test groups. Hosted Auth sessions and email delivery require separate verification.`);
