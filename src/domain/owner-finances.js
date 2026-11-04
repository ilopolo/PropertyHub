import {registryDate} from './registry.js';
const uuid=v=>typeof v==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const money=v=>typeof v==='string'&&/^-?(0|[1-9]\d{0,15})\.\d{2}$/.test(v);
const nonnegative=v=>money(v)&&BigInt(v.replace('.',''))>=0n;
const date=v=>{try{return registryDate(v)===v;}catch{return false;}};
const timestamp=v=>typeof v==='string'&&/T/.test(v)&&Number.isFinite(Date.parse(v));
export function ownerFinanceFilter(unit=null){if(unit==null||unit==='')return null;if(!uuid(unit))throw Error('Невалиден филтър за личната справка.');return unit.toLowerCase();}
export function ownerFinanceData(data){
 const invalid=()=>{throw Error('Личната финансова справка не е заредена изцяло.');};
 if(data?.schema_version!=='owner-finances-v1'||data.currency!=='EUR'||!Array.isArray(data.items)||!data.totals)return invalid();
 if(!['assessed_amount','covered_amount','remaining_amount'].every(k=>nonnegative(data.totals[k])))return invalid();
 for(const x of data.items){if(!uuid(x.id)||!uuid(x.unit_id)||!['current','superseded','reversal'].includes(x.status)||!['assessed_amount','unit_amount','covered_amount'].every(k=>money(x[k]))||!Array.isArray(x.coverage)||!(x.related_item_id===null||uuid(x.related_item_id))||!(x.unit_label===null||typeof x.unit_label==='string'))return invalid();
  if(x.status==='current'?(!nonnegative(x.remaining_amount)||!nonnegative(x.assessed_amount)||!nonnegative(x.covered_amount)):x.remaining_amount!==null)return invalid();
  if(!['liability_date','due_date','period_start','period_end'].every(k=>date(x[k]))||!timestamp(x.published_at))return invalid();
  for(const a of x.coverage)if(!uuid(a.id)||!money(a.amount)||!['manual_coverage','coverage_reversal'].includes(a.basis_code)||!date(a.payment_date)||!timestamp(a.recorded_at)||!(a.reversal_of_id===null||uuid(a.reversal_of_id))||!(a.compensation_date===null||date(a.compensation_date)))return invalid();
 }
 return data;
}
