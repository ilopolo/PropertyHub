import assert from 'node:assert/strict';
import {fractionUnits,decimalLabel,ownershipState} from '../src/domain/ownership.js';
assert.equal(fractionUnits('0.0000000001'),1n);assert.equal(fractionUnits('1'),10000000000n);
assert.equal(fractionUnits('0.3333333333')*3n,9999999999n,'No rounding/normalizing thirds to one');
for(const value of ['0','-0.1','1.0000000001','0.12345678901','1e-1','0,5','',null])assert.throws(()=>fractionUnits(value));
assert.equal(decimalLabel('0.5000000000'),'0.5');assert.equal(decimalLabel('0.0000000001'),'0.0000000001');
for(const [data,status]of [[{total_fraction:'0'},'missing'],[{total_fraction:'0.9999999999'},'partial'],[{total_fraction:'1.0000000000',unreviewed_count:1},'unreviewed'],[{total_fraction:'1',unreviewed_count:0,set_reviewed:false},'needs_set_review'],[{total_fraction:'1',unreviewed_count:0,set_reviewed:true},'reviewed']])assert.equal(ownershipState(data),status);
console.log('PASS: exact ownership decimal boundaries and explicit partial/row/set review states; no floating-point normalization.');
