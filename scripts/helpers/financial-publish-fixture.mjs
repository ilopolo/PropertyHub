// Disposable local PostgreSQL only. Synthetic histories explicitly cover M..T; no hosted fixtures are touched.
import {randomUUID} from 'node:crypto';
import {financialActivationFixture} from './financial-activation-fixture.mjs';
export async function financialPublishFixture(){
 const f=await financialActivationFixture();
 try{
  // Deterministic server civil day in this disposable database only; production has no clock override.
  await f.db.exec("create or replace function private.charge_publication_day() returns date language sql volatile set search_path='' as $$select date '2026-11-03'$$");
  f.today=(await f.db.query('select private.charge_publication_day()::text d')).rows[0].d;
  const old=(await f.as('A',"select id from public.user_roles where scope_id=$1 and role_code='manager' and valid_to is null",[f.scope.A])).rows[0].id;
  await f.as('orgA','select public.revoke_staff_role($1)',[old]);
  f.preparerRole=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['read_registry','manage_registry','prepare_rules','prepare_charges']) id",[f.org.A,f.auth.A,f.scope.A])).rows[0].id;
  await f.as('orgA','select public.revoke_staff_role($1)',[f.reviewerRole]);
  f.publisherRole=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['publish_rules','publish_charges','correct_finance']) id",[f.org.A,f.auth.doc,f.scope.A])).rows[0].id;
  // Explicit local historical scope coverage, supplied by this fixture rather than inherited from today's setup.
  await f.db.query("update public.unit_scope_periods set valid_from='2026-10-01' where scope_id=$1 and unit_id=any($2::uuid[])",[f.scope.A,f.units]);
  f.basisId=await f.basis({due:'2026-11-15'});f.draftId=await f.draft(f.basisId);
  f.active=(await f.as('doc',"select public.activate_financial_rule($1,$2,1,4,$3,null,'Synthetic publish prerequisite') id",[f.scope.A,f.draftId,randomUUID()])).rows[0].id;
  f.building=(await f.db.query('select building_id from public.management_units where id=$1',[f.scope.A])).rows[0].building_id;
  // Existing local ownership was dated only at fixture creation. Explicit correction records earlier supplied evidence.
  for(const unit of f.units){
   const current=(await f.db.query("select id from public.ownership_periods where unit_id=$1 and record_state='current'",[unit])).rows[0];
   const ids=(await f.as('A',"select public.apply_ownership_changes($1,$2,$3,$4,'Synthetic full supplied interval','document','Synthetic deed covers from 2026-10-01','2026-10-01','Explicit synthetic dated source; not inferred earlier history') ids",[f.scope.A,unit,randomUUID(),JSON.stringify([{...(current?{target:current.id}:{}),person_id:f.person.A,fraction:'1',valid_from:'2026-10-01',valid_to:null}])])).rows[0].ids;
   await f.as('A',"select public.review_ownership($1,$2,$3,$4,'Synthetic row source reviewed')",[f.scope.A,unit,ids[0],f.today]);
   await f.as('A',"select public.review_ownership($1,$2,null,'2026-11-02','Synthetic complete exact-date set')",[f.scope.A,unit]);
  }
  f.packet={kind:'building',building_id:f.building,entrance_id:null,common_parts_reference:'Synthetic building common parts',participants_reference:'Synthetic complete four-unit roster',source_kind:'document',source_reference:'Synthetic verified share source',known_from:'2026-11-02',history_note:'Only this synthetic period',valid_from:'2026-11-02',valid_to:'2026-12-01',unit_ids:f.units,rows:f.units.map((unit,i)=>({unit_id:unit,percentage:['33.33333333','33.33333333','16.66666667','16.66666667'][i],valid_from:'2026-11-02',valid_to:'2026-12-01',source_kind:'document',source_reference:'Synthetic share '+i,known_from:'2026-11-02',history_note:'Synthetic supplied coverage'}))};
  f.share=(await f.as('A',"select public.save_unit_share_set($1,null,0,$2,$3,'Synthetic explicit share set') x",[f.scope.A,randomUUID(),f.packet])).rows[0].x;
  const v=(await f.db.query('select packet from public.unit_share_versions where id=$1',[f.share.version_id])).rows[0].packet;
  await f.as('A',"select public.verify_unit_share_set($1,$2,1,'2026-11-02','Synthetic denominator checked','Synthetic full roster',$3,'Synthetic all source rows checked')",[f.scope.A,f.share.version_id,v.rows.map(r=>r.id)]);
  f.selection={rule_id:f.active,share_version_id:f.share.version_id,reference_date:'2026-11-02'};
  const x=(await f.as('A','select public.load_financial_preview_inputs($1,$2) x',[f.scope.A,f.selection])).rows[0].x;
  f.preview=(await f.as('A',"select public.create_financial_preview($1,$2,$3,$4,'Synthetic accepted calculation only') id",[f.scope.A,f.selection,x.input_token,randomUUID()])).rows[0].id;
  f.claim={preview_id:f.preview,liability_date:'2026-10-02',liability_event:'Synthetic explicit contribution obligation already arisen',legal_reference:'Synthetic case-specific basis review, not a legal certification',evidence_reference:'Synthetic exact protocol/deed packet v1',creditor_reference:'Synthetic condominium contribution, manager only as representative',replaces_batch_id:null};
  f.load=async(p=f.claim,who='A')=>(await f.as(who,'select public.load_charge_batch_inputs($1,$2) x',[f.scope.A,p])).rows[0].x;
  f.save=async(p=f.claim,target=null,revision=0,who='A')=>(await f.as(who,"select public.save_charge_batch($1,$2,$3,$4,$5,'Synthetic publication draft') id",[f.scope.A,target,revision,randomUUID(),p])).rows[0].id;
  f.acks=inputs=>inputs.parties.map(p=>({unit_id:p.unit_id,person_id:p.person_id,person_revision:p.person_revision,ownership_id:p.ownership_id,evidence_reference:'Synthetic explicit identity and personal-liability evidence for '+p.unit_number}));
  f.review=async(id,revision=1,who='doc')=>{const b=(await f.db.query('select claim from public.charge_batches where id=$1',[id])).rows[0];const x=await f.load(b.claim,who);return(await f.as(who,"select public.review_charge_batch($1,$2,$3,$4,$5,'Synthetic motivated party review') id",[f.scope.A,id,revision,randomUUID(),f.acks(x.inputs)])).rows[0].id;};
  f.publish=async(id,revision=2,key=randomUUID(),who='doc')=>(await f.as(who,"select public.publish_charge_batch($1,$2,$3,$4,'Synthetic explicit publication') id",[f.scope.A,id,revision,key])).rows[0].id;
  return f;
 }catch(e){await f.db.close();throw e;}
}
