import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {completeEvidence,resolutionPayload} from './financial-evidence-fixture.mjs';
import {rulePayload} from './financial-draft-fixture.mjs';
import {qualifiedGate} from './financial-activation-fixture.mjs';
import {allocatePersonal} from '../../src/domain/personal-allocation.js';
import {observedTransactionRace} from './financial-coowner-barrier.mjs';
const day=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const key=(run,k)=>{const h=createHash('sha256').update(run+':'+k).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);};
export function bindFinancialCoownerCases(adapter,{query,one,call,auth,config,t,clients}){
 let ctx,prefix='';const note=k=>ctx.j.marker+':'+prefix+k;
 async function rpc(k,name,p,who='A'){
  await auth(ctx,who);const params={...p};if('request_key'in params)params.request_key=key(ctx.j.run,prefix+k);if('note'in params)params.note=note(k);
  const prior=ctx.j.operations.findLast(o=>o.key===prefix+k);if(prior)assert(prior.name==='rpc'&&prior.args.rpc===name&&prior.args.actor===who,'Resume operation contract changed');
  const r=await ctx.write(prefix+k,'rpc',prior?.args??{marker:ctx.j.marker,actor:who,rpc:name,params});assert(!r.code&&r.status>=200&&r.status<300,'Required successful RPC failed: '+name+' / '+r.code);return r;
 }
 const read=async(who,name,p)=>{await auth(ctx,who);return call(who,name,p);};
 async function deny(who,name,p,code){const r=await read(who,name,p);assert.equal(r.code,code,'Expected server rejection, not configuration/transport failure');assert(r.status===403||r.status===400||r.status===409);return{status:r.status,code:r.code};}
 const fixture=()=>ctx.j.fixture;
 async function inputs(claim=fixture().claim){const r=await read('B','load_charge_batch_inputs_v2',{scope:fixture().scope,payload:claim});assert(!r.code,'Publication input precondition failed');return r.data.inputs;}
 const ack=x=>x.parties.map(p=>({unit_id:p.unit_id,person_id:p.person_id,person_revision:p.person_revision,ownership_id:p.ownership_id,evidence_reference:note('identity-source:'+p.person_id),ownership_regime:'ordinary_fractional',quota_representation:'exact_decimal',coowner_basis_kind:'reviewed_proportional_liability',proportionality_reason:note('explicit-personal-liability-L:'+p.person_id)}));
 async function draft(k,claim=fixture().claim){return(await rpc(k,'save_charge_batch_v2',{scope:fixture().scope,target:null,expected_revision:0,request_key:null,payload:claim,note:''})).id;}
 async function review(k,id,claim=fixture().claim,revision=1){const x=await inputs(claim);assert.deepEqual(x.gaps,[]);return rpc(k,'review_charge_batch_v2',{scope:fixture().scope,target:id,expected_revision:revision,request_key:null,acknowledged_parties:ack(x),note:''},'B');}
 const publishArgs=(id,k,revision=2)=>({scope:fixture().scope,target:id,expected_revision:revision,request_key:key(ctx.j.run,k),note:note(k)});
 async function publish(k,id){return rpc(k,'publish_charge_batch_v2',publishArgs(id,k),'B');}
 async function counts(){return one("select (select count(*) from public.charges where scope_id=$1)::int charges,(select count(*) from public.obligation_parties where scope_id=$1)::int parties,(select count(*) from public.charge_batches where scope_id=$1 and status='published')::int batches",[fixture().scope]);}
 async function verify(id){
  const b=await one('select * from public.charge_batches where id=$1 and scope_id=$2',[id,fixture().scope]);assert.equal(b.status,'published');const x=b.publication_snapshot.inputs;
  const charges=(await query('select id,unit_id,amount::text from public.charges where batch_id=$1 order by unit_id',[id])).rows;
  assert.equal(charges.length,4);assert.equal(charges.reduce((s,c)=>s+BigInt(c.amount.replace('.','')),0n),50003n);
  for(const c of charges){const parties=(await query('select person_id,assessed_amount::text,person_snapshot,party_basis from public.obligation_parties where charge_id=$1 order by person_id',[c.id])).rows;
   assert.equal(parties.reduce((s,p)=>s+BigInt(p.assessed_amount.replace('.','')),0n),BigInt(c.amount.replace('.','')));
   const source=x.parties.filter(p=>p.unit_id===c.unit_id),oracle=allocatePersonal({unit_amount_cents:c.amount.replace('.',''),regime:'ordinary_fractional',expected_person_ids:source.map(p=>p.person_id),rows:source.map(p=>({person_id:p.person_id,ownership_fraction:p.fraction}))});
   assert.deepEqual(parties.map(p=>p.person_snapshot.personal_allocation),oracle.rows);assert(parties.every(p=>p.party_basis.payer_is_separate));
  }
  return{id,snapshot:b.publication_snapshot,charges};
 }
 adapter.setup=async c=>{
  ctx=c;await auth(ctx,'A');await auth(ctx,'B');ctx.j.fixture??={M:ctx.j.preflight.day,units:[],persons:[]};await ctx.save();const f=fixture(),M=f.M;
  const request=(await rpc('scope-request','request_scope_setup',{org:config.org_id,target_auth_user_id:config.actors.A.auth_id,label:note('isolated-scope')})).id;
  f.scope=(await rpc('scope-complete','complete_scope_setup',{request_id:request,address:note('synthetic-building'),entrance_code:null,source_kind:'document',source_reference:note('scope-source'),known_from:M})).id;await ctx.save();
  const initial=await one("select id from public.user_roles where scope_id=$1 and profile_id=$2 and role_code='manager' and valid_to is null",[f.scope,config.actors.A.profile_id]);
  const captured=ctx.j.operations.find(o=>o.key===prefix+'capture-initial');if(initial&&!captured)await ctx.write(prefix+'capture-initial','capture-generated',{marker:ctx.j.marker,id:initial.id,scope_id:f.scope});
  const initialId=captured?.result?.id??initial?.id;if(initialId)await rpc('revoke-initial','revoke_staff_role',{role_id:initialId});
  f.aRole=(await rpc('grant-A','assign_staff_role',{org:config.org_id,target_auth_user_id:config.actors.A.auth_id,scope:f.scope,role:'manager',permissions:['read_registry','manage_registry','prepare_rules','prepare_charges','correct_finance']})).id;
  f.bRole=(await rpc('grant-B','assign_staff_role',{org:config.org_id,target_auth_user_id:config.actors.B.auth_id,scope:f.scope,role:'manager',permissions:['publish_rules','publish_charges','correct_finance']})).id;await ctx.save();
  for(let i=0;i<4;i++){f.units[i]=(await rpc('unit-'+i,'create_unit',{scope:f.scope,unit_number:'B2-'+ctx.j.run.slice(0,8)+'-'+i,unit_type:'apartment',source_kind:'document',source_reference:note('unit-'+i),known_from:M})).id;await ctx.save();}
  // No fabricated historic periods: M is today's supplied synthetic decision; actual membership must cover it.
  for(const unit of f.units)assert((await one("select count(*)::int n from public.unit_scope_periods where scope_id=$1 and unit_id=$2 and daterange(valid_from,valid_to,'[)')@>$3::date",[f.scope,unit,M])).n===1,'Synthetic decision date is outside actual supplied membership');
  for(let i=0;i<5;i++){f.persons[i]=(await rpc('person-'+i,'save_scoped_person',{scope:f.scope,target:null,expected_revision:0,person_kind:'physical',display_name:note('person-'+i),contact_email:null,contact_phone:null,status:'active',source_kind:'document',source_reference:note('person-'+i),known_from:M})).id;await rpc('verify-person-'+i,'verify_scoped_person',{scope:f.scope,target:f.persons[i],expected_revision:1,note:''});await ctx.save();}
  f.ownership??=[];for(let i=0;i<4;i++){
   const rows=i===0?[[0,'0.6'],[4,'0.4']]:i===1?[[1,'0.5'],[4,'0.5']]:[[i,'1']];
   const r=await rpc('ownership-'+i,'apply_ownership_changes',{scope:f.scope,unit:f.units[i],request_key:null,changes:rows.map(([n,fraction])=>({person_id:f.persons[n],fraction,valid_from:M,valid_to:null})),reason:note('full-explicit-interval-'+i),source_kind:'document',source_reference:note('ownership-'+i),known_from:M,history_note:'Explicit synthetic supplied interval; not actual client history'});f.ownership[i]=r.data;
   for(const id of r.data)await rpc('verify-owner-'+id,'review_ownership',{scope:f.scope,unit:f.units[i],target:id,as_of:M,note:''});await rpc('review-set-'+i,'review_ownership',{scope:f.scope,unit:f.units[i],target:null,as_of:M,note:''});await ctx.save();
  }
  const building=(await one('select building_id from public.management_units where id=$1',[f.scope])).building_id;
  const packet={kind:'building',building_id:building,entrance_id:null,common_parts_reference:note('building-only'),participants_reference:note('four-unit-roster'),source_kind:'document',source_reference:note('share-source'),known_from:M,history_note:'Synthetic supplied source',valid_from:M,valid_to:day(M,30),unit_ids:f.units,rows:f.units.map(unit_id=>({unit_id,percentage:'25',valid_from:M,valid_to:day(M,30),source_kind:'document',source_reference:note('quarter-share'),known_from:M,history_note:'Explicit exact share'}))};
  f.share=(await rpc('save-shares','save_unit_share_set',{scope:f.scope,target:null,expected_revision:0,request_key:null,payload:packet,note:''})).data;
  const share=await one('select packet from public.unit_share_versions where id=$1',[f.share.version_id]);await rpc('verify-shares','verify_unit_share_set',{scope:f.scope,version_id:f.share.version_id,expected_revision:1,as_of:M,basis_reference:note('denominator'),participants_reference:note('full-roster'),row_ids:share.packet.rows.map(r=>r.id),note:''});
  f.basis=(await rpc('basis','save_financial_resolution',{scope:f.scope,target:null,expected_revision:0,payload:{...resolutionPayload(),title:note('synthetic-major-repair'),reference:note('protocol'),meeting_date:M,effective_from:M,effective_to:day(M,40),known_from:M,source_reference:note('basis-source')},note:''})).id;
  await rpc('basis-evidence','save_financial_basis_evidence',{scope:f.scope,target:f.basis,expected_revision:1,payload:{...completeEvidence(f.units[0]),unit_ids:f.units,approved_cost:'800.03',target_collection:'500.03',funds_as_of:M,due_on:day(M,14),participants_reference:note('complete-four-units'),evidence_reference:note('clearly-synthetic-protocol')},note:''});
  await rpc('qualification','save_financial_applicability',{scope:f.scope,target:f.basis,expected_revision:2,payload:qualifiedGate(),note:''});await rpc('basis-review','review_financial_basis',{scope:f.scope,target:f.basis,expected_revision:3,outcome:'reviewed',note:''},'B');
  const rule=(await rpc('rule','save_financial_rule',{scope:f.scope,target:null,expected_revision:0,payload:{...rulePayload(f.basis),valid_from:M,valid_to:day(M,30)},note:''})).id;
  f.active=(await rpc('activate','activate_financial_rule',{scope:f.scope,target:rule,expected_revision:1,basis_revision:4,request_key:null,supersedes:null,note:''},'B')).id;
  f.selection={rule_id:f.active,share_version_id:f.share.version_id,reference_date:M};f.preview=await newPreview('preview');
  f.claim={preview_id:f.preview,liability_date:M,liability_event:note('explicit-event-at-L'),legal_reference:note('motivated-personal-proportion-not-legal-certification'),evidence_reference:note('identity-title-protocol'),creditor_reference:note('condominium-creditor'),replaces_batch_id:null,publication_model:'ordinary-coowner-v1'};await ctx.save();
 };
 async function newPreview(k){const f=fixture(),x=await read('A','load_financial_preview_inputs',{scope:f.scope,payload:f.selection});assert(!x.code);return(await rpc(k,'create_financial_preview',{scope:f.scope,payload:f.selection,expected_token:x.data.input_token,request_key:null,note:''})).id;}
 adapter.assertions=async c=>{
  ctx=c;await auth(ctx,'A');await auth(ctx,'B');const f=fixture(),checks=[];f.caseProgress??={};const done=async(id,evidence)=>{const item={id,pass:true,evidence};checks.push(item);f.caseProgress[id]=item;await ctx.save();};
  if(!f.ownershipGatesDone){
   const change=async(k,target,fraction,from)=>(await rpc(k,'apply_ownership_changes',{scope:f.scope,unit:f.units[0],request_key:null,changes:[{target,person_id:f.persons[0],fraction,valid_from:from,valid_to:null}],reason:note(k),source_kind:'document',source_reference:note(k),known_from:f.M,history_note:'Synthetic invalid-context probe; retained corrections'})).data[0];
   const partial=await change('gate-incomplete',f.ownership[0][0],'0.3',f.M);await deny('A','load_financial_preview_inputs',{scope:f.scope,payload:f.selection},'23514');
   const period=await change('gate-period',partial,'0.6',day(f.M,1));await deny('A','load_financial_preview_inputs',{scope:f.scope,payload:f.selection},'23514');
   const restored=await change('gate-restored',period,'0.6',f.M);await rpc('gate-verify-restored','review_ownership',{scope:f.scope,unit:f.units[0],target:restored,as_of:f.M,note:''});await rpc('gate-review-restored','review_ownership',{scope:f.scope,unit:f.units[0],target:null,as_of:f.M,note:''});
   f.ownership[0][0]=restored;f.preview=await newPreview('after-gates-preview');f.claim={...f.claim,preview_id:f.preview};f.ownershipGatesDone=true;await ctx.save();
  }
  // All mutable probes are journaled. Read-only denial probes cannot mutate a foreign scope.
  if(!f.caseProgress.positive){f.original=await draft('positive-draft');await review('positive-review',f.original);await publish('positive-publish',f.original);f.originalProof=await verify(f.original);await done('positive',{batch:f.original,unitCount:4,total:'50003'});}else checks.push(f.caseProgress.positive);
  f.negativeBaseline??=await counts();const before=f.negativeBaseline;
  if(!f.caseProgress.denials){await deny('A','load_charge_batch_inputs_v2',{scope:config.foreign_scope_id,payload:f.claim},'42501');
  for(const field of ['amount','parties']){const p={...f.claim,[field]:field==='amount'?'1':[]};const r=await ctx.write('forged-'+field,'rpc',{marker:ctx.j.marker,actor:'A',rpc:'save_charge_batch_v2',params:{scope:f.scope,target:null,expected_revision:0,request_key:key(ctx.j.run,'forged-'+field),payload:p,note:note('forged-'+field)}});assert.equal(r.code,'23514');}
  const blocked=await draft('unsupported-draft');for(const mode of ['joint_marital','disputed']){const rows=ack(await inputs());rows[0].ownership_regime=mode;const r=await ctx.write('unsupported-'+mode,'rpc',{marker:ctx.j.marker,actor:'B',rpc:'review_charge_batch_v2',params:{scope:f.scope,target:blocked,expected_revision:1,request_key:key(ctx.j.run,mode),acknowledged_parties:rows,note:note(mode)}});assert.equal(r.code,'23514');}
  const forged=ack(await inputs());forged[0].person_id=config.actors.B.profile_id;const bad=await ctx.write('forged-person','rpc',{marker:ctx.j.marker,actor:'B',rpc:'review_charge_batch_v2',params:{scope:f.scope,target:blocked,expected_revision:1,request_key:key(ctx.j.run,'forged-person'),acknowledged_parties:forged,note:note('forged-person')}});assert.equal(bad.code,'23514');assert.deepEqual(await counts(),before);await done('denials',{noPartial:true});}else checks.push(f.caseProgress.denials);
  if(!f.caseProgress['stale-revoke']){
  const reviewDraft=await draft('stale-draft');await review('stale-review',reviewDraft);const stale=await ctx.write('stale-revision','rpc',{marker:ctx.j.marker,actor:'B',rpc:'publish_charge_batch_v2',params:publishArgs(reviewDraft,'stale-revision',1)});assert.equal(stale.status,409);assert.equal(stale.code,'PT409');
  await rpc('stale-source-review','review_ownership',{scope:f.scope,unit:f.units[0],target:null,as_of:f.M,note:''});
  const staleSource=await ctx.write('stale-source-publish','rpc',{marker:ctx.j.marker,actor:'B',rpc:'publish_charge_batch_v2',params:publishArgs(reviewDraft,'stale-source-publish')});assert.equal(staleSource.code,'PT409');assert(['charge_preview_inputs_changed','charge_inputs_changed_reload'].includes(staleSource.errorName),'Unrelated duplicate/configuration refusal is not stale-input proof');
  f.preview=await newPreview('after-stale-source-preview');f.claim={...f.claim,preview_id:f.preview};await ctx.save();
  const jwt=(await clients.B.client.auth.getSession()).data.session.access_token;await rpc('revoke-B','revoke_staff_role',{role_id:f.bRole});const revoked=await ctx.write('same-session-denial','rpc',{marker:ctx.j.marker,actor:'B',rpc:'publish_charge_batch_v2',params:publishArgs(reviewDraft,'same-session-denial')});assert.equal(revoked.code,'42501');assert((await clients.B.client.auth.getSession()).data.session.access_token===jwt,'JWT must remain unchanged; do not refresh');
  assert.equal(revoked.jwt_fingerprint,ctx.j.operations.find(o=>o.key==='stale-review').result.jwt_fingerprint,'Interrupted JWT window is UNPROVEN; do not reuse a fresh token as same-JWT evidence');
  f.bRole=(await rpc('restore-run-B','assign_staff_role',{org:config.org_id,target_auth_user_id:config.actors.B.auth_id,scope:f.scope,role:'manager',permissions:['publish_rules','publish_charges','correct_finance']})).id;await done('stale-revoke',{stale409:true,sameJWT:true});}else checks.push(f.caseProgress['stale-revoke']);
  if(!f.caseProgress.duplicates){
  const p=publishArgs(f.original,'positive-publish');const replay=await ctx.write('replay-HTTP','rpc',{marker:ctx.j.marker,actor:'B',rpc:'publish_charge_batch_v2',params:p});assert.equal(replay.id,f.original);
  const duplicate=await draft('duplicate-draft');await review('duplicate-review',duplicate);const r=await ctx.write('duplicate-publish','rpc',{marker:ctx.j.marker,actor:'B',rpc:'publish_charge_batch_v2',params:publishArgs(duplicate,'duplicate-publish')});assert.equal(r.code,'PT409');assert.deepEqual(await counts(),before);await done('duplicates',{sameKey:true,differentKey:true});}else checks.push(f.caseProgress.duplicates);
  if(!f.caseProgress.correction){f.corrected=await correction('correction',f.original);await publish('correction-publish',f.corrected);await verify(f.corrected);const reversed=await one('select id from public.charge_batches where reverses_id=$1',[f.original]);assert(reversed);assert.equal((await one('select count(*)::int n from public.obligation_parties p join public.charges c on c.id=p.charge_id where c.batch_id=$1',[reversed.id] )).n,f.originalProof.snapshot.inputs.parties.length);await done('correction',{replacement:f.corrected,reversal:reversed.id});}else checks.push(f.caseProgress.correction);
  if(!f.caseProgress.legacy){const legacy=await read('B','charge_batch_feed',{});assert(!legacy.code,'Legacy feed failed: '+legacy.code+' / '+legacy.errorName);assert(!legacy.data.batches.some(b=>b.id===f.original));await ctx.verifyBaseline();await done('legacy',{AUnchanged:true,legacyHidesB:true});}else checks.push(f.caseProgress.legacy);return checks;
 };
 async function correction(k,replaces){const claim={...fixture().claim,replaces_batch_id:replaces,evidence_reference:note(k+'-new-personal-evidence')},id=await draft(k+'-draft',claim);await review(k+'-review',id,claim);return id;}
 const nativeCall=(connection,name,params)=>connection.query(`select public.${name}(${Object.keys(params).map((n,i)=>'"'+n+'"=>$'+(i+1)).join(',')}) id`,Object.values(params));
 adapter.mvcc=async c=>{
  ctx=c;await auth(ctx,'A');await auth(ctx,'B');ctx.j.primaryFixture??=fixture();ctx.j.mvccProgress??={};const f=ctx.j.primaryFixture,results=[];
  adapter.executeRace=async(j,op)=>{
   const p=op.args,active=fixture();
   const barrier=await observedTransactionRace({connect:t.connect,holderClaims:clients.B.claims,contenderClaims:p.race==='publish-input'?clients.A.claims:clients.B.claims,
    holderAction:h=>nativeCall(h,'publish_charge_batch_v2',publishArgs(p.a,p.race+'-a')),
    contenderAction:h=>p.race==='publish-input'?nativeCall(h,'review_ownership',{scope:active.scope,unit:active.units[0],target:null,as_of:active.M,note:note(p.race+'-writer')}):nativeCall(h,'publish_charge_batch_v2',publishArgs(p.b,p.race+'-b')),
    onObserved:async proof=>{op.barrierProof=proof;await ctx.save();}});
   const result={id:p.a,status:200,data:barrier};op.completedNative=result;await ctx.save();return result;
  };
  const run=async(id,a,b)=>{
   const r=await ctx.write('native-'+id+':'+fixture().scope,'native-race',{marker:ctx.j.marker,race:id,scope_id:fixture().scope,a,b});await verify(a);assert(r.data.pass);if(id==='publish-input')assert(r.data.contender.ok);else{assert(!r.data.contender.ok);assert.equal(r.data.contender.code,'PT409');}return{id,pass:true,invariants:true,barrier:r.data};
  };
  if(!ctx.j.mvccProgress['publish-publish']){
   if(!ctx.j.raceFixture){
    if(!ctx.j.buildingRaceFixture){ctx.j.fixture={M:ctx.j.preflight.day,units:[],persons:[]};ctx.j.buildingRaceFixture=true;await ctx.save();}
    prefix='mvcc-original-';await adapter.setup(ctx);ctx.j.raceFixture=fixture();ctx.j.buildingRaceFixture=false;prefix='';await ctx.save();
   }
   ctx.j.fixture=ctx.j.raceFixture;await ctx.save();const a=await draft('original-race-a'),b=await draft('original-race-b');await review('original-review-a',a);await review('original-review-b',b);
   ctx.j.mvccProgress['publish-publish']=await run('publish-publish',a,b);await ctx.save();
  }
  results.push(ctx.j.mvccProgress['publish-publish']);ctx.j.fixture=f;await ctx.save();
  const a=await correction('input-race',f.corrected);
  if(!ctx.j.mvccProgress['publish-input']){ctx.j.mvccProgress['publish-input']=await run('publish-input',a,null);await ctx.save();}results.push(ctx.j.mvccProgress['publish-input']);
  // The writer changes the exact source review. Explicitly reload into NEW previews/reviews before another correction.
  f.preview=await newPreview('after-writer-preview');f.claim={...f.claim,preview_id:f.preview};
  const c1=await correction('unpaid-race1',a),c2=await correction('unpaid-race2',a);
  if(!ctx.j.mvccProgress['unpaid-correction']){ctx.j.mvccProgress['unpaid-correction']=await run('unpaid-correction',c1,c2);await ctx.save();}results.push(ctx.j.mvccProgress['unpaid-correction']);await ctx.save();return results;
 };
 adapter.beginCleanup=async c=>{ctx=c;await auth(ctx,'A');};
}
