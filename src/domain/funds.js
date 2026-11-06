import {paymentAmount,paymentNote} from './manual-payments.js';
const uuid=v=>typeof v==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const text=(v,max)=>{if(typeof v!=='string'||!v.trim()||[...v.trim()].length>max||/[\u0000-\u001f\u007f]/.test(v))throw Error('Попълни валиден текст за фонда.');return v.trim();};
export function fundPayload(p,creating){
 const fields=['label','purpose','basis_reference','account_id','account_revision'];
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>![...fields,...creating?['code','kind','currency']:[]].includes(k)))throw Error('Непозволени полета за фонд.');
 const out={label:text(p.label,160),purpose:text(p.purpose,500),basis_reference:text(p.basis_reference,1000)};
 if(p.account_id===null){if(p.account_revision!==null)throw Error('Невалидна версия на сметка.');out.account_id=null;out.account_revision=null;}
 else{if(!uuid(p.account_id)||!Number.isSafeInteger(p.account_revision)||p.account_revision<1)throw Error('Избери точна сметка и версия.');out.account_id=p.account_id.toLowerCase();out.account_revision=p.account_revision;}
 if(creating){if(typeof p.code!=='string'||!/[a-z]/.test(p.code)||!/^[a-z][a-z0-9_]{0,39}$/.test(p.code)||!['general','repair_renewal'].includes(p.kind)||p.currency!=='EUR')throw Error('Избери постоянен код, вид и EUR.');Object.assign(out,{code:p.code,kind:p.kind,currency:'EUR'});if(p.kind==='repair_renewal'&&!out.account_id)throw Error('Ремонтният фонд изисква изрично специално банково предназначение.');}
 return out;
}
export function fundLines(lines){
 if(!Array.isArray(lines)||!lines.length||lines.length>100)throw Error('Въведи пълна фондова разбивка.');
 const result=lines.map(p=>{if(!p||Object.keys(p).some(k=>!['fund_id','fund_revision','amount'].includes(k))||!uuid(p.fund_id)||!Number.isSafeInteger(p.fund_revision)||p.fund_revision<1)throw Error('Невалиден фонд или версия.');return{fund_id:p.fund_id.toLowerCase(),fund_revision:p.fund_revision,amount:paymentAmount(p.amount)};}).sort((a,b)=>a.fund_id<b.fund_id?-1:a.fund_id>b.fund_id?1:0);
 if(new Set(result.map(r=>r.fund_id)).size!==result.length)throw Error('Един фонд участва само веднъж.');return result;
}
export function exactFundSplit(amount,lines){const result=fundLines(lines);if(result.reduce((sum,l)=>sum+BigInt(l.amount.replace('.','')),0n)!==BigInt(paymentAmount(amount).replace('.','')))throw Error('Разбивката трябва точно да покрива цялата сума.');return result;}
export const fundNote=paymentNote;
export function fundFeedData(data){
 if(!data||['scopes','funds','accounts','history','movements','classifications'].some(k=>!Array.isArray(data[k])))throw Error('Фондовите данни не са заредени изцяло.');
 for(const m of data.movements){if(!uuid(m.id)||!uuid(m.scope_id)||m.currency!=='EUR'||!['in','out'].includes(m.direction)||!Number.isSafeInteger(m.classification_revision))throw Error('Фондовият източник не е валиден.');paymentAmount(m.amount);}
 return data;
}
