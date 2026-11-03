import {registryDate} from './registry.js';
import {previewNote} from './financial-preview.js';
const uuid=v=>typeof v==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const id=v=>{if(!uuid(v))throw Error('Нужен е точен идентификатор.');return v.toLowerCase();};
export function chargeClaim(p){
 const keys=['preview_id','liability_date','liability_event','legal_reference','evidence_reference','creditor_reference','replaces_batch_id'];
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!keys.includes(k)))throw Error('Непозволени полета за публикуване.');
 const result={preview_id:id(p.preview_id),liability_date:p.liability_date?registryDate(p.liability_date):null,replaces_batch_id:p.replaces_batch_id?id(p.replaces_batch_id):null};
 for(const k of keys.slice(2,6))result[k]=p[k]==null||p[k]===''?null:previewNote(p[k]);
 return result;
}
export function chargePartyReview(rows){
 if(!Array.isArray(rows)||!rows.length)throw Error('Прегледай изрично всеки личен длъжник.');
 const seen=new Set();return rows.map(p=>{
  if(!p||Object.keys(p).some(k=>!['unit_id','person_id','person_revision','ownership_id','evidence_reference'].includes(k)))throw Error('Непозволени данни за длъжник.');
  const unit_id=id(p.unit_id);if(seen.has(unit_id)||!Number.isSafeInteger(p.person_revision)||p.person_revision<1)throw Error('Повторен обект или невалидна редакция.');seen.add(unit_id);
  return{unit_id,person_id:id(p.person_id),person_revision:p.person_revision,ownership_id:id(p.ownership_id),evidence_reference:previewNote(p.evidence_reference)};
 });
}
