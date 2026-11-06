import {percentageUnits} from './unit-shares.js';
import {moneyClaim,} from './financial-evidence.js';
import {registryDate} from './registry.js';
export const previewPolicy='largest-remainder-unit-id-v1';
const uuid=v=>typeof v==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
export function previewSelection(p){if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['rule_id','share_version_id','reference_date'].includes(k))||!uuid(p.rule_id)||!uuid(p.share_version_id))throw Error('Избери точни версии на правило и идеални части.');return{rule_id:p.rule_id.toLowerCase(),share_version_id:p.share_version_id.toLowerCase(),reference_date:registryDate(p.reference_date)};}
export const previewNote=n=>{if(typeof n!=='string'||!n.trim()||[...n.trim()].length>1000)throw Error('Нужна е бележка до1000знака.');return n.trim();};
// Pure policy oracle for trusted synthetic/server inputs, never authorization or request data.
export function allocatePreview(amount,rows){
 const normalized=moneyClaim(amount);if(!normalized||!Array.isArray(rows)||!rows.length)throw Error('Нужни са сума и пълен набор.');const total=BigInt(normalized.replace('.','')),den=10000000000n,ids=new Set();let sum=0n;
 if(total<=0n)throw Error('Нужна е положителна сума.');
 const result=rows.map(row=>{if(!uuid(row.unit_id)||ids.has(row.unit_id.toLowerCase()))throw Error('Невалиден участник.');const unit_id=row.unit_id.toLowerCase();ids.add(unit_id);const share=percentageUnits(row.percentage);if(share===null)throw Error('Липсва процент.');sum+=share;const n=total*share;return{unit_id,percentage_units:String(share),quota_numerator:String(n),remainder_denominator:String(den),floor_cents:String(n/den),remainder_numerator:String(n%den),residual_cent:false};});
 if(sum!==den)throw Error('Изисква се точно100%, без нормализация.');let left=total-result.reduce((s,r)=>s+BigInt(r.floor_cents),0n);
 const compare=(a,b)=>a.unit_id<b.unit_id?-1:a.unit_id>b.unit_id?1:0;
 const ranked=[...result].sort((a,b)=>BigInt(a.remainder_numerator)===BigInt(b.remainder_numerator)?compare(a,b):BigInt(a.remainder_numerator)>BigInt(b.remainder_numerator)?-1:1);
 for(const row of ranked)if(left>0n){row.residual_cent=true;left--;}
 for(const r of result){const cents=BigInt(r.floor_cents)+(r.residual_cent?1n:0n);r.amount_cents=String(cents);r.amount=`${cents/100n}.${String(cents%100n).padStart(2,'0')}`;}
 return{policy:previewPolicy,total_cents:String(total),currency:'EUR',rows:result.sort(compare)};
}
