import {moneyClaim} from './financial-evidence.js';
import {registryDate,registryToday} from './registry.js';
import {previewNote} from './financial-preview.js';
const uuid=v=>typeof v==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
export const paymentAmount=value=>{const amount=moneyClaim(value);if(!amount||BigInt(amount.replace('.',''))<=0n)throw Error('Въведи положителна сума в точни евроценти.');return amount;};
export function manualPayment(p){
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['payer_person_id','payer_label','amount','payment_date','method','document_reference','purpose'].includes(k)))throw Error('Непозволени полета за плащане.');
 const out={};for(const key of ['payer_label','document_reference','purpose']){if(typeof p[key]!=='string'||!p[key].trim()||[...p[key].trim()].length>500)throw Error('Попълни платец, документна референция и предназначение до500знака.');out[key]=p[key].trim();}
 if(!['cash','bank_transfer'].includes(p.method))throw Error('Избери каса или банков превод.');out.method=p.method;out.amount=paymentAmount(p.amount);out.payment_date=registryDate(p.payment_date);if(out.payment_date>registryToday())throw Error('Ръчно отчетено получаване не може да е с бъдеща дата.');
 if(p.payer_person_id!=null&&!uuid(p.payer_person_id))throw Error('Невалиден идентификатор на платец.');out.payer_person_id=p.payer_person_id?.toLowerCase()??null;return out;
}
export function paymentAllocation(p){if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['obligation_party_id','amount'].includes(k))||!uuid(p.obligation_party_id))throw Error('Избери точен публикуван личен ред.');return{obligation_party_id:p.obligation_party_id.toLowerCase(),amount:paymentAmount(p.amount)};}
export const paymentNote=previewNote;
