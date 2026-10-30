import assert from 'node:assert/strict';
import {loadEnvFile} from 'node:process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {registryToday} from '../src/domain/registry.js';
loadEnvFile('.env.local');loadEnvFile('.env.rls.local');
const url=process.env.VITE_SUPABASE_URL,key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;assert.equal(url,'https://qfybswnezdzzahmozikr.supabase.co');assert.ok(key.startsWith('sb_publishable_'));
const existing=JSON.parse(await readFile('.local/ownership-qa/state.json','utf8')),out='.local/occupancy-qa';await mkdir(out,{recursive:true});
let state;try{state=JSON.parse(await readFile(out+'/state.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state={requests:{},ids:{},passed:[],scope:existing.scope,units:existing.units,persons:existing.persons,dates:{today:registryToday()}};const t=new Date(state.dates.today+'T12:00:00Z');t.setUTCDate(t.getUTCDate()+1);state.dates.tomorrow=t.toISOString().slice(0,10);}
const clients={},persist=()=>writeFile(out+'/state.json',JSON.stringify(state,null,2));
const unwrap=({data,error})=>{if(error)throw Object.assign(new Error('API '+error.code),{code:error.code});return data;};
const deny=async promise=>{const r=await promise;assert.ok(r.error,'Expected refusal');assert.ok(['42501','23514','23505','23503','23502','23P01','22000','22007','22008','22P02'].includes(r.error.code),`Unexpected code ${r.error.code}`);return r.error.code;};
const read=(label='A',date=state.dates.today,s=state.scope[label],unit=state.units[label])=>clients[label].rpc('read_occupancy',{scope:s,unit,as_of:date});
const aggregate=(units,target=null,from=state.dates.today,to=null)=>({count_mode:'aggregate',occupant_kind:'aggregate',person_id:null,units,target,valid_from:from,valid_to:to});
const individual=(person,kind='other_resident',target=null,from=state.dates.today,to=null)=>({count_mode:'individual',occupant_kind:kind,person_id:person,units:'1',target,valid_from:from,valid_to:to});
async function planned(name,changes,label='A',scope=state.scope[label],unit=state.units[label]){if(!state.requests[name]){state.requests[name]={scope,unit,request_key:randomUUID(),changes,reason:'Synthetic occupancy QA change',source_kind:'document',source_reference:'DEV-03 occupancy QA',known_from:state.dates.today,history_note:'Synthetic count known only from supplied registry date; no earlier history or legal exemption'};await persist();}return clients[label].rpc('apply_occupancy_changes',state.requests[name]);}
async function batch(name,changes,...rest){const ids=unwrap(await planned(name,changes,...rest));state.ids[name]=ids;await persist();return ids;}
async function check(name,fn){if(state.passed.includes(name)){console.log('RETAIN previous PASS: '+name);return;}await fn();state.passed.push(name);await persist();console.log('PASS: '+name);}
const review=(target=null,label='A',date=state.dates.today)=>clients[label].rpc('review_occupancy',{scope:state.scope[label],unit:state.units[label],target,as_of:date,note:'Synthetic occupancy declaration checked'});
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
try{
 for(const label of ['A','B','PENDING']){assert.match(process.env[`RLS_${label}_EMAIL`],/^rls-(a|b|pending)-[a-f0-9]+@propertyhub\.invalid$/);const c=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});clients[label]=c;unwrap(await c.auth.signInWithPassword({email:process.env[`RLS_${label}_EMAIL`],password:process.env[`RLS_${label}_PASSWORD`]}));}
 if(!state.sideEffectsBefore){state.sideEffectsBefore={};for(const label of ['A','B'])state.sideEffectsBefore[label]={ownershipHash:hash(unwrap(await clients[label].rpc('read_ownership',{scope:state.scope[label],unit:state.units[label],as_of:state.dates.today})).records),rolesHash:hash(unwrap(await clients[label].from('user_roles').select('id').order('id')))};await persist();}
 await check('missing and unknown count remain null; unknown row and set review denied',async()=>{
  const before=unwrap(await read());assert.equal(before.count_value,null);assert.equal(before.applicable_count,0);
  const ids=await batch('unknown',[aggregate(null)]);const data=unwrap(await read());assert.equal(data.count_value,null);assert.equal(data.unknown_count,1);await deny(review(ids[0]));await deny(review());
 });
 await check('explicit zero is not confirmed by default; row and set review, exact request replay',async()=>{
  const ids=await batch('zero',[aggregate('0',state.ids.unknown[0])]);assert.deepEqual(unwrap(await planned('zero',[])),ids);
  await deny(clients.A.rpc('apply_occupancy_changes',{...state.requests.zero,reason:'Different payload'}));
  assert.equal(unwrap(await read()).count_value,'0.0000');assert.equal(unwrap(await read()).set_reviewed,false);
  if(unwrap(await read()).records.find(r=>r.id===ids[0]).verification_status!=='verified')unwrap(await review(ids[0]));
  assert.equal(unwrap(await read()).set_reviewed,false);unwrap(await review());assert.equal(unwrap(await read()).set_reviewed,true);
 });
 await check('correction preserves zero/unknown originals and invalidates old review',async()=>{
  const ids=await batch('positive',[aggregate('2',state.ids.zero[0])]);const data=unwrap(await read());assert.equal(data.count_value,'2.0000');assert.equal(data.set_reviewed,false);
  assert.equal(data.records.find(r=>r.id===state.ids.zero[0]).verification_status,'verified');assert.equal(data.records.find(r=>r.id===state.ids.zero[0]).record_state,'superseded');assert.equal(data.records.find(r=>r.id===state.ids.unknown[0]).household_units,null);assert.equal(data.records.find(r=>r.id===ids[0]).verification_status,'needs_review');
  await deny(planned('stale',[aggregate('1',state.ids.zero[0])]));
 });
 await check('overlap, mixed modes, fractional counts and invalid correction roll back',async()=>{
  const before=unwrap(await read()).records.length;
  await deny(planned('mixed',[individual(state.persons.A[0])]));await deny(planned('duplicate-aggregate',[aggregate('1')]));
  for(const units of ['-1','0.5','100000000'])await deny(planned('invalid-count-'+units,[aggregate(units,state.ids.positive[0])]));
  await deny(planned('bad-period',[aggregate('1',state.ids.positive[0],state.dates.tomorrow,state.dates.today)]));
  assert.equal(unwrap(await read()).records.length,before);assert.equal(unwrap(await read()).records.find(r=>r.id===state.ids.positive[0]).record_state,'current');
 });
 await check('atomic mode switch and same-person owner/user/tenant deduplication',async()=>{
  const ids=await batch('individuals',[{target:state.ids.positive[0],void:true},individual(state.persons.A[0],'owner_resident'),individual(state.persons.A[1],'right_of_use_resident')]);
  assert.equal(unwrap(await read()).count_value,'2.0000');await deny(planned('same-person-tenant',[individual(state.persons.A[0],'tenant_resident')]));await deny(planned('individual-zero',[{...individual(state.persons.A[0]),units:'0'}]));
  assert.equal(unwrap(await read()).records.filter(r=>r.record_state==='current').length,2);for(const target of ids)if(unwrap(await read()).records.find(r=>r.id===target).verification_status!=='verified')unwrap(await review(target));unwrap(await review());assert.equal(unwrap(await read()).set_reviewed,true);
 });
 await check('half-open adjacency, future unknown and immutable history',async()=>{
  const ids=await batch('split',[individual(state.persons.A[0],'owner_resident',state.ids.individuals[0],state.dates.today,state.dates.tomorrow),individual(state.persons.A[1],'right_of_use_resident',state.ids.individuals[1],state.dates.today,state.dates.tomorrow),aggregate(null,null,state.dates.tomorrow)]);
  assert.equal(unwrap(await read()).count_value,'2.0000');assert.equal(unwrap(await read('A',state.dates.tomorrow)).count_value,null);assert.equal(unwrap(await read()).records.find(r=>r.id===ids[0]).valid_to,state.dates.tomorrow);assert.equal(unwrap(await read()).records.find(r=>r.id===state.ids.individuals[0]).record_state,'superseded');
 });
 await check('symmetric RLS, foreign same-org person, pending/direct metadata and anonymous refusals',async()=>{
  await batch('B-unknown',[aggregate(null)],'B');assert.equal(unwrap(await read('B')).count_value,null);
  for(const [label,s,u,p]of [['A',state.scope.B,state.units.B,state.persons.B[0]],['B',state.scope.A,state.units.A,state.persons.A[0]],['PENDING',state.scope.A,state.units.A,state.persons.A[0]]]){await deny(read(label,state.dates.today,s,u));await deny(planned('foreign-'+label,[individual(p)],label,s,u));}
  await deny(planned('foreign-person',[individual(state.persons.B[0])]));await deny(planned('same-org-wrong-scope-person',[individual(state.persons.extraA[0])]));
  assert.equal(unwrap(await clients.A.from('occupancy_periods').select('id').eq('scope_id',state.scope.B)).length,0);assert.equal(unwrap(await clients.PENDING.from('occupancy_periods').select('id')).length,0);
  await deny(clients.A.from('occupancy_periods').update({household_units:0,verification_status:'verified'}).eq('id',state.ids.split[0]));await deny(clients.A.from('occupancy_periods').delete().eq('id',state.ids.split[0]));await deny(clients.A.from('occupancy_set_reviews').insert({scope_id:state.scope.A,unit_id:state.units.A,note:'forged'}));
  const anon=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});await deny(anon.from('occupancy_periods').select('id'));await deny(anon.rpc('read_occupancy',{scope:state.scope.A,unit:state.units.A,as_of:state.dates.today}));
 });
 await check('concurrent aggregate/individual requests serialize without double counting',async()=>{
  await batch('void-for-race',state.ids.split.map(target=>({target,void:true})));
  const replies=await Promise.all([planned('race-aggregate',[aggregate('3')]),planned('race-individual',[individual(state.persons.A[0])])]);assert.equal(replies.filter(r=>!r.error).length,1);assert.equal(replies.filter(r=>r.error?.code==='23514').length,1);
  const data=unwrap(await read()),rows=data.records.filter(r=>r.record_state==='current');assert.equal(rows.length,1);assert.ok(['1.0000','3.0000'].includes(data.count_value));state.raceWinner=rows.map(r=>r.id);await persist();
 });
 await check('final individual fixture and no ownership/roles/portal side effects',async()=>{
  await batch('void-race',state.raceWinner.map(target=>({target,void:true})));
  const ids=await batch('final-people',[individual(state.persons.A[0],'owner_resident'),individual(state.persons.A[1],'right_of_use_resident')]);
  for(const target of ids)if(unwrap(await read()).records.find(r=>r.id===target).verification_status!=='verified')unwrap(await review(target));if(!unwrap(await read()).set_reviewed)unwrap(await review());assert.equal(unwrap(await read()).count_value,'2.0000');
  for(const label of ['A','B']){const own=unwrap(await clients[label].rpc('read_ownership',{scope:state.scope[label],unit:state.units[label],as_of:state.dates.today}));assert.equal(hash(own.records),state.sideEffectsBefore[label].ownershipHash);assert.equal(hash(unwrap(await clients[label].from('user_roles').select('id').order('id'))),state.sideEffectsBefore[label].rolesHash);}
  assert.equal(unwrap(await clients.PENDING.rpc('my_contexts')).length,0);assert.equal(unwrap(await clients.PENDING.from('user_roles').select('id')).length,0);
 });
 await writeFile(out+'/report.json',JSON.stringify({status:'PASS',groups:state.passed,auth:'Ordinary existing A/B/pending sessions + publishable key; anonymous denial separate',newAuthAccounts:0,ownershipAndRoles:'Before/after hashes unchanged; pending zero contexts/roles'},null,2));
}catch(error){await writeFile(out+'/failure.json',JSON.stringify({code:error.code||error.name,completed:state.passed,status:'FAIL'},null,2));console.error(`FAIL: occupancy API ${error.code||error.name}; sensitive details suppressed`);process.exitCode=1;}
finally{for(const c of Object.values(clients))await c.auth.signOut({scope:'local'});}
