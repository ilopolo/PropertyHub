import {registryDate,registryToday} from './registry.js';
export const repairParameters=Object.freeze({currency:'EUR',denominator:'building_common_parts',participants:'all_building_units'});
const text=(v,max)=>{if(typeof v!=='string'||!v.trim()||[...v.trim()].length>max)throw Error('Попълни задължителните текстове в допустимата дължина.');return v.trim();};
const date=v=>{try{return registryDate(v);}catch{throw Error('Въведи валидна календарна дата.');}};
const period=(from,to)=>{const a=date(from),b=to==null||to===''?null:date(to);if(b&&b<=a)throw Error('Краят трябва да е след началото; крайният ден не е включен.');return[a,b];};
const keys=(p,allowed)=>{if(!p||Array.isArray(p)||Object.keys(p).some(k=>!allowed.includes(k)))throw Error('Непозволено поле в черновата.');};
export const changeReason=v=>text(v,1000);
export function resolutionDraft(p){
 keys(p,['title','reference','meeting_date','effective_from','effective_to','source_kind','source_reference','known_from']);
 const [from,to]=period(p.effective_from,p.effective_to),meeting=date(p.meeting_date),known=date(p.known_from);
 if(meeting>registryToday()||known>registryToday()||from<meeting||known<meeting)throw Error('Провери датата на решението, произхода и началото на периода.');
 if(!['document','statement'].includes(p.source_kind))throw Error('Избери допустим произход.');
 return{title:text(p.title,160),reference:text(p.reference,300),meeting_date:meeting,effective_from:from,effective_to:to,source_kind:p.source_kind,source_reference:text(p.source_reference,300),known_from:known};
}
export function financialRuleDraft(p){
 keys(p,['category_id','resolution_id','method','mode','config','valid_from','valid_to']);
 for(const id of[p.category_id,p.resolution_id])if(typeof id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))throw Error('Избери конкретна версия на категория и основание.');
 if(p.method!=='ideal_shares'||p.mode!=='POOL'||!p.config||Object.keys(p.config).length!==3||Object.entries(repairParameters).some(([k,v])=>p.config[k]!==v))throw Error('Неподдържани параметри. В тази стъпка се записва само чернова за общи части на сградата.');
 const [from,to]=period(p.valid_from,p.valid_to);return{category_id:p.category_id,resolution_id:p.resolution_id,method:p.method,mode:p.mode,config:{...repairParameters},valid_from:from,valid_to:to};
}
