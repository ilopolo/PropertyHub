import {previewNote} from './financial-preview.js';
const text=(v,max)=>{if(typeof v!=='string'||!v.trim()||[...v.trim()].length>max||/[\u0000-\u001f\u007f]/.test(v))throw Error('Попълни валиден текст в допустимата дължина.');return v.trim();};
export function cashAccountPayload(p,creating){
 const allowed=creating?['account_type','currency','label','purpose','holder_label','account_reference']:['label','purpose'];
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!allowed.includes(k)))throw Error('Непозволени полета. Идентичността на сметката не се редактира.');
 const out={label:text(p.label,160),purpose:text(p.purpose,500)};if(!creating)return out;
 if(p.currency!=='EUR'||!['cash','bank'].includes(p.account_type))throw Error('Избери изрично каса или банкова сметка и EUR.');
 out.currency='EUR';out.account_type=p.account_type;
 if(p.account_type==='bank'){out.holder_label=text(p.holder_label,160);out.account_reference=text(p.account_reference,160);if(out.holder_label.includes('://')||out.account_reference.includes('://'))throw Error('Въведи само банков реквизит, без URL, парола или token.');}
 else{if(p.holder_label!=null||p.account_reference!=null)throw Error('Касата не използва банкови реквизити.');out.holder_label=null;out.account_reference=null;}
 return out;
}
export const cashAccountNote=previewNote;
