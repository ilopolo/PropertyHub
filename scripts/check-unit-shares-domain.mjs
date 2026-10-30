import assert from 'node:assert/strict';
import {percentageUnits,percentageText,assessUnitShares} from '../src/domain/unit-shares.js';

const basis={key:'synthetic-common-parts',revision:1,kind:'building',building_id:'synthetic-building',verified:true};
const interval={valid_from:'2026-01-01',valid_to:'2026-04-01'};
const participants={basis:{...basis},revision:1,unit_ids:['A','B'],verified:true,...interval};
const row=(unit_id,percentage,extra={})=>({id:'share-'+unit_id,unit_id,percentage,basis:{...basis},participant_revision:1,...interval,verification_status:'verified',...extra});
const input=()=>({basis:{...basis},participants:structuredClone(participants),interval:{...interval},rows:[row('A','40'),row('B','60')]});
let groups=0;
const check=(name,fn)=>{fn();groups++;console.log('PASS: '+name);};
const has=(r,code)=>assert.ok(r.reasons.some(reason=>reason.code===code),'Missing reason: '+code);

check('exact percentage points, boundaries, absent versus invalid zero',()=>{
 assert.equal(percentageUnits('0.00000001'),1n);assert.equal(percentageUnits('100.00000000'),10000000000n);
 assert.equal(percentageUnits(null),null);assert.equal(percentageUnits(undefined),null);assert.equal(percentageUnits(''),null);
 for(const value of ['0','0.00000000','100.00000001','0.000000001','-1','01','1e2','2,5',' 2.5',2.5,NaN,Infinity])assert.throws(()=>percentageUnits(value));
 assert.equal(percentageText(percentageUnits('2.50000000')),'2.5');
});
check('complete established set, valid individual rows, immutable input',()=>{
 const data=input(),before=structuredClone(data);Object.freeze(data.rows);const r=assessUnitShares(data);
 assert.equal(r.state,'ready');assert.equal(r.segments[0].known_total,'100');assert.equal(r.segments[0].difference,'0');
 assert.ok(r.rows.every(v=>v.valid&&v.reviewed));assert.deepEqual(r.reasons,[]);assert.deepEqual(data,before);
});
check('99.99 stays partial; smallest precision deficit is never normalized',()=>{
 const data=input();data.rows[1].percentage='59.99';let r=assessUnitShares(data);assert.equal(r.state,'partial');assert.equal(r.segments[0].known_total,'99.99');assert.equal(r.segments[0].difference,'-0.01');assert.ok(r.rows.every(v=>v.valid));
 data.rows=[row('A','33.33333333'),row('B','33.33333333'),row('C','33.33333333')];data.participants.unit_ids.push('C');r=assessUnitShares(data);assert.equal(r.state,'partial');assert.equal(r.segments[0].known_total,'99.99999999');
});
check('exceeded total is a conflict, even by one precision unit',()=>{
 const data=input();data.rows[1].percentage='60.00000001';const r=assessUnitShares(data);assert.equal(r.state,'conflict');has(r,'exceeded_total');assert.equal(r.segments[0].difference,'0.00000001');
});
check('unknown percentage differs from zero and is not a valid share',()=>{
 const data=input();data.rows[1].percentage=null;let r=assessUnitShares(data);assert.equal(r.state,'missing');has(r,'unknown_percentage');assert.equal(r.rows[1].valid,false);assert.equal(r.segments[0].known_total,'40');
 data.rows[1].percentage='0';r=assessUnitShares(data);assert.equal(r.state,'conflict');has(r,'percentage_out_of_range');
});
check('missing participant cannot be hidden by another row summing to100',()=>{
 const data=input();data.rows=[row('A','100')];const r=assessUnitShares(data);assert.equal(r.state,'missing');has(r,'missing_participant');assert.equal(r.segments[0].known_total,'100');
});
check('duplicate membership and duplicate record refused explicitly',()=>{
 const data=input();data.participants.unit_ids.push('A');let r=assessUnitShares(data);assert.equal(r.state,'conflict');has(r,'duplicate_participant');
 data.participants.unit_ids.pop();data.rows.push({...data.rows[0]});r=assessUnitShares(data);assert.equal(r.state,'conflict');has(r,'duplicate_record');has(r,'overlapping_periods');
});
check('different records for one participant overlap; different participants may coexist',()=>{
 const data=input();data.rows.push(row('A','1',{id:'second-A'}));const r=assessUnitShares(data);assert.equal(r.state,'conflict');has(r,'overlapping_periods');
});
check('adjacent periods form separate exact complete segments',()=>{
 const data=input();data.rows=[row('A','40',{valid_to:'2026-02-01'}),row('A','40',{id:'next-A',valid_from:'2026-02-01'}),row('B','60')];
 const r=assessUnitShares(data);assert.equal(r.state,'ready');assert.equal(r.segments.length,2);assert.equal(r.segments[0].valid_to,'2026-02-01');assert.equal(r.segments[1].valid_from,'2026-02-01');assert.ok(r.segments.every(s=>s.state==='ready'));
});
check('gaps are missing; conflicts after first date are evaluated',()=>{
 const data=input();data.rows[0].valid_to='2026-02-01';let r=assessUnitShares(data);assert.equal(r.state,'missing');assert.equal(r.segments[1].state,'missing');
 data.rows[0].valid_to='2026-03-01';data.rows.push(row('A','40',{id:'next-A',valid_from:'2026-02-01'}));r=assessUnitShares(data);assert.equal(r.state,'conflict');has(r,'overlapping_periods');
});
check('invalid dates, reversed/empty intervals; open end supported',()=>{
 for(const patch of [{valid_from:'2026-02-30'},{valid_to:'2026-01-01'},{valid_to:'2025-12-31'},{valid_from:'0000-01-01'}]){const data=input();Object.assign(data.rows[0],patch);const r=assessUnitShares(data);assert.equal(r.state,'conflict');has(r,'invalid_period');}
 const data=input();data.interval.valid_to=null;data.participants.valid_to=null;for(const r of data.rows)r.valid_to=null;const r=assessUnitShares(data);assert.equal(r.state,'ready');assert.equal(r.segments[0].valid_to,null);
});
check('building basis cannot silently become an entrance denominator',()=>{
 const data=input();data.rows[1].basis={...basis,kind:'entrance',entrance_id:'synthetic-entrance'};let r=assessUnitShares(data);assert.equal(r.state,'wrong_basis');has(r,'wrong_basis');
 data.rows[1].basis={...basis};data.participants.basis.building_id='another-building';r=assessUnitShares(data);assert.equal(r.state,'wrong_basis');
 data.participants.basis={...basis};data.rows[1].unit_id='foreign-unit';r=assessUnitShares(data);assert.equal(r.state,'wrong_basis');has(r,'unexpected_participant');
});
check('exact100 alone does not establish denominator or participant completeness',()=>{
 const data=input();data.basis.verified=false;let r=assessUnitShares(data);assert.equal(r.state,'unreviewed');has(r,'unestablished_basis');
 data.basis.verified=true;data.participants.verified=false;r=assessUnitShares(data);assert.equal(r.state,'unreviewed');has(r,'unestablished_participants');
 data.participants.unit_ids=[];r=assessUnitShares(data);assert.equal(r.state,'conflict');has(r,'invalid_participant_set');
});
check('individual row validity does not imply row or set verification',()=>{
 const data=input();data.rows[1].verification_status='needs_review';const r=assessUnitShares(data);assert.equal(r.state,'unreviewed');assert.equal(r.rows[1].valid,true);assert.equal(r.rows[1].reviewed,false);has(r,'unreviewed_row');
});
check('basis/membership revision changes invalidate readiness',()=>{
 for(const target of ['basis','participants','row']){const data=input();if(target==='basis')data.basis.revision++;else if(target==='participants')data.participants.revision++;else data.rows[0].basis.revision++;const r=assessUnitShares(data);assert.equal(r.state,'unreviewed');has(r,'stale_revision');}
});
check('participant evidence must cover each assessed date, no invented prior history',()=>{
 const data=input();data.participants.valid_from='2026-02-01';const r=assessUnitShares(data);assert.equal(r.state,'unreviewed');has(r,'outside_participant_period');assert.equal(r.segments[0].state,'unreviewed');assert.equal(r.segments[1].state,'ready');
});
check('retired originals are ignored; malformed input cannot become ready',()=>{
 const data=input();data.rows.push(row('A','60',{id:'old-A',record_state:'superseded'}));assert.equal(assessUnitShares(data).state,'ready');
 data.basis.kind='unknown';assert.equal(assessUnitShares(data).state,'conflict');
 for(const patch of [{rows:null},{rows:[null]},{interval:null},{participants:null}])assert.notEqual(assessUnitShares({...input(),...patch}).state,'ready');
});
console.log(`PASS: ${groups} synthetic unit-share domain groups; no API, DB, Auth or browser operations.`);
