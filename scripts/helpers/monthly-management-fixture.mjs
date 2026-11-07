// Isolated synthetic database. No hosted/demo/credential dependencies.
import {randomUUID} from 'node:crypto';
import {unitFileFixture} from './unit-file-fixture.mjs';
export async function monthlyManagementFixture(){
 const f=await unitFileFixture();try{
 // Preserve the first statement error in explicit local rollback cases; RESET ROLE may also
 // fail in an aborted transaction. The caller still owns the transaction and rolls it back.
 f.as=async(label,sql,args=[])=>{await f.db.exec('set role '+(label==='anon'?'anon':'authenticated'));await f.db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[f.auth[label]||'',JSON.stringify({sub:f.auth[label],session_id:f.session[label]})]);let failure;try{return await f.db.query(sql,args);}catch(e){failure=e;throw e;}finally{try{await f.db.exec('reset role');}catch(e){if(!failure)throw e;}}};
 await f.db.exec("create or replace function private.charge_publication_day() returns date language sql volatile set search_path='' as $$select date '2026-11-05'$$");
 f.units=[f.unit.A];for(let i=2;i<=4;i++)f.units.push((await f.as('A',"select public.create_unit($1,$2,'apartment',source_kind=>'document',source_reference=>'Synthetic apartment',known_from=>'2026-10-01') id",[f.scope.A,String(i+10)])).rows[0].id);
 await f.db.query("update public.unit_scope_periods set valid_from='2026-09-01' where scope_id=$1",[f.scope.A]);
 // Local fixture supplies actual interval evidence; it does not infer it from old QA rows.
 for(const uid of f.units){
  let person=f.person.A;
  if(uid!==f.unit.A){person=(await f.as('A',"select public.save_scoped_person($1,null,0,'physical',$2,null,null,'active','document','Synthetic separate identity','2026-10-01') id",[f.scope.A,'Synthetic monthly owner '+f.units.indexOf(uid)])).rows[0].id;await f.as('A',"select public.verify_scoped_person($1,$2,1,'Synthetic identity reviewed')",[f.scope.A,person]);}
  const old=(await f.db.query("select id from public.ownership_periods where unit_id=$1 and record_state='current'",[uid])).rows[0];
  const ids=(await f.as('A',"select public.apply_ownership_changes($1,$2,$3,$4,'Synthetic full month','document','Synthetic deed 2026-09-01','2026-10-01','Explicit full-month evidence') ids",[f.scope.A,uid,randomUUID(),[{...(old?{target:old.id}:{}),person_id:person,fraction:'1',valid_from:'2026-09-01',valid_to:null}]])).rows[0].ids;
  await f.as('A',"select public.review_ownership($1,$2,$3,'2026-10-31','Synthetic checked full month')",[f.scope.A,uid,ids[0]]);
  const sp=(await f.db.query('select id from public.unit_scope_periods where scope_id=$1 and unit_id=$2',[f.scope.A,uid])).rows[0].id;
  // Fixture-only insert with explicit supplied source, followed by the real guarded verification below.
  const subject=(await f.db.query('select revision,display_name from public.persons where id=$1',[person])).rows[0];
  const occupancy=(await f.db.query("insert into public.occupancy_periods(scope_id,unit_id,unit_scope_period_id,count_mode,occupant_kind,person_id,person_label,person_revision,household_units,valid_from,source_kind,source_reference,known_from,history_note,field_evidence,recorded_by) values($1,$2,$3,'individual','owner_resident',$4,$7,$6,1,'2026-09-01','document','Synthetic complete resident declaration','2026-10-01','Synthetic interval evidence','{}',$5) returning id",[f.scope.A,uid,sp,person,f.profile.A,subject.revision,subject.display_name])).rows[0].id;
  await f.as('A',"select public.review_occupancy($1,$2,$3,'2026-10-31','Synthetic checked complete residency')",[f.scope.A,uid,occupancy]);
 }
 f.month='2026-10-01';
 const prior=(await f.as('A',"select id from public.user_roles where scope_id=$1 and role_code='manager' and valid_to is null",[f.scope.A])).rows[0].id;
 await f.as('orgA','select public.revoke_staff_role($1)',[prior]);await f.as('orgA','select public.revoke_staff_role($1)',[f.docRole]);
 f.preparer=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['read_registry','manage_registry','prepare_rules','prepare_charges','correct_finance']) id",[f.org.A,f.auth.A,f.scope.A])).rows[0].id;
 f.publisher=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['publish_rules','publish_charges','correct_finance']) id",[f.org.A,f.auth.doc,f.scope.A])).rows[0].id;
 f.source={month_start:f.month,tariff:'20.01',meeting_date:'2026-09-15',due_on:'2026-11-15',known_from:'2026-10-01',title:'Synthetic monthly management',reference:'Synthetic assembly monthly tariff',source_reference:'Synthetic protocol',source_hash:'a'.repeat(64),method_reference:'Synthetic explicit equal-unit decision for October',applicability_reason:'Synthetic ordinary residential building; no special regime',quorum_reference:'Synthetic checked quorum',representation_reference:'Synthetic checked representation',votes_all_common_parts:'60',unchanged_reference:'Synthetic unchanged decision and roster for entire October',ordinary_housing_confirmed:true};
 f.context=async(who='A')=>(await f.as(who,'select public.load_monthly_context($1,$2) x',[f.scope.A,f.month])).rows[0].x;
 f.contextReview=async()=>{const x=await f.context();return(await f.as('A',"select public.review_monthly_context($1,$2,$3,'Synthetic complete units/owners/residents for entire October; no omitted occupants','Synthetic documentary interval review',$4) id",[f.scope.A,f.month,x.input_token,randomUUID()])).rows[0].id;};
 f.save=async(payload=f.source)=>(await f.as('A',"select public.save_monthly_management_rule($1,null,0,$2,$3,'Synthetic explicit monthly source') id",[f.scope.A,randomUUID(),payload])).rows[0].id;
 f.inputs=async(id,who='A')=>(await f.as(who,'select public.load_monthly_management_inputs($1,$2) x',[f.scope.A,id])).rows[0].x;
 f.activate=async(id)=>{const x=await f.inputs(id,'doc');return(await f.as('doc',"select public.activate_monthly_management_rule($1,$2,1,$3,$4,'Synthetic motivated method, rate, applicability, quorum and representation review') id",[f.scope.A,id,randomUUID(),x.input_token])).rows[0].id;};
 f.preview=async(id)=>{const x=await f.inputs(id);return(await f.as('A',"select public.create_monthly_management_preview($1,$2,$3,$4,'Synthetic accepted exact monthly preview') id",[f.scope.A,id,x.input_token,randomUUID()])).rows[0].id;};
 f.claim=preview_id=>({preview_id,liability_date:'2026-10-31',liability_event:'Synthetic separate personal liability at L',legal_reference:'Synthetic actual decision and individually reviewed obligation',evidence_reference:'Synthetic person-specific documentary review',creditor_reference:'Synthetic condominium',replaces_batch_id:null,publication_model:'monthly-owner-occupant-v1'});
 f.publish=async(claim)=>{const x=(await f.as('A','select public.load_charge_batch_inputs_v2($1,$2) x',[f.scope.A,claim])).rows[0].x;
  const id=(await f.as('A',"select public.save_charge_batch_v2($1,null,0,$2,$3,'Synthetic monthly draft') id",[f.scope.A,randomUUID(),claim])).rows[0].id;
  const acks=x.inputs.parties.map(p=>({unit_id:p.unit_id,person_id:p.person_id,person_revision:p.person_revision,ownership_id:p.ownership_id,evidence_reference:'Synthetic individual legal-liability review for '+p.unit_number}));
  await f.as('doc',"select public.review_charge_batch_v2($1,$2,1,$3,$4,'Synthetic personal basis reviewed for every row')",[f.scope.A,id,randomUUID(),acks]);
  const key=randomUUID();await f.as('doc',"select public.publish_charge_batch_v2($1,$2,2,$3,'Synthetic explicit monthly publication')",[f.scope.A,id,key]);return {id,key};};
 return f;
 }catch(e){await f.db.close();throw e;}
}
