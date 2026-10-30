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
assert.ok(labels.every(l => /^rls-(a|b|pending)-[a-f0-9]+@propertyhub\.invalid$/.test(process.env[`RLS_${l}_EMAIL`])), 'Use only the isolated synthetic accounts created by the operator setup.');
const clients = {};
const profiles = {};
const users = {};
const unwrap = ({data,error}) => { if(error) throw Object.assign(new Error(`API error ${error.code || error.status || 'unknown'}`),{code:error.code}); return data; };
const calendarParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
const calendarPart = kind => calendarParts.find(p=>p.type===kind).value;
const todayBG = `${calendarPart('year')}-${calendarPart('month')}-${calendarPart('day')}`;
const source = { source_kind: 'declaration', source_reference: 'DEV-02 synthetic declaration', known_from: todayBG };
const createUnit = (client, args) => client.rpc('create_unit', { ...args, ...source });
let count = 0;
async function check(label, fn) { await fn(); console.log(`PASS: ${label}`); count++; }
async function deny(promise) { const {error}=await promise; assert.ok(error,'Operation unexpectedly allowed'); assert.ok(['42501','23514','23505','23P01','PGRST202'].includes(error.code),`Unexpected error code ${error.code}`); }
async function verifyRevocation(client,manifest) {
 const tokenBefore=(await client.auth.getSession()).data.session?.access_token;
 assert.ok(tokenBefore,'Session required');
 const visible=unwrap(await client.from('units').select('id').eq('building_id',manifest.building.A));
 assert.ok(visible.length,'Existing visible fixture required');
 unwrap(await client.rpc('revoke_staff_role',{role_id:manifest.role.A}));
 try {
  assert.equal(unwrap(await client.from('units').select('id')).length,0);
  await deny(createUnit(client,{scope:manifest.scope.A,unit_number:'revoked-same-token',unit_type:'apartment'}));
  const tokenAfter=(await client.auth.getSession()).data.session?.access_token;
  assert.ok(tokenAfter===tokenBefore,'Access token unexpectedly changed'); // Never put a token in an assert diff.
 } finally {
  manifest.role.A=unwrap(await client.rpc('assign_staff_role',{org:manifest.org.A,target_auth_user_id:users.A,scope:manifest.scope.A,role:'manager',permissions:['read_registry','manage_registry']}));
  await writeFile('.local/rls-fixtures.json',JSON.stringify(manifest,null,2));
 }
 assert.equal(unwrap(await client.from('units').select('id').eq('id',visible[0].id).single()).id,visible[0].id);
 assert.equal(unwrap(await client.from('units').select('id').eq('unit_number','revoked-same-token')).length,0);
}
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
   for(const type of ['org','member']) manifest[type][label]=randomUUID();
   const {org,member}=manifest;
   sql+=`update public.profiles set status='active' where id='${profiles[label]}';
insert into public.organizations(id,name,organization_kind) values('${org[label]}','DEV-02 synthetic ${label}','self_managed');
insert into public.organization_memberships(id,organization_id,profile_id) values('${member[label]}','${org[label]}','${profiles[label]}');
insert into public.user_roles(profile_id,membership_id,role_code,permissions) values('${profiles[label]}','${member[label]}','org_admin',array['manage_members']);
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
  if(process.argv.includes('--calendar')) {
   const tomorrow=new Date(`${todayBG}T12:00:00Z`);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
   await check('Bulgarian known-from date accepted; future date rejected with no persisted row',async()=>{
    const number=`TZ-${run.slice(0,8)}`;
    const id=unwrap(await createUnit(a,{scope:m.scope.A,unit_number:number,unit_type:'apartment'}));
    const actual=unwrap(await a.from('units').select('known_from,verification_status').eq('id',id).single());
    assert.equal(actual.known_from,todayBG);assert.equal(actual.verification_status,'needs_review');
    await deny(a.rpc('create_unit',{scope:m.scope.A,unit_number:`FUTURE-${run.slice(0,8)}`,unit_type:'apartment',...source,known_from:tomorrow.toISOString().slice(0,10)}));
    assert.equal(unwrap(await a.from('units').select('id').eq('unit_number',`FUTURE-${run.slice(0,8)}`)).length,0);
   });
   console.log('PASS: targeted hosted calendar check; normal user session only.');
  } else if(process.argv.includes('--revocation')) {
   await check('same exact access token loses revoked registry rights; no forbidden row persists',()=>verifyRevocation(a,m));
   console.log('PASS: targeted hosted revocation check; token values suppressed.');
  } else {
  await check('real login sessions, pending profile and no pending roles',async()=>{
   assert.equal(unwrap(await p.from('profiles').select('status').single()).status,'pending');
   assert.equal(unwrap(await p.from('user_roles').select('id')).length,0);
   assert.equal(unwrap(await p.from('organizations').select('id')).length,0);
  });
  m.setup ||= {};
  await check('pure org admins have no registry; explicit initial manager appointments are accepted by exact recipients',async()=>{
   for (const s of ['A','B']) {
    if (!m.scope[s]) {
     assert.equal(unwrap(await clients[s].from('units').select('id')).length,0);
     assert.equal(unwrap(await clients[s].from('user_roles').select('role_code').eq('role_code','manager')).length,0);
     if (!m.setup[s]) {
      m.setup[s]=unwrap(await clients[s].rpc('request_scope_setup',{org:m.org[s],target_auth_user_id:users[s],label:`DEV-02 synthetic ${s}`}));
      await writeFile('.local/rls-fixtures.json',JSON.stringify(m,null,2));
     }
     await deny(clients[s==='A'?'B':'A'].rpc('complete_scope_setup',{request_id:m.setup[s],address:'Forbidden synthetic address',entrance_code:null,...source}));
     m.scope[s]=unwrap(await clients[s].rpc('complete_scope_setup',{request_id:m.setup[s],address:`Synthetic address ${s}`,entrance_code:null,...source}));
     m.role[s]=unwrap(await clients[s].from('user_roles').select('id').eq('scope_id',m.scope[s]).eq('role_code','manager').single()).id;
     m.building[s]=unwrap(await clients[s].from('management_units').select('building_id').eq('id',m.scope[s]).single()).building_id;
     await writeFile('.local/rls-fixtures.json',JSON.stringify(m,null,2));
    }
    assert.equal(unwrap(await clients[s].from('scope_setup_requests').select('status').eq('id',m.setup[s]).single()).status,'fulfilled');
    assert.equal(unwrap(await clients[s].rpc('organization_staff',{org:m.org[s]})).filter(r=>r.role_id===m.role[s]).length,1);
    await deny(clients[s].rpc('organization_staff',{org:m.org[s==='A'?'B':'A']}));
   }
  });
  await check('user_metadata role claim cannot grant access',async()=>{
   unwrap(await p.auth.updateUser({data:{role:'platform_admin'}}));
   assert.equal(unwrap(await p.from('organizations').select('id')).length,0);
   await deny(createUnit(p,{scope:m.scope.A,unit_number:'forbidden',unit_type:'apartment'}));
  });
  await check('allowed RPC creates real rows in each organization',async()=>{
   for(const s of ['A','B']) {
    unit[s]=unwrap(await createUnit(clients[s],{scope:m.scope[s],unit_number:`T-${run.slice(0,8)}`,unit_type:'apartment'}));
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
   await deny(createUnit(a,{scope:m.scope.B,unit_number:`DENY-${run.slice(0,8)}`,unit_type:'apartment'}));
   assert.equal(unwrap(await b.from('units').select('id').eq('unit_number',`DENY-${run.slice(0,8)}`)).length,0);
  });
  await check('foreign UPDATE/DELETE rejected and real row unchanged',async()=>{
   await deny(a.from('units').update({unit_number:'tampered'}).eq('id',unit.B));
   await deny(a.from('units').delete().eq('id',unit.B));
   assert.equal(unwrap(await b.from('units').select('unit_number').eq('id',unit.B).single()).unit_number,`T-${run.slice(0,8)}`);
  });
  await check('provenance is recorded, foreign verification denied, unknown area remains unknown',async()=>{
   const before=unwrap(await b.from('units').select('verification_status,area,source_kind,known_from,recorded_by').eq('id',unit.B).single());
   assert.equal(before.source_kind,'declaration'); assert.equal(before.known_from,source.known_from); assert.equal(before.recorded_by,profiles.B);
   await deny(a.rpc('verify_registry_record',{scope:m.scope.A,kind:'unit',target:unit.B,note:'Forbidden foreign verification'}));
   await deny(b.from('units').update({verification_status:'verified'}).eq('id',unit.B));
   assert.equal(unwrap(await b.from('units').select('verification_status').eq('id',unit.B).single()).verification_status,'needs_review');
   unwrap(await b.rpc('verify_registry_record',{scope:m.scope.B,kind:'unit',target:unit.B,note:'Synthetic supplied values reviewed; area remains unknown'}));
   const after=unwrap(await b.from('units').select('verification_status,verified_by,area').eq('id',unit.B).single());
   assert.equal(after.verification_status,'verified'); assert.equal(after.verified_by,profiles.B); assert.equal(after.area,null);
  });
  await check('requester can revise/withdraw but cannot activate or reject organization request',async()=>{
   const request=unwrap(await p.from('access_requests').insert({request_kind:'organization_onboarding',requester_profile_id:profiles.PENDING,request_payload:{name:`Synthetic request ${run}`,organization_kind:'self_managed'}}).select('id,revision').single());
   unwrap(await p.rpc('revise_organization_request',{request_id:request.id,expected_revision:1,name:`Synthetic revised ${run}`,organization_kind:'self_managed'}));
   await deny(a.rpc('revise_organization_request',{request_id:request.id,expected_revision:2,name:'Forbidden revision',organization_kind:'self_managed'}));
   await deny(p.rpc('activate_organization',{request_id:request.id,expected_revision:2,review_note:'Forbidden self elevation'}));
   await deny(p.rpc('close_organization_request',{request_id:request.id,expected_revision:2,decision:'rejected',note:'Forbidden self review'}));
   unwrap(await p.rpc('close_organization_request',{request_id:request.id,expected_revision:2,decision:'revoked',note:'Synthetic requester withdrawal'}));
   const final=unwrap(await p.from('access_requests').select('status,revision,organization_id').eq('id',request.id).single());
   assert.equal(final.status,'revoked'); assert.equal(final.revision,3); assert.equal(final.organization_id,null);
   assert.equal(unwrap(await p.from('organizations').select('id')).length,0);
  });
  await check('self elevation and foreign role grants denied',async()=>{
   await deny(p.from('profiles').update({status:'active'}).eq('id',profiles.PENDING));
   await deny(a.rpc('assign_staff_role',{org:m.org.A,target_auth_user_id:users.A,scope:m.scope.A,role:'platform_admin',permissions:['manage_platform']}));
   await deny(a.rpc('assign_staff_role',{org:m.org.A,target_auth_user_id:users.A,scope:m.scope.B,role:'manager',permissions:['read_registry']}));
   assert.equal(unwrap(await p.from('profiles').select('status').single()).status,'pending');
  });
  await check('current DB revocation denies same session token',()=>verifyRevocation(a,m));
  console.log(`PASS: ${count} hosted RLS groups with real user sessions. Synthetic fixture rows remain for inspection.`);
  }
 }
 for(const client of Object.values(clients)) {
  unwrap(await client.auth.signOut({scope:'local'}));
  assert.ok((await client.auth.getSession()).data.session===null,'Local logout did not clear the session');
 }
 console.log('PASS: logout cleared each client session; existing JWT expiry is not claimed to change.');
} catch(error) {
 console.error(`FAILED/BLOCKED: ${error.message}`);
 process.exitCode=1;
} finally {
 for(const client of Object.values(clients)) await client.auth.signOut({scope:'local'}).catch(()=>{});
}
