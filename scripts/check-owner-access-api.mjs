import assert from 'node:assert/strict';
import {loadEnvFile} from 'node:process';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
loadEnvFile('.env.local');loadEnvFile('.env.rls.local');loadEnvFile('.env.password-policy.local');
const file='.local/owner-access-qa/state.json',state=JSON.parse(await readFile(file,'utf8'));state.passed??=[];state.requests??={};
assert.equal(process.env.VITE_SUPABASE_URL,'https://qfybswnezdzzahmozikr.supabase.co');assert.ok(process.env.VITE_SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_'));
const clients={},persist=()=>writeFile(file,JSON.stringify(state,null,2));
const unwrap=({data,error})=>{if(error)throw Object.assign(new Error('API '+error.code),{code:error.code});return data;};
const deny=async promise=>{const r=await promise;assert.ok(r.error,'Expected refusal');assert.ok(['42501','23514','23505','PGRST202','PGRST204'].includes(r.error.code),'Unexpected '+r.error.code);};
const check=async(name,fn)=>{if(state.passed.includes(name)){console.log('RETAIN: '+name);return;}await fn();state.passed.push(name);await persist();console.log('PASS: '+name);};
const owned=()=>clients.OWNER.rpc('my_owned_units');
const capability=enabled=>clients.A.rpc('set_owner_verifier',{role_id:state.verifierRole,enabled,note:'Synthetic owner verifier delegation evidence'});
async function confirm(name,extra={},who='B'){
 if(!state.requests[name]){state.requests[name]={scope:state.scope.A,target_auth_user_id:state.auth.OWNER,person:state.person.id,expected_person_revision:state.person.revision,evidence:'Synthetic owner identity evidence',note:'Synthetic owner access QA',request_key:randomUUID(),...extra};await persist();}
 return clients[who].rpc('confirm_owner_link',state.requests[name]);
}
const revoke=()=>clients.B.rpc('revoke_owner_link',{scope:state.scope.A,link_id:state.link,evidence:'Synthetic revocation evidence',note:'Synthetic access revoked in existing session'});
try{
 for(const label of ['A','B','OWNER','PENDING']){
  const email=label==='OWNER'?process.env.PASSWORD_QA_EMAIL:process.env['RLS_'+label+'_EMAIL'],password=label==='OWNER'?process.env.PASSWORD_QA_PASSWORD:process.env['RLS_'+label+'_PASSWORD'];assert.match(email,/@propertyhub\.invalid$/);
  const c=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const auth=unwrap(await c.auth.signInWithPassword({email,password}));assert.match(auth.user.email,/@propertyhub\.invalid$/);clients[label]=c;
 }
 state.person=state.personStates.find(p=>p.status==='active'&&p.verification_status==='verified');assert.ok(state.person);await persist();
 await check('existing sessions and no inherited verification authority',async()=>{
  await deny(confirm('no-inherited',{},'A'));await deny(clients.A.rpc('owner_access_records',{scope:state.scope.A}));assert.deepEqual(unwrap(await owned()),[]);assert.equal(unwrap(await clients.OWNER.from('user_roles').select('id')).length,0);
 });
 await check('synthetic temporary manager delegation, no self escalation',async()=>{
  state.verifierRole=unwrap(await clients.A.rpc('assign_staff_role',{org:state.org,target_auth_user_id:state.auth.B,scope:state.scope.A,role:'manager',permissions:['read_registry']}));await persist();
  const memberships=unwrap(await clients.B.from('organization_memberships').select('id,organization_id,status'));state.temporaryMembership=memberships.find(m=>m.organization_id===state.org&&!state.membershipsBefore.B.some(old=>old.id===m.id))?.id||null;await persist();
  const ownRoles=unwrap(await clients.A.from('user_roles').select('id,scope_id,role_code'));const ownManager=ownRoles.find(r=>r.scope_id===state.scope.A&&r.role_code==='manager');
  await deny(clients.A.rpc('set_owner_verifier',{role_id:ownManager.id,enabled:true,note:'Forbidden self delegation'}));await deny(clients.A.rpc('assign_staff_role',{org:state.org,target_auth_user_id:state.auth.A,scope:state.scope.A,role:'manager',permissions:['read_registry','verify_owner_access']}));
  await deny(confirm('read-not-verify'));unwrap(await capability(true));
 });
 await check('self verification and foreign scope/person denied',async()=>{
  await deny(confirm('self',{target_auth_user_id:state.auth.B}));await deny(confirm('foreign-person',{person:state.persons.B[0]}));await deny(confirm('foreign-scope',{scope:state.scope.extraA,person:state.persons.extraA[0]}));await deny(confirm('stale',{expected_person_revision:state.person.revision+1}));
 });
 await check('confirmed link and actual minimum owner projection',async()=>{
  state.link=unwrap(await confirm('first'));await persist();const data=unwrap(await owned());assert.deepEqual(data.map(u=>u.unit_id),[state.units.A]);assert.equal(Object.keys(data[0]).length,7);
  assert.equal(unwrap(await clients.OWNER.from('units').select('id')).length,0);assert.equal(unwrap(await clients.OWNER.from('persons').select('id')).length,0);assert.equal(unwrap(await clients.OWNER.from('user_roles').select('id')).length,0);assert.equal(unwrap(await clients.OWNER.rpc('my_contexts')).length,0);
  assert.deepEqual(unwrap(await clients.PENDING.rpc('my_owned_units')),[]);assert.deepEqual(unwrap(await clients.OWNER.from('account_person_links').select('id')),[]);
  const actual=unwrap(await clients.B.from('account_person_links').select('id,profile_id,verified_by,person_revision,revoked_at').eq('id',state.link).single());assert.equal(actual.profile_id,state.profiles.OWNER);assert.equal(actual.verified_by,state.profiles.B);assert.equal(actual.person_revision,state.person.revision);assert.equal(actual.revoked_at,null);
 });
 await check('request replay, changed payload and duplicate active identity',async()=>{
  assert.equal(unwrap(await confirm('first')),state.link);await deny(clients.B.rpc('confirm_owner_link',{...state.requests.first,note:'Changed payload'}));await deny(confirm('duplicate'));await deny(confirm('duplicate-other',{target_auth_user_id:state.auth.A}));
 });
 await check('direct edits and unauthorized revoke/history refused',async()=>{
  await deny(clients.OWNER.from('account_person_links').update({profile_id:state.profiles.A}).eq('id',state.link));await deny(clients.OWNER.from('account_person_links').delete().eq('id',state.link));
  await deny(clients.A.rpc('revoke_owner_link',{scope:state.scope.A,link_id:state.link,evidence:'Forbidden inherited right',note:'Denied'}));await deny(clients.PENDING.rpc('owner_access_records',{scope:state.scope.A}));
 });
 await check('revoked verification permission enforced in same JWT session',async()=>{
  const before=unwrap(await clients.B.auth.getSession()).session.access_token;unwrap(await capability(false));await deny(revoke());await deny(confirm('after-cap-revoke'));assert.equal(unwrap(await owned()).length,1);assert.equal(unwrap(await clients.B.auth.getSession()).session.access_token,before);unwrap(await capability(true));
 });
 await check('link revocation removes access in same owner JWT; replay does not restore',async()=>{
  const before=unwrap(await clients.OWNER.auth.getSession()).session.access_token;unwrap(await revoke());assert.deepEqual(unwrap(await owned()),[]);assert.equal(unwrap(await clients.OWNER.auth.getSession()).session.access_token,before);assert.equal(unwrap(await confirm('first')),state.link);assert.deepEqual(unwrap(await owned()),[]);
  const actual=unwrap(await clients.B.from('account_person_links').select('revoked_by,revoked_at,revocation_note').eq('id',state.link).single());assert.equal(actual.revoked_by,state.profiles.B);assert.ok(actual.revoked_at);assert.ok(actual.revocation_note);
 });
 await check('fresh confirmation retains history and leaves isolated UI fixture',async()=>{
  state.link=unwrap(await confirm('for-browser'));await persist();assert.equal(unwrap(await owned()).length,1);const records=unwrap(await clients.B.rpc('owner_access_records',{scope:state.scope.A}));assert.equal(records.filter(l=>l.person_id===state.person.id).length,2);assert.equal(records.filter(l=>l.person_id===state.person.id&&!l.revoked_at).length,1);
  assert.equal(unwrap(await clients.OWNER.from('user_roles').select('id')).length,0);assert.deepEqual(unwrap(await clients.PENDING.rpc('my_owned_units')),[]);
 });
 await check('generic verifier package requires dedicated reason and anonymous endpoints denied',async()=>{
  await deny(clients.A.rpc('assign_staff_role',{org:state.org,target_auth_user_id:state.auth.OWNER,scope:state.scope.A,role:'manager',permissions:['read_registry','verify_owner_access']}));assert.equal(unwrap(await clients.OWNER.from('user_roles').select('id')).length,0);
  const anon=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false}});await deny(anon.rpc('my_owned_units'));await deny(anon.from('account_person_links').select('id'));
 });
 state.phase='api-pass-browser-pending';await persist();await writeFile('.local/owner-access-qa/api-report.json',JSON.stringify({status:'PASS',groups:state.passed,newAuthAccounts:0,auth:'Existing ordinary A/B/OWNER/PENDING sessions; publishable key only; same JWT revocation checks',temporaryFixture:'B read_registry manager+explicit verify_owner_access in A; OWNER link active for UI. Cleanup pending.'},null,2));
}catch(error){console.error('FAIL: owner API '+(error.code||error.name)+'; sensitive details suppressed');await writeFile('.local/owner-access-qa/api-failure.json',JSON.stringify({status:'FAIL',code:error.code||error.name,completed:state.passed},null,2));process.exitCode=1;}
finally{for(const c of Object.values(clients))await c.auth.signOut({scope:'local'});}
