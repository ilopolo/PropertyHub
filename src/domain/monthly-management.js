import {moneyClaim} from './financial-evidence.js';
import {registryDate} from './registry.js';
import {previewNote} from './financial-preview.js';
export const MONTHLY_POLICY='equal-unit-cent-tariff-v1';
export const MONTHLY_MODEL='monthly-owner-occupant-v1';
export function monthlyPeriod(start){
 const first=registryDate(start);if(!first.endsWith('-01'))throw Error('Избери първия ден на календарния месец.');
 const [year,month]=first.split('-').map(Number),next=new Date(Date.UTC(year,month,1)).toISOString().slice(0,10);
 return {start:first,end:next,liability:new Date(Date.UTC(year,month,0)).toISOString().slice(0,10)};
}
export function monthlyTariff(tariff,unitIds){
 const value=moneyClaim(tariff),cents=BigInt(value.replace('.',''));
 if(cents<=0n)throw Error('Ставката трябва да е положителна и в цели евроценти.');
 if(!Array.isArray(unitIds)||!unitIds.length||new Set(unitIds).size!==unitIds.length||unitIds.some(x=>typeof x!=='string'||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(x)))throw Error('Нужен е пълен набор от различни обекти.');
 return {policy:MONTHLY_POLICY,currency:'EUR',total_cents:(cents*BigInt(unitIds.length)).toString(),rows:[...unitIds].sort().map(unit_id=>({unit_id,amount:value,amount_cents:cents.toString()}))};
}
export function monthlySource(p){
 const keys=['month_start','tariff','meeting_date','due_on','known_from','title','reference','source_reference','source_hash','method_reference','applicability_reason','quorum_reference','representation_reference','votes_all_common_parts','unchanged_reference','ordinary_housing_confirmed','supersedes_id'];
 if(!p||Array.isArray(p)||Object.keys(p).some(k=>!keys.includes(k)))throw Error('Непозволени входове за месечно управление.');
 const result={...p};monthlyPeriod(p.month_start);for(const k of ['meeting_date','due_on','known_from'])result[k]=registryDate(p[k]);
 result.tariff=moneyClaim(p.tariff);if(BigInt(result.tariff.replace('.',''))<=0n)throw Error('Нужна е положителна ставка.');
 for(const k of [...keys.slice(5,13),'unchanged_reference'])result[k]=previewNote(p[k]);
 if(!/^[a-f0-9]{64}$/.test(result.source_hash))throw Error('Нужен е точният SHA-256 на проверявания източник.');
 if(p.supersedes_id!=null&&!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(p.supersedes_id))throw Error('Нужен е точният заменян вариант.');
 if(result.title.length>160||result.reference.length>300||result.source_reference.length>300)throw Error('Прекалено дълго основание.');
 if(typeof p.votes_all_common_parts!=='string'||!/^(0|[1-9][0-9]{0,2})(\.[0-9]{1,8})?$/.test(p.votes_all_common_parts))throw Error('Посочи точния процент от всички идеални части.');
 const [whole,decimal='']=p.votes_all_common_parts.split('.'),votes=BigInt(whole)*100000000n+BigInt(decimal.padEnd(8,'0'));
 if(votes<5100000000n||votes>10000000000n||p.ordinary_housing_confirmed!==true)throw Error('Изисква се прегледана приложимост и решение с поне 51% от всички идеални части.');
 return result;
}
