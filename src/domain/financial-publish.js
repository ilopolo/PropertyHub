import {registryDate} from './registry.js';
import {previewNote} from './financial-preview.js';
const uuid=v=>typeof v==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const id=v=>{if(!uuid(v))throw Error('Нужен е точен идентификатор.');return v.toLowerCase();};
export function chargeClaim(p){
 const keys=['preview_id','liability_date','liability_event','legal_reference','evidence_reference','creditor_reference','replaces_batch_id','publication_model'];
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!keys.includes(k)))throw Error('Непозволени полета за публикуване.');
 const result={preview_id:id(p.preview_id),liability_date:p.liability_date?registryDate(p.liability_date):null,replaces_batch_id:p.replaces_batch_id?id(p.replaces_batch_id):null};
 for(const k of keys.slice(2,6))result[k]=p[k]==null||p[k]===''?null:previewNote(p[k]);
 if(p.publication_model!=null){
  if(!['sole-owner-v1','ordinary-coowner-v1','monthly-owner-occupant-v1'].includes(p.publication_model))throw Error('Неподдържан режим на публикуване.');
  if(p.publication_model!=='sole-owner-v1')result.publication_model=p.publication_model;
 }
 return result;
}
export function chargePartyReview(rows){
 if(!Array.isArray(rows)||!rows.length)throw Error('Прегледай изрично всеки личен длъжник.');
 const seen=new Set();return rows.map(p=>{
  const extra=['ownership_regime','quota_representation','coowner_basis_kind','proportionality_reason'];
  if(!p||Object.keys(p).some(k=>!['unit_id','person_id','person_revision','ownership_id','evidence_reference',...extra].includes(k)))throw Error('Непозволени данни за длъжник.');
  const unit_id=id(p.unit_id),person_id=id(p.person_id),key=unit_id+':'+person_id;
  if(seen.has(key)||!Number.isSafeInteger(p.person_revision)||p.person_revision<1)throw Error('Повторено лице за обекта или невалидна редакция.');seen.add(key);
  const result={unit_id,person_id,person_revision:p.person_revision,ownership_id:id(p.ownership_id),evidence_reference:previewNote(p.evidence_reference)};
  if(extra.some(k=>k in p)){
   if(p.ownership_regime!=='ordinary_fractional'||p.quota_representation!=='exact_decimal'||p.coowner_basis_kind!=='reviewed_proportional_liability')throw Error('Неподдържана съсобственост или представяне на квотите.');
   Object.assign(result,{ownership_regime:p.ownership_regime,quota_representation:p.quota_representation,coowner_basis_kind:p.coowner_basis_kind,proportionality_reason:previewNote(p.proportionality_reason)});
  }
  return result;
 });
}
