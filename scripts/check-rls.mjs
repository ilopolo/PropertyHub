import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { createClient } from '@supabase/supabase-js';

// No service-role key or DB password is accepted here. Every API assertion uses an actual user session.
try { loadEnvFile('.env.local'); } catch {}
try { loadEnvFile('.env.rls.local'); } catch {}
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (url !== 'https://qfybswnezdzzahmozikr.supabase.co' || !key?.startsWith('sb_publishable_')) {
  console.error('BLOCKED: expected project URL and publishable key in .env.local.'); process.exit(2);
}
const labels = ['A','B','PENDING'];
if (labels.some(l => !process.env[`RLS_${l}_EMAIL`] || !process.env[`RLS_${l}_PASSWORD`])) {
  console.error('BLOCKED: three confirmed synthetic accounts are required in ignored .env.rls.local: RLS_A_EMAIL/PASSWORD, RLS_B_EMAIL/PASSWORD, RLS_PENDING_EMAIL/PASSWORD.'); process.exit(2);
}
const clients = {};
const profiles = {};
const users = {};
const unwrap = ({data,error}) => { if(error) throw Object.assign(new Error(`API error ${error.code || error.status || 'unknown'}`),{code:error.code}); return data; };
let count = 0;
async function check(label, fn) { await fn(); console.log(`PASS: ${label}`); count++; }
async function deny(promise) { const {error}=await promise; assert.ok(error,'Operation unexpectedly allowed'); assert.ok(['42501','23514','23505','23P01','PGRST202'].includes(error.code),`Unexpected error code ${error.code}`); }
try {
 for(const label of labels) {
  const c=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  clients[label]=c;
  const {user,session}=unwrap(await c.auth.signInWithPassword({email:process.env[`RLS_${label}_EMAIL`],password:process.env[`RLS_${label}_PASSWORD`]}));
  assert.ok(session?.access_token && user.email_confirmed_at,`Confirmed session required for ${label}`);
  users[label]=user.id;
  profiles[label]=unwrap(await c.rpc('ensure_profile',{display_name:`DEV-02 synthetic ${label}`}));
 }
 assert.equal(new Set(Object.values(users)).size,3,'Use three separate synthetic accounts');
 if(process.argv.includes('--prepare')) {
  await mkdir('.local',{recursive:true});
  try { await access('.local/rls-fixtures.json'); throw new Error('Fixture manifest already exists. Inspect the previous run before creating more fixtures.'); }
  catch(e) { if(e.code!=='ENOENT') throw e; }
  const manifest={project:url,users,profiles,org:{},scope:{},building:{},member:{},role:{}};
  let sql='begin;\n';
  for(const label of labels) {
   const roles=unwrap(await clients[label].from('user_roles').select('id'));
   const profile=unwrap(await clients[label].from('profiles').select('status').single());
   assert.equal(roles.length,0,'Fresh synthetic account required'); assert.equal(profile.status,'pending');
   sql+=`do $$begin if not exists(select 1 from public.profiles p join auth.users u on u.id=p.auth_user_id where p.id='${profiles[label]}' and u.id='${users[label]}' and p.status='pending' and u.email_confirmed_at is not null) or exists(select 1 from public.user_roles where profile_id='${profiles[label]}') then raise exception 'Fixture account must be confirmed, pending, and without roles'; end if; end$$;\n`;
  }
  for(const label of ['A','B']) {
   for(const type of ['org','scope','building','member','role']) manifest[type][label]=randomUUID();
   const {org,scope,building,member,role}=manifest;
   sql+=`update public.profiles set status='active' where id='${profiles[label]}';
insert into public.organizations(id,name,organization_kind) values('${org[label]}','DEV-02 synthetic ${label}','self_managed');
insert into public.organization_memberships(id,organization_id,profile_id) values('${member[label]}','${org[label]}','${profiles[label]}');
insert into public.buildings(id,address,created_by_organization_id) values('${building[label]}','Synthetic test context ${label}','${org[label]}');
insert into public.management_units(id,building_id,mode,label) values('${scope[label]}','${building[label]}','building','DEV-02 synthetic ${label}');
insert into public.management_assignments(scope_id,organization_id,valid_from) values('${scope[label]}','${org[label]}',current_date);
insert into public.user_roles(profile_id,membership_id,role_code,permissions) values('${profiles[label]}','${member[label]}','org_admin',array['manage_members']);
insert into public.user_roles(id,profile_id,membership_id,scope_id,role_code,permissions) values('${role[label]}','${profiles[label]}','${member[label]}','${scope[label]}','manager',array['read_registry','manage_registry']);
insert into public.audit_events(organization_id,actor_profile_id,action,target_kind,target_id,reason) values('${org[label]}','${profiles[label]}','test_fixture_setup','organization','${org[label]}','DEV-02 synthetic fixture; operator setup, not RLS evidence');\n`;
  }
  sql+='commit;\n';
  await writeFile('.local/rls-fixtures.sql',sql,{flag:'wx'});
  await writeFile('.local/rls-fixtures.json',JSON.stringify(manifest,null,2),{flag:'wx'});
  console.log('PREPARED: .local/rls-fixtures.sql. Review and apply with trusted operator SQL access, then run npm run check:rls. No fixtures have been applied by this script.');
 } else {
  const m=JSON.parse(await readFile('.local/rls-fixtures.json','utf8'));
  assert.equal(m.project,url); assert.deepEqual(m.users,users);
  const a=clients.A,b=clients.B,p=clients.PENDING;
  const run=randomUUID(); const unit={};
  await check('real login sessions, pending profile and no pending roles',async()=>{
   assert.equal(unwrap(await p.from('profiles').select('status').single()).status,'pending');
   assert.equal(unwrap(await p.from('user_roles').select('id')).length,0);
   assert.equal(unwrap(await p.from('organizations').select('id')).length,0);
  });
  await check('user_metadata role claim cannot grant access',async()=>{
   unwrap(await p.auth.updateUser({data:{role:'platform_admin'}}));
   assert.equal(unwrap(await p.from('organizations').select('id')).length,0);
   await deny(p.rpc('create_unit',{scope:m.scope.A,unit_number:'forbidden',unit_type:'apartment'}));
  });
  await check('allowed RPC creates real rows in each organization',async()=>{
   for(const s of ['A','B']) {
    unit[s]=unwrap(await clients[s].rpc('create_unit',{scope:m.scope[s],unit_number:`T-${run.slice(0,8)}`,unit_type:'apartment'}));
    assert.equal(unwrap(await clients[s].from('units').select('id').eq('id',unit[s]).single()).id,unit[s]);
    assert.equal(unwrap(await clients[s].from('unit_scope_periods').select('unit_id').eq('unit_id',unit[s]).single()).unit_id,unit[s]);
   }
  });
  await check('cross-org SELECT denied both ways; pending has no registry',async()=>{
   assert.equal(unwrap(await a.from('units').select('id').eq('id',unit.B)).length,0);
   assert.equal(unwrap(await b.from('units').select('id').eq('id',unit.A)).length,0);
   assert.equal(unwrap(await p.from('units').select('id')).length,0);
  });
  await check('foreign INSERT RPC denied and no row persisted',async()=>{
   await deny(a.rpc('create_unit',{scope:m.scope.B,unit_number:`DENY-${run.slice(0,8)}`,unit_type:'apartment'}));
   assert.equal(unwrap(await b.from('units').select('id').eq('unit_number',`DENY-${run.slice(0,8)}`)).length,0);
  });
  await check('foreign UPDATE/DELETE rejected and real row unchanged',async()=>{
   await deny(a.from('units').update({unit_number:'tampered'}).eq('id',unit.B));
   await deny(a.from('units').delete().eq('id',unit.B));
   assert.equal(unwrap(await b.from('units').select('unit_number').eq('id',unit.B).single()).unit_number,`T-${run.slice(0,8)}`);
  });
  await check('self elevation and foreign role grants denied',async()=>{
   await deny(p.from('profiles').update({status:'active'}).eq('id',profiles.PENDING));
   await deny(a.rpc('assign_staff_role',{org:m.org.A,target_auth_user_id:users.A,scope:m.scope.A,role:'platform_admin',permissions:['manage_platform']}));
   await deny(a.rpc('assign_staff_role',{org:m.org.A,target_auth_user_id:users.A,scope:m.scope.B,role:'manager',permissions:['read_registry']}));
   assert.equal(unwrap(await p.from('profiles').select('status').single()).status,'pending');
  });
  await check('current DB revocation denies same session token',async()=>{
   unwrap(await a.rpc('revoke_staff_role',{role_id:m.role.A}));
   assert.equal(unwrap(await a.from('units').select('id').eq('id',unit.A)).length,0);
   await deny(a.rpc('create_unit',{scope:m.scope.A,unit_number:'revoked',unit_type:'apartment'}));
   // Still org admin; the manager right is independent and can be restored by the permitted process.
   m.role.A=unwrap(await a.rpc('assign_staff_role',{org:m.org.A,target_auth_user_id:users.A,scope:m.scope.A,role:'manager',permissions:['read_registry','manage_registry']}));
   assert.equal(unwrap(await a.from('units').select('id').eq('id',unit.A).single()).id,unit.A);
   await writeFile('.local/rls-fixtures.json',JSON.stringify(m,null,2));
  });
  console.log(`PASS: ${count} hosted RLS groups with real user sessions. Synthetic fixture rows remain for inspection.`);
 }
 for(const client of Object.values(clients)) {
  unwrap(await client.auth.signOut({scope:'local'}));
  assert.equal((await client.auth.getSession()).data.session,null);
 }
 console.log('PASS: logout cleared each client session; existing JWT expiry is not claimed to change.');
} catch(error) {
 console.error(`FAILED/BLOCKED: ${error.message}`);
 process.exitCode=1;
} finally {
 for(const client of Object.values(clients)) await client.auth.signOut({scope:'local'}).catch(()=>{});
}
