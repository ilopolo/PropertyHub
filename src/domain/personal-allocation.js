import {fractionUnits} from './ownership.js';

export const personalAllocationPolicy='largest-remainder-person-id-v1';
const denominator=10000000000n;
const isUuid=value=>typeof value==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const compareId=(a,b)=>a.person_id<b.person_id?-1:a.person_id>b.person_id?1:0;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const personId=value=>{
  if(!isUuid(value))fail('invalid_person_id','Нужен е конкретен person UUID.');
  return value.toLowerCase();
};

// Arithmetic only: callers must independently prove the roster, ownership and personal liability.
// All money is already fixed integer eurocents; ownership uses the existing exact decimal scale.
export function allocatePersonal({unit_amount_cents,regime,expected_person_ids,rows}={}){
  if(regime!=='ordinary_fractional')fail('unsupported_regime','Поддържа се само обикновена дялова съсобственост.');
  if(typeof unit_amount_cents!=='string'||!/^(0|[1-9]\d*)$/.test(unit_amount_cents))
    fail('invalid_amount_cents','Сумата трябва да е неотрицателен цял брой евроценти като десетичен текст.');
  if(!Array.isArray(expected_person_ids)||!expected_person_ids.length)
    fail('missing_roster','Нужен е изричен непразен набор очаквани лица.');
  const expected=new Set();
  for(const value of expected_person_ids){
    const id=personId(value);
    if(expected.has(id))fail('duplicate_participant','Дублирано лице в очаквания набор.');
    expected.add(id);
  }
  if(!Array.isArray(rows))fail('missing_rows','Липсват редовете с квоти.');
  const total=BigInt(unit_amount_cents),seen=new Set();let sum=0n;
  const result=rows.map(row=>{
    const person_id=personId(row?.person_id);
    if(seen.has(person_id))fail('duplicate_participant','Дублирано лице сред квотите.');
    seen.add(person_id);
    if(!expected.has(person_id))fail('unexpected_participant','Лицето не е в изричния очакван набор.');
    const value=row.ownership_fraction;
    if(value===null||value===undefined||value==='')fail('missing_fraction','Липсва ownership квота; това не е нула.');
    if(typeof value==='string'&&(value.includes('/')||/^[01]\.\d{11,}$/.test(value)))
      fail('unsupported_fraction_representation','Текущият модел поддържа само точен десетичен запис до 10 знака; рационалната собственост не се обявява за невалидна.');
    let weight;
    try{weight=fractionUnits(value);}catch{fail('invalid_fraction','Квотата трябва да е точен десетичен текст, по-голяма от нула и най-много едно.');}
    sum+=weight;
    const numerator=total*weight;
    return {person_id,ownership_units:String(weight),quota_numerator:String(numerator),
      remainder_denominator:String(denominator),floor_cents:String(numerator/denominator),
      remainder_numerator:String(numerator%denominator),residual_cent:false};
  });
  if(seen.size!==expected.size)fail('missing_participant','Липсва лице от изричния очакван набор.');
  if(sum<denominator)fail('incomplete_fraction_total','Сборът на квотите е под едно; без нормализация или допълване.');
  if(sum>denominator)fail('excess_fraction_total','Сборът на квотите надвишава едно.');
  let left=total-result.reduce((s,row)=>s+BigInt(row.floor_cents),0n);
  const ranked=[...result].sort((a,b)=>{
    const ar=BigInt(a.remainder_numerator),br=BigInt(b.remainder_numerator);
    return ar===br?compareId(a,b):ar>br?-1:1;
  });
  for(const row of ranked)if(left>0n){row.residual_cent=true;left--;}
  for(const row of result)row.amount_cents=String(BigInt(row.floor_cents)+(row.residual_cent?1n:0n));
  return {policy:personalAllocationPolicy,currency:'EUR',total_cents:String(total),rows:result.sort(compareId)};
}
