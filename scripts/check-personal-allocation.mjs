import assert from 'node:assert/strict';
import {allocatePersonal,personalAllocationPolicy} from '../src/domain/personal-allocation.js';

const ids=['aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000003'];
const input=(amount='4000',fractions=['0.6','0.4'])=>({unit_amount_cents:amount,regime:'ordinary_fractional',expected_person_ids:ids.slice(0,fractions.length),rows:fractions.map((ownership_fraction,i)=>({person_id:ids[i],ownership_fraction}))});
const amounts=result=>result.rows.map(row=>row.amount_cents);
const deny=(data,code)=>assert.throws(()=>allocatePersonal(data),error=>error.code===code,code);
let checks=0;
const test=(name,fn)=>{fn();checks++;console.log(`PASS: ${name}`);};
test('exact division and fixed unit sum',()=>{
  const r=allocatePersonal(input());assert.equal(r.policy,personalAllocationPolicy);assert.deepEqual(amounts(r),['2400','1600']);assert.equal(r.total_cents,'4000');
});
test('largest exact remainder precedes UUID; audit fields',()=>{
  const r=allocatePersonal(input('3'));assert.deepEqual(amounts(r),['2','1']);
  assert.deepEqual(r.rows.map(v=>[v.floor_cents,v.remainder_numerator,v.residual_cent]),[['1','8000000000',true],['1','2000000000',false]]);
  assert.equal(r.rows[0].quota_numerator,'18000000000');assert.equal(r.rows[0].remainder_denominator,'10000000000');
});
test('UUID ties, canonical case and input permutation invariance',()=>{
  const data=input('1',['0.5','0.5']),r=allocatePersonal(data);assert.deepEqual(amounts(r),['1','0']);
  data.rows.reverse();data.expected_person_ids.reverse();data.rows[0].person_id=data.rows[0].person_id.toUpperCase();
  assert.deepEqual(allocatePersonal(data),r);
});
test('zero and fewer cents than participants retain every participant',()=>{
  assert.deepEqual(amounts(allocatePersonal(input('0'))),['0','0']);
  assert.deepEqual(amounts(allocatePersonal(input('1',['0.3','0.3','0.4']))),['0','0','1']);
});
test('BigInt precision and exact 10-decimal boundary',()=>{
  const r=allocatePersonal(input('900719925474099312345',['0.0000000001','0.9999999999']));
  assert.equal(r.rows.reduce((s,v)=>s+BigInt(v.amount_cents),0n),900719925474099312345n);
  assert.equal(r.rows[0].ownership_units,'1');
});
test('missing/duplicate/unexpected roster cannot hide behind a full total',()=>{
  const d=input();d.rows=[{person_id:ids[0],ownership_fraction:'1'}];deny(d,'missing_participant');
  deny({...input(),expected_person_ids:[]},'missing_roster');deny({...input(),rows:null},'missing_rows');
  deny({...input(),expected_person_ids:[ids[0],ids[0].toUpperCase()]},'duplicate_participant');
  const dup=input();dup.rows[1].person_id=ids[0].toUpperCase();deny(dup,'duplicate_participant');
  const extra=input();extra.rows[1].person_id=ids[2];deny(extra,'unexpected_participant');
  const invalid=input();invalid.rows[0].person_id='not-a-uuid';deny(invalid,'invalid_person_id');
});
test('unknown, invalid and unsupported quotas; never normalize',()=>{
  for(const v of [null,undefined,''])deny(input('1',[v,'1']),'missing_fraction');
  for(const v of ['0','-0.1','1.1','0,5','1e-1',0.5,{}])deny(input('1',[v,'1']),'invalid_fraction');
  for(const v of ['1/3','0.33333333333'])deny(input('1',[v,'0.5']),'unsupported_fraction_representation');
  deny(input('1',['0.3333333333','0.3333333333','0.3333333333']),'incomplete_fraction_total');
  deny(input('1',['0.9999']),'incomplete_fraction_total');deny(input('1',['0.6','0.5']),'excess_fraction_total');
});
test('amount and unsupported regime fail closed',()=>{
  for(const a of ['-1','1.0','01','1e3','',null,1,0.5])deny(input(a),'invalid_amount_cents');
  for(const regime of [undefined,'SIO','disputed','changed','unknown'])deny({...input(),regime},'unsupported_regime');
});
test('no mutation, no cross-unit pool and deterministic sums for synthetic inputs',()=>{
  const d=input('1',['0.5','0.5']);Object.freeze(d.expected_person_ids);d.rows.forEach(Object.freeze);Object.freeze(d.rows);Object.freeze(d);
  const before=JSON.stringify(d);assert.deepEqual(allocatePersonal(d),allocatePersonal(d));assert.equal(JSON.stringify(d),before);
  assert.deepEqual(amounts(allocatePersonal(d)),['1','0']);
  for(let cents=0;cents<31;cents++)for(const fractions of [['0.5','0.5'],['0.1','0.2','0.7'],['0.0000000001','0.9999999999']]){
    const r=allocatePersonal(input(String(cents),fractions));assert.equal(r.rows.reduce((s,v)=>s+BigInt(v.amount_cents),0n),BigInt(cents));
    assert(r.rows.every(v=>BigInt(v.amount_cents)>=0n));
  }
});
console.log(`PASS: ${checks} personal allocation groups; pure synthetic arithmetic, no ownership/legal/access or hosted evidence.`);
