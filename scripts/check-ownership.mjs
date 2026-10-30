import assert from 'node:assert/strict';
import {loadEnvFile} from 'node:process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {registryToday} from '../src/domain/registry.js';
loadEnvFile('.env.local');loadEnvFile('.env.rls.local');
const url=process.env.VITE_SUPABASE_URL,key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
assert.equal(url,'https://qfybswnezdzzahmozikr.supabase.co');assert.ok(key.startsWith('sb_publishable_'));
const fixtures=JSON.parse(await readFile('.local/persons-qa/fixtures.json','utf8'));
const out='.local/ownership-qa';await mkdir(out,{recursive:true});const file=out+'/state.json';
let state;try{state=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;state={requests:{},passed:[],ids:{},scope:fixtures.scope,persons:fixtures.persons,dates:{today:registryToday()}};}
const clients={};const unwrap=({data,error})=>{if(error)throw Object.assign(new Error(`API ${error.code}`),{code:error.code});return data;};
const persist=()=>writeFile(file,JSON.stringify(state,null,2));
const deny=async(promise)=>{const r=await promise;assert.ok(r.error,'Expected refusal');assert.ok(['42501','23514','23505','23P01','23503','22P02','22007','22008'].includes(r.error.code),`Unexpected refusal ${r.error.code}`);return r.error.code;};
const read=(label='A',date=state.dates.today,s=state.scope[label],unit=state.units[label])=>clients[label].rpc('read_ownership',{scope:s,unit,as_of:date});
const fields=(person,fraction,from=state.dates.today,to=null,target=null)=>({person_id:person,fraction,valid_from:from,valid_to:to,target});
async function planned(name,changes,label='A',scope=state.scope[label],unit=state.units[label]){
 if(!state.requests[name]){state.requests[name]={scope,unit,request_key:randomUUID(),changes,reason:'Synthetic ownership QA change',source_kind:'document',source_reference:'DEV-03 ownership QA 20261030',known_from:state.dates.today,history_note:'Synthetic registry known only from supplied date; no acquisition assertion'};await persist();}
 return clients[label].rpc('apply_ownership_changes',state.requests[name]);
}
async function batch(name,changes,...rest){const ids=unwrap(await planned(name,changes,...rest));state.ids[name]=ids;await persist();return ids;}
async function reviewRows(ids){for(const target of ids){const data=unwrap(await read());const row=data.records.find(r=>r.id===target);if(row.verification_status!=='verified')unwrap(await clients.A.rpc('review_ownership',{scope:state.scope.A,unit:state.units.A,target,as_of:state.dates.today,note:'Synthetic ownership source checked'}));}}
async function check(name,fn){if(state.passed.includes(name)){console.log(`RETAIN previous PASS: ${name}`);return;}await fn();state.passed.push(name);await persist();console.log(`PASS: ${name}`);}
try{
 for(const label of ['A','B','PENDING']){assert.match(process.env[`RLS_${label}_EMAIL`],/^rls-(a|b|pending)-[a-f0-9]+@propertyhub\.invalid$/);const c=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});clients[label]=c;unwrap(await c.auth.signInWithPassword({email:process.env[`RLS_${label}_EMAIL`],password:process.env[`RLS_${label}_PASSWORD`]}));}
 if(!state.units){state.units={};for(const label of ['A','B']){const periods=unwrap(await clients[label].from('unit_scope_periods').select('unit_id,valid_from').eq('scope_id',state.scope[label]).order('unit_id'));assert.ok(periods.length);state.units[label]=periods[0].unit_id;}
  const t=new Date(state.dates.today+'T12:00:00Z');t.setUTCDate(t.getUTCDate()+1);state.dates.tomorrow=t.toISOString().slice(0,10);await persist();}
 await check('partial share and exact idempotent batch',async()=>{
  const changes=[fields(state.persons.A[0],'0.5')];const ids=await batch('partial',changes);assert.deepEqual(unwrap(await planned('partial',changes)),ids);
  const data=unwrap(await read());assert.equal(data.total_fraction,'0.5000000000');assert.equal(data.set_reviewed,false);assert.equal(data.records.length,1);
  await deny(clients.A.rpc('review_ownership',{scope:state.scope.A,unit:state.units.A,target:null,as_of:state.dates.today,note:'Cannot approve partial'}));
 });
 await check('cross-org and same-org foreign scope/person, pending, direct edit and forged review refusal',async()=>{
  assert.equal(unwrap(await clients.B.from('ownership_periods').select('id')).length,0);
  assert.equal(unwrap(await clients.PENDING.from('ownership_periods').select('id')).length,0);
  await deny(read('B',state.dates.today,state.scope.A,state.units.A));
  await deny(planned('foreign-B-to-A',[fields(state.persons.A[0],'0.5')],'B',state.scope.A,state.units.A));
  await deny(planned('pending-to-A',[fields(state.persons.A[0],'0.5')],'PENDING',state.scope.A,state.units.A));
  await deny(planned('foreign-person',[fields(state.persons.B[0],'0.5')]));
  await deny(planned('other-scope-person',[fields(state.persons.extraA[0],'0.5')]));
  await deny(clients.A.from('ownership_periods').update({ownership_fraction:1,person_id:state.persons.B[0]}).eq('id',state.ids.partial[0]));
  await deny(clients.A.from('ownership_periods').delete().eq('id',state.ids.partial[0]));
  await deny(clients.A.from('ownership_set_reviews').insert({scope_id:state.scope.A,unit_id:state.units.A,note:'forged'}));
  assert.equal(unwrap(await read()).records.length,1);assert.equal(unwrap(await read()).total_fraction,'0.5000000000');
  assert.equal(unwrap(await clients.PENDING.rpc('my_contexts')).length,0);assert.equal(unwrap(await clients.PENDING.from('user_roles').select('id')).length,0);
 });
 await check('invalid precision, overlap and future over-allocation roll back without records',async()=>{
  for(const fraction of ['0','1.00000000001','0.12345678901'])await deny(planned('invalid-'+fraction,[fields(state.persons.A[1],fraction)]));
  await deny(planned('overlap',[fields(state.persons.A[0],'0.1')]));
  await deny(planned('future-total',[fields(state.persons.A[1],'0.6',state.dates.tomorrow)]));
  assert.equal(unwrap(await read()).records.length,1);
 });
 await check('coowners and explicit row/set reviews persist',async()=>{
  const second=await batch('coowner',[fields(state.persons.A[1],'0.5')]);const ids=[state.ids.partial[0],second[0]];
  assert.equal(unwrap(await read()).set_reviewed,false);await reviewRows(ids);
  if(!unwrap(await read()).set_reviewed)unwrap(await clients.A.rpc('review_ownership',{scope:state.scope.A,unit:state.units.A,target:null,as_of:state.dates.today,note:'Synthetic full set and exact shares checked'}));
  assert.equal(unwrap(await read()).set_reviewed,true);
 });
 await check('atomic sale, immutable originals, stale correction and review invalidation',async()=>{
  const changes=[fields(state.persons.A[0],'0.5',state.dates.today,state.dates.tomorrow,state.ids.partial[0]),fields(state.persons.A[1],'0.5',state.dates.today,state.dates.tomorrow,state.ids.coowner[0]),fields(state.persons.A[0],'1',state.dates.tomorrow)];
  const ids=await batch('sale',changes);assert.equal(ids.length,3);const data=unwrap(await read());
  assert.equal(data.set_reviewed,false);assert.equal(data.records.find(p=>p.id===state.ids.partial[0]).record_state,'superseded');assert.equal(data.records.find(p=>p.id===state.ids.partial[0]).valid_to,null);
  assert.equal(data.records.find(p=>p.id===ids[0]).verification_status,'needs_review');
  const future=unwrap(await read('A',state.dates.tomorrow));assert.equal(future.total_fraction,'1.0000000000');
  await deny(planned('stale',[fields(state.persons.A[0],'0.4',state.dates.today,null,state.ids.partial[0])]));
  await deny(planned('bad-correction',[fields(state.persons.A[0],'0.7',state.dates.today,null,ids[0]),fields(state.persons.A[1],'0.5',state.dates.today,null,ids[1])]));
  assert.equal(unwrap(await read()).records.length,5);assert.equal(unwrap(await read()).records.find(p=>p.id===ids[0]).record_state,'current');
 });
 await check('concurrent batches serialize: one allowed, one refused; no total above one',async()=>{
  await batch('void-for-race',state.ids.sale.map(target=>({target,void:true})));
  const replies=await Promise.all([planned('race-A',[fields(state.persons.A[0],'0.6')]),planned('race-B',[fields(state.persons.A[1],'0.6')])]);
  assert.equal(replies.filter(r=>!r.error).length,1);assert.equal(replies.filter(r=>r.error?.code==='23514').length,1);
  const data=unwrap(await read());assert.equal(data.total_fraction,'0.6000000000');
  state.raceWinner=data.records.filter(p=>p.record_state==='current').map(p=>p.id);await persist();
 });
 await check('restore reviewed synthetic coowner fixture; no portal access',async()=>{
  await batch('void-race',state.raceWinner.map(target=>({target,void:true})));
  const ids=await batch('final-coowners',[fields(state.persons.A[0],'0.5'),fields(state.persons.A[1],'0.5')]);await reviewRows(ids);
  if(!unwrap(await read()).set_reviewed)unwrap(await clients.A.rpc('review_ownership',{scope:state.scope.A,unit:state.units.A,target:null,as_of:state.dates.today,note:'Synthetic final coowner set checked'}));
  assert.equal(unwrap(await read()).set_reviewed,true);assert.equal(unwrap(await clients.PENDING.rpc('my_contexts')).length,0);
 });
 await check('own B ownership allowed; A foreign read/write and changed request payload denied',async()=>{
  const ids=await batch('B-partial',[fields(state.persons.B[0],'0.25')],'B');
  const own=unwrap(await read('B'));assert.equal(own.total_fraction,'0.2500000000');assert.equal(own.records[0].id,ids[0]);
  assert.equal(unwrap(await clients.A.from('ownership_periods').select('id').eq('scope_id',state.scope.B)).length,0);
  await deny(read('A',state.dates.today,state.scope.B,state.units.B));
  await deny(planned('foreign-A-to-B',[fields(state.persons.B[0],'0.1')],'A',state.scope.B,state.units.B));
  const count=unwrap(await read()).records.length;
  await deny(clients.A.rpc('apply_ownership_changes',{...state.requests.partial,reason:'Different payload must not replay'}));
  assert.equal(unwrap(await read()).records.length,count);
 });
 await check('anonymous access to ownership tables and RPCs is closed',async()=>{
  const anon=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  await deny(anon.from('ownership_periods').select('id'));
  await deny(anon.from('ownership_set_reviews').select('id'));
  await deny(anon.rpc('read_ownership',{scope:state.scope.A,unit:state.units.A,as_of:state.dates.today}));
  await deny(anon.rpc('apply_ownership_changes',state.requests.partial));
 });
 await writeFile(out+'/report.json',JSON.stringify({status:'PASS',groups:state.passed,auth:'Existing ordinary A/B/pending sessions, publishable key only; separate anonymous denial',newAuthAccounts:0,scope:'synthetic A reviewed coowners + B partial owner; symmetric isolation; no financial/account links'},null,2));
}catch(error){await writeFile(out+'/failure.json',JSON.stringify({status:'FAIL',code:error.code||error.name,completed:state.passed},null,2));console.error(`FAIL: ownership API ${error.code||error.name}; sensitive details suppressed`);process.exitCode=1;}
finally{for(const c of Object.values(clients))await c.auth.signOut({scope:'local'});}
