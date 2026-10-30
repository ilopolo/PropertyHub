import assert from 'node:assert/strict';
import {loadEnvFile} from 'node:process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {registryToday} from '../src/domain/registry.js';
loadEnvFile('.env.local');loadEnvFile('.env.rls.local');
const fixture=JSON.parse(await readFile('.local/rls-fixtures.json','utf8'));
const url=process.env.VITE_SUPABASE_URL,key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
assert.equal(url,'https://qfybswnezdzzahmozikr.supabase.co');assert.ok(key.startsWith('sb_publishable_'));
const output='.local/persons-qa';await mkdir(output,{recursive:true});
const source={source_kind:'declaration',source_reference:'DEV-03 scoped-person QA 20261030',known_from:registryToday()};
const clients={},results=[],manifest={scope:{A:fixture.scope.A,B:fixture.scope.B,extraA:fixture.extraScopes.A[0]},persons:{}};
const unwrap=({data,error})=>{if(error)throw Object.assign(new Error(`API ${error.code}`),{code:error.code});return data;};
const deny=async result=>{const {error}=await result;assert.ok(error,'Expected refusal');assert.ok(['42501','23514','23502','23505','23503'].includes(error.code),`Unexpected code ${error.code}`);};
const list=(label,scope)=>clients[label].from('persons').select('*').eq('scope_id',scope).eq('source_reference',source.source_reference).order('id');
const save=(label,scope,person,fields={})=>clients[label].rpc('save_scoped_person',{scope,target:person?.id || null,expected_revision:person?.revision||0,person_kind:'physical',display_name:'Synthetic scoped QA',contact_email:'scoped-qa@example.invalid',contact_phone:null,status:'active',...source,...fields});
const check=async(name,fn)=>{await fn();results.push({name,status:'PASS'});await writeFile(`${output}/report.json`,JSON.stringify({status:'IN PROGRESS',results},null,2));console.log(`PASS: ${name}`);};
try{
 for(const label of ['A','B','PENDING']){
  assert.match(process.env[`RLS_${label}_EMAIL`],/^rls-(a|b|pending)-[a-f0-9]+@propertyhub\.invalid$/);
  const c=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});clients[label]=c;
  const {user}=unwrap(await c.auth.signInWithPassword({email:process.env[`RLS_${label}_EMAIL`],password:process.env[`RLS_${label}_PASSWORD`]}));
  assert.equal(user.id,fixture.users[label]);assert.ok(user.email_confirmed_at);
 }
 // Recovery after an interrupted command discovers the fixed synthetic source packet first.
 for(const [name,label,count] of [['A','A',2],['B','B',1],['extraA','A',1]]){
  let rows=unwrap(await list(label,manifest.scope[name]));assert.ok(rows.length<=count,'Unexpected synthetic records; inspect before writes');
  while(rows.length<count){unwrap(await save(label,manifest.scope[name],null));rows=unwrap(await list(label,manifest.scope[name]));await writeFile(`${output}/fixtures.json`,JSON.stringify({...manifest,partial:name,ids:rows.map(p=>p.id)},null,2));}
  manifest.persons[name]=rows.map(p=>p.id);
 }
 await writeFile(`${output}/fixtures.json`,JSON.stringify(manifest,null,2));
 await check('Ordinary sessions: exact duplicates preserved; same-org scopes stay separate',async()=>{
  const rows=unwrap(await list('A',manifest.scope.A));assert.equal(rows.length,2);assert.notEqual(rows[0].id,rows[1].id);
  assert.ok(rows.every(p=>p.scope_id===manifest.scope.A));
  assert.equal(unwrap(await list('A',manifest.scope.extraA)).length,1);
  assert.equal(unwrap(await list('B',manifest.scope.B)).length,1);
  for(const p of rows)assert.equal(p.field_evidence.display_name.source_reference,source.source_reference);
 });
 await check('Cross-org/scoped SELECT and RPC denials; pending has no registry or roles',async()=>{
  for(const [label,foreign,target] of [['A',manifest.scope.B,manifest.persons.B[0]],['B',manifest.scope.A,manifest.persons.A[0]],['PENDING',manifest.scope.A,manifest.persons.A[0]]]){
   assert.equal(unwrap(await list(label,foreign)).length,0);
   await deny(save(label,foreign,{id:target,revision:1}));
   await deny(clients[label].rpc('verify_scoped_person',{scope:foreign,target,expected_revision:1,note:'Synthetic forbidden'}));
  }
  await deny(save('A',manifest.scope.A,{id:manifest.persons.extraA[0],revision:1}));
  assert.equal(unwrap(await clients.PENDING.from('user_roles').select('id')).length,0);
 });
 await check('Direct metadata writes, delete, fabricated scope/verification denied',async()=>{
  const target=manifest.persons.A[0];
  await deny(clients.A.from('persons').update({verification_status:'verified',scope_id:manifest.scope.B}).eq('id',target));
  await deny(clients.A.from('persons').delete().eq('id',target));
  await deny(clients.A.from('persons').insert({scope_id:manifest.scope.A,display_name:'Forbidden'}));
  assert.equal(unwrap(await list('B',manifest.scope.B))[0].display_name,'Synthetic scoped QA');
 });
 await check('Review/edit lifecycle persists; optimistic stale refusal; no implicit owner link',async()=>{
  const target=manifest.persons.A[0];let row=unwrap(await clients.A.from('persons').select('*').eq('id',target).single());
  // Reusing a previous completed fixture performs no extra replacement.
  if(row.revision===1){
   unwrap(await clients.A.rpc('verify_scoped_person',{scope:manifest.scope.A,target,expected_revision:1,note:'Synthetic source checked'}));
   assert.equal(unwrap(await clients.A.from('persons').select('verification_status').eq('id',target).single()).verification_status,'verified');
   unwrap(await save('A',manifest.scope.A,row,{display_name:'Synthetic revised scoped QA',contact_email:null}));
  }
  row=unwrap(await clients.A.from('persons').select('*').eq('id',target).single());
  assert.ok(row.revision>=2);if(row.revision===2){assert.equal(row.verification_status,'needs_review');assert.equal(row.verified_by,null);}assert.equal(row.contact_email,null);
  assert.equal(Object.hasOwn(row.field_evidence,'contact_email'),false);
  await deny(save('A',manifest.scope.A,{id:target,revision:1}));
  await deny(clients.A.rpc('verify_scoped_person',{scope:manifest.scope.A,target,expected_revision:1,note:'Stale review'}));
  assert.equal(unwrap(await list('A',manifest.scope.A)).length,2);
  assert.equal(unwrap(await clients.PENDING.rpc('my_contexts')).length,0);
 });
 await writeFile(`${output}/report.json`,JSON.stringify({status:'PASS',results,identity:'publishable key + real ordinary A/B/pending sessions; no privileged RLS proof',readonlyController:'Covered in local PostgreSQL; no synthetic pending-role mutation'},null,2));
}catch(error){console.error(`FAIL: scoped person QA ${error.code||error.name}; sensitive details suppressed`);await writeFile(`${output}/failure.json`,JSON.stringify({status:'FAIL',completed:results,code:error.code||error.name},null,2));process.exitCode=1;}
finally{for(const c of Object.values(clients))await c.auth.signOut({scope:'local'});}
