import {percentageUnits,assessUnitShares} from './unit-shares.js';
import {registryDate,registryToday} from './registry.js';
const uuid=v=>typeof v==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const keys=(p,allowed)=>{if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!allowed.includes(k)))throw Error('Непозволено поле в набора.');};
const text=(v,max)=>{if(typeof v!=='string'||!v.trim()||[...v.trim()].length>max)throw Error('Попълни източника и ограниченията в допустимата дължина.');return v.trim();};
export const shareReason=v=>text(v,300);
const dates=p=>{const a=registryDate(p.valid_from),b=p.valid_to?registryDate(p.valid_to):null;if(b&&b<=a)throw Error('Невалиден период.');return{valid_from:a,valid_to:b};};
const provenance=p=>{if(!['document','declaration'].includes(p.source_kind)||registryDate(p.known_from)>registryToday())throw Error('Посочи допустим произход и дата.');return{source_kind:p.source_kind,source_reference:text(p.source_reference,200),known_from:registryDate(p.known_from),history_note:text(p.history_note,300)};};
export function shareCandidatePacket(p,key='candidate',revision=1){
 const basis={key,revision,kind:p.kind,building_id:p.building_id,entrance_id:p.entrance_id,verified:false};
 return{basis,participants:{basis:{...basis},revision,unit_ids:p.unit_ids,verified:false,...dates(p)},interval:dates(p),rows:p.rows.map((r,i)=>({...r,id:'candidate-'+i,basis:{...basis},participant_revision:revision,verification_status:'needs_review',record_state:'current'}))};
}
export function unitSharePacket(p){
 const fields=['kind','building_id','entrance_id','common_parts_reference','participants_reference','source_kind','source_reference','known_from','history_note','valid_from','valid_to','unit_ids','rows'];keys(p,fields);
 if(!['building','entrance'].includes(p.kind)||!uuid(p.building_id)||(p.kind==='building'&&p.entrance_id!=null)||(p.kind==='entrance'&&!uuid(p.entrance_id)))throw Error('Избери изричен физически знаменател.');
 if(!Array.isArray(p.unit_ids)||!p.unit_ids.length||p.unit_ids.length>1000||p.unit_ids.some(x=>!uuid(x))||new Set(p.unit_ids.map(x=>x.toLowerCase())).size!==p.unit_ids.length||!Array.isArray(p.rows)||p.rows.length>2000)throw Error('Невалиден или дублиран набор участници.');
 const out={kind:p.kind,building_id:p.building_id.toLowerCase(),entrance_id:p.entrance_id?.toLowerCase()??null,common_parts_reference:text(p.common_parts_reference,200),participants_reference:text(p.participants_reference,200),...provenance(p),...dates(p),unit_ids:p.unit_ids.map(x=>x.toLowerCase()),rows:[]};
 for(const r of p.rows){keys(r,['unit_id','percentage','valid_from','valid_to','source_kind','source_reference','known_from','history_note']);if(!uuid(r.unit_id))throw Error('Избери имот.');percentageUnits(r.percentage);const d=dates(r);if(d.valid_from<out.valid_from||(out.valid_to&&(!d.valid_to||d.valid_to>out.valid_to)))throw Error('Редът е извън установения период.');out.rows.push({unit_id:r.unit_id.toLowerCase(),percentage:r.percentage==null||r.percentage===''?null:r.percentage,...d,...provenance(r)});}
 const result=assessUnitShares(shareCandidatePacket(out));
 if(result.state==='conflict'||result.state==='wrong_basis')throw Error('Конфликт: дублиране, припокриване, грешен знаменател или сбор над100%.');
 return out;
}
export const assessPersistedShares=(version,review,current)=>assessUnitShares(current&&review?review.snapshot:version.packet);
