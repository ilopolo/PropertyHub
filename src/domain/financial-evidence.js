import {registryDate,registryToday} from './registry.js';
export const evidenceSchema=Object.freeze({schema_version:'fnd05-v1',currency:'EUR',denominator:'building_common_parts'});
export const moneyFields=Object.freeze(['approved_cost','reported_available','authorized_use','target_collection']);
export const evidenceTextFields=Object.freeze(['record_kind','participants_reference','works_description','works_classification','classification_reference','evidence_reference','evidence_sha256','legal_reference','legal_version','majority_reference','funds_as_of','funds_reference','use_reference','collection_reference','liability_reference','due_on']);
export function moneyClaim(value){
 if(value==null||value==='')return null;
 if(typeof value!=='string'||!/^(0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value))throw Error('Сума в EUR: до 12 цифри и до 2 знака след точка, без закръгляне.');
 const [whole,fraction='']=value.split('.');return whole+'.'+fraction.padEnd(2,'0');
}
const cents=value=>value==null?null:BigInt(value.replace('.',''));
export function financialEvidenceDraft(p,basis){
 if(!p||Array.isArray(p)||typeof p!=='object'||Object.keys(p).some(k=>![...Object.keys(evidenceSchema),...moneyFields,...evidenceTextFields,'unit_ids'].includes(k)))throw Error('Непозволени доказателствени полета.');
 if(Object.entries(evidenceSchema).some(([k,v])=>p[k]!==v))throw Error('Използвай точния FND-F05 договор.');
 const result={...evidenceSchema};
 for(const key of evidenceTextFields){const v=p[key];if(v==null||v===''){result[key]=null;continue;}if(typeof v!=='string'||!v.trim()||[...v.trim()].length>1000)throw Error('Невалидна референция или текст.');result[key]=v.trim();}
 if(result.record_kind&&!['synthetic','client'].includes(result.record_kind))throw Error('Посочи синтетично или клиентско основание.');
 if(result.evidence_sha256&&!/^[a-f\d]{64}$/i.test(result.evidence_sha256))throw Error('Нужен е SHA-256 на точната документна версия.');
 for(const k of moneyFields)result[k]=moneyClaim(p[k]);
 const [c,b,u,r]=moneyFields.map(k=>cents(result[k]));
 if((c!==null&&c<=0n)||(r!==null&&r<=0n)||(u!==null&&b!==null&&u>b)||(c!==null&&u!==null&&r!==null&&c!==u+r))throw Error('Несъответствие: C=U+R, U≤B, C/R>0. Липсваща стойност не е нула.');
 if(p.unit_ids!=null&&!Array.isArray(p.unit_ids))throw Error('Избери явен набор имоти.');
 result.unit_ids=p.unit_ids??[];
 if(result.unit_ids.length>10000||result.unit_ids.some(id=>typeof id!=='string'||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id))||new Set(result.unit_ids.map(v=>v.toLowerCase())).size!==result.unit_ids.length)throw Error('Невалидни или дублирани участници.');
 for(const k of ['funds_as_of','due_on'])if(result[k])result[k]=registryDate(result[k]);
 if((result.funds_as_of&&result.funds_as_of>registryToday())||(result.due_on&&(result.due_on<basis.effective_from||(basis.effective_to&&result.due_on>=basis.effective_to))))throw Error('Датата е извън допустимия период.');
 return result;
}
export function financialEvidenceGaps(e,basis){
 return [...evidenceTextFields,...moneyFields].filter(k=>e?.[k]==null||e[k]==='').concat(!e?.unit_ids?.length?['unit_ids']:[],!basis.effective_to?['effective_to']:[]);
}
