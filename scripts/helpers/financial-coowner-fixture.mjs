// Disposable local database only; no hosted credentials, persistent demo or historic QA records.
import {randomUUID} from 'node:crypto';
import {financialPublishFixture} from './financial-publish-fixture.mjs';
export async function financialCoownerFixture(){
 const f=await financialPublishFixture();
 try{
  f.coowner=(await f.as('A',"select public.save_scoped_person($1,null,0,'physical','Synthetic B second owner',null,null,'active','document','Synthetic exact identity source','2026-10-01') id",[f.scope.A])).rows[0].id;
  f.load=async(p=f.claim,who='A')=>(await f.as(who,'select public.load_charge_batch_inputs_v2($1,$2) x',[f.scope.A,p])).rows[0].x;
  f.save=async(p=f.claim,target=null,revision=0,who='A')=>(await f.as(who,"select public.save_charge_batch_v2($1,$2,$3,$4,$5,'Synthetic B publication draft') id",[f.scope.A,target,revision,randomUUID(),p])).rows[0].id;
  f.review=async(id,revision=1,who='doc')=>{const b=(await f.db.query('select claim from public.charge_batches where id=$1',[id])).rows[0];const x=await f.load(b.claim,who);return(await f.as(who,"select public.review_charge_batch_v2($1,$2,$3,$4,$5,'Synthetic B motivated party review') id",[f.scope.A,id,revision,randomUUID(),f.acks(x.inputs)])).rows[0].id;};
  f.publish=async(id,revision=2,key=randomUUID(),who='doc')=>(await f.as(who,"select public.publish_charge_batch_v2($1,$2,$3,$4,'Synthetic B explicit publication') id",[f.scope.A,id,revision,key])).rows[0].id;
  await f.as('A',"select public.verify_scoped_person($1,$2,1,'Synthetic B identity reviewed')",[f.scope.A,f.coowner]);
  f.refreshPreview=async()=>{const x=(await f.as('A','select public.load_financial_preview_inputs($1,$2) x',[f.scope.A,f.selection])).rows[0].x;return(await f.as('A',"select public.create_financial_preview($1,$2,$3,$4,'Synthetic B fixed object preview') id",[f.scope.A,f.selection,x.input_token,randomUUID()])).rows[0].id;};
  f.changeOwners=async(changes)=>{
   const ids=(await f.as('A',"select public.apply_ownership_changes($1,$2,$3,$4,'Synthetic B exact source correction','document','Synthetic B deeds: ordinary fractions, exact decimals','2026-10-01','Explicit full interval; no inferred ownership') ids",[f.scope.A,f.units[0],randomUUID(),JSON.stringify(changes)])).rows[0].ids;
   for(const id of ids)await f.as('A',"select public.review_ownership($1,$2,$3,$4,'Synthetic B exact row checked')",[f.scope.A,f.units[0],id,f.today]);
   return ids;
  };
  const old=(await f.db.query("select id from public.ownership_periods where unit_id=$1 and record_state='current'",[f.units[0]])).rows[0].id;
  f.ownerIds=await f.changeOwners([{target:old,person_id:f.person.A,fraction:'0.5',valid_from:'2026-10-01',valid_to:null},{person_id:f.coowner,fraction:'0.5',valid_from:'2026-10-01',valid_to:null}]);
  f.reviewSets=async()=>{for(const unit of f.units)for(const day of ['2026-10-02','2026-11-02'])await f.as('A',"select public.review_ownership($1,$2,null,$3,'Synthetic B complete roster/source reviewed at exact date')",[f.scope.A,unit,day]);};
  await f.reviewSets();f.preview=await f.refreshPreview();f.claim={...f.claim,preview_id:f.preview,publication_model:'ordinary-coowner-v1'};
  const acks=f.acks;f.acks=x=>acks(x).map(p=>({...p,ownership_regime:'ordinary_fractional',quota_representation:'exact_decimal',coowner_basis_kind:'reviewed_proportional_liability',proportionality_reason:'Synthetic ordinary fractional title source + explicit FND-F05 personal liability at L; no solidarity or transfer'}));
  return f;
 }catch(e){await f.db.close();throw e;}
}
