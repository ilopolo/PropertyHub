import assert from 'node:assert/strict';
import {declaredCount,countLabel,occupancyState} from '../src/domain/occupancy.js';
assert.equal(declaredCount(null),null);assert.equal(declaredCount(''),null);assert.equal(declaredCount('0'),0n);assert.equal(declaredCount('2.0000'),2n);assert.equal(declaredCount('99999999'),99999999n);
for(const value of ['-1','0.5','1e1','100000000','00'])assert.throws(()=>declaredCount(value));
for(const [data,state]of [[{applicable_count:0,count_value:null},'missing'],[{applicable_count:1,count_value:null},'unknown'],[{applicable_count:1,count_value:'0.0000',unreviewed_count:1},'declared_zero'],[{applicable_count:1,count_value:'0',unreviewed_count:0,set_reviewed:false},'needs_zero_review'],[{applicable_count:1,count_value:'0',set_reviewed:true},'confirmed_zero'],[{applicable_count:2,count_value:'2.0000',unreviewed_count:0,set_reviewed:false},'needs_set_review'],[{applicable_count:2,count_value:'2',set_reviewed:true},'verified_count']])assert.equal(occupancyState(data),state);
assert.equal(countLabel('0.0000'),'0');assert.equal(countLabel(null),'неизвестен');
assert.equal(occupancyState({applicable_count:1,count_value:'1',subject_conflict_count:1,set_reviewed:true}),'subject_conflict');
console.log('PASS: occupancy whole-count boundaries; missing/unknown/declared/confirmed-zero states remain distinct.');
