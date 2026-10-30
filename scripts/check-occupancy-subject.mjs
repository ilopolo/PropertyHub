import assert from 'node:assert/strict';
import {loadEnvFile} from 'node:process';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
loadEnvFile('.env.local');loadEnvFile('.env.rls.local');assert.match(process.env.RLS_A_EMAIL,/^rls-a-[a-f0-9]+@propertyhub\.invalid$/);
const fixture=JSON.parse(await readFile('.local/occupancy-qa/state.json','utf8')),file='.local/occupancy-qa/subject-state.json';
let state;try{state=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state={phase:0,requests:{}};}
const c=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const unwrap=({data,error})=>{if(error)throw Object.assign(new Error('API '+error.code),{code:error.code});return data;};
const save=()=>writeFile(file,JSON.stringify(state,null,2));
const ref='DEV-03 occupancy subject QA',scope=fixture.scope.A,unit=fixture.units.A,today=fixture.dates.today;
const read=async()=>unwrap(await c.rpc('read_occupancy',{scope,unit,as_of:today}));
const person=async()=>unwrap(await c.from('persons').select('*').eq('id',state.person).single());
const changePerson=async(kind,name,status='active')=>{const p=await person();return unwrap(await c.rpc('save_scoped_person',{scope,target:p.id,expected_revision:p.revision,person_kind:kind,display_name:name,contact_email:null,contact_phone:null,status,source_kind:'document',source_reference:ref,known_from:today}));};
const row=target=>({target:target||null,count_mode:'individual',occupant_kind:'other_resident',person_id:state.person,units:'1',valid_from:today,valid_to:null});
async function batch(name,changes){if(!state.requests[name]){state.requests[name]={scope,unit,request_key:randomUUID(),changes,reason:'Synthetic subject evidence guard QA',source_kind:'document',source_reference:ref,known_from:today,history_note:'Synthetic physical subject fixture only; no legal exemption or earlier history'};await save();}return c.rpc('apply_occupancy_changes',state.requests[name]);}
const review=async target=>unwrap(await c.rpc('review_occupancy',{scope,unit,target,as_of:today,note:'Synthetic subject evidence checked'}));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
try{
 unwrap(await c.auth.signInWithPassword({email:process.env.RLS_A_EMAIL,password:process.env.RLS_A_PASSWORD}));
 if(state.phase===0){
  state.baseIds=(await read()).records.filter(r=>r.record_state==='current').map(r=>r.id).sort();
  state.ownershipHash=hash(unwrap(await c.rpc('read_ownership',{scope,unit,as_of:today})).records);await save();
  // Existing legal fixture has no unit in its scope. One new scoped QA person avoids changing existing persons.
  const found=unwrap(await c.from('persons').select('id').eq('scope_id',scope).eq('source_reference',ref));assert.ok(found.length<=1);
  state.person=found[0]?.id||unwrap(await c.rpc('save_scoped_person',{scope,target:null,expected_revision:0,person_kind:'legal',display_name:'Synthetic occupancy subject QA',contact_email:null,contact_phone:null,status:'active',source_kind:'document',source_reference:ref,known_from:today}));state.phase=1;await save();
 }
 if(state.phase===1){const refused=await batch('legal-refused',[row()]);assert.equal(refused.error?.code,'23514');assert.ok(refused.error.message.includes('Physical person'));const p=await person();if(p.person_kind!=='physical')await changePerson('physical','Synthetic occupancy subject QA physical');state.phase=2;await save();}
 if(state.phase===2){state.first=unwrap(await batch('physical',[row()]))[0];await save();const current=(await read()).records.find(r=>r.id===state.first);if(current.verification_status!=='verified')await review(state.first);if(!(await read()).set_reviewed)await review(null);assert.equal((await read()).count_value,'3.0000');state.phase=3;await save();}
 if(state.phase===3){const p=await person();if(p.display_name!=='Synthetic occupancy subject QA revised')await changePerson('physical','Synthetic occupancy subject QA revised');state.phase=4;await save();}
 if(state.phase===4){
  let data=await read();assert.equal(data.subject_conflict_count,1);assert.equal(data.set_reviewed,false);
  assert.equal((await c.rpc('review_occupancy',{scope,unit,target:state.first,as_of:today,note:'Stale subject'})).error?.code,'23514');
  assert.equal((await c.rpc('review_occupancy',{scope,unit,target:null,as_of:today,note:'Stale set'})).error?.code,'23514');
  state.corrected=unwrap(await batch('fresh-evidence',[row(state.first)]))[0];await save();if((await read()).records.find(r=>r.id===state.corrected).verification_status!=='verified')await review(state.corrected);if(!(await read()).set_reviewed)await review(null);assert.equal((await read()).subject_conflict_count,0);state.phase=5;await save();
 }
 if(state.phase===5){unwrap(await batch('void-auxiliary',[{target:state.corrected,void:true}]));const p=await person();if(p.status!=='inactive')await changePerson('physical','Synthetic occupancy subject QA revised','inactive');if(!(await read()).set_reviewed)await review(null);state.phase=6;await save();}
 const data=await read();assert.equal(data.count_value,'2.0000');assert.equal(data.set_reviewed,true);assert.deepEqual(data.records.filter(r=>r.record_state==='current').map(r=>r.id).sort(),state.baseIds);
 assert.equal(hash(unwrap(await c.rpc('read_ownership',{scope,unit,as_of:today})).records),state.ownershipHash);
 await writeFile('.local/occupancy-qa/subject-report.json',JSON.stringify({status:'PASS',legalIndividualRejected:true,subjectRevisionInvalidatesReview:true,staleReviewDenied:true,freshCorrectionRestoresReview:true,cleanup:'Only two auxiliary occupancy facts retired; original current set unchanged, auxiliary QA person inactive',newScopedQAPersons:1,newAuthAccounts:0,ownershipHashUnchanged:true},null,2));console.log('PASS: legal subject refused, changed identity evidence invalidates review, fresh correction restores it; original current occupancy/ownership preserved.');
}catch(error){console.error(`FAIL: occupancy subject QA phase${state.phase} ${error.code||error.name}; sensitive details suppressed`);process.exitCode=1;}
finally{await c.auth.signOut({scope:'local'});}
