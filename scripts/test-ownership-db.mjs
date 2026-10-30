import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function testOwnership({db,as,ok,denied,scope,unit,person}) {
 const today=(await db.query("select (now() at time zone 'Europe/Sofia')::date::text d")).rows[0].d;
 const tomorrow=(await db.query('select ($1::date+1)::text d',[today])).rows[0].d;
 const row=(pid,fraction,from=today,to=null,target=null)=>({person_id:pid,fraction,valid_from:from,valid_to:to,target});
 const sql=`select public.apply_ownership_changes($1,$2,$3,$4::jsonb,'Synthetic registry change','document','Synthetic ownership source',$5,'Known only from documented registry date; not acquisition') ids`;
 const apply=(who,changes,key=randomUUID(),s=scope.A,u=unit.A)=>as(who,sql,[s,u,key,JSON.stringify(changes),today]);
 const read=async(who='managerA',date=today,s=scope.A,u=unit.A)=>(await as(who,'select public.read_ownership($1,$2,$3) value',[s,u,date])).rows[0].value;
 const review=(target=null,date=today,who='managerA')=>as(who,"select public.review_ownership($1,$2,$3,$4,'Synthetic source reviewed')",[scope.A,unit.A,target,date]);
 let first,second;
 await ok('ownership: partial share, exact decimals, explicit incomplete set and idempotent request',async()=>{
  const key=randomUUID(),changes=[row(person.A,'0.5')];first=(await apply('managerA',changes,key)).rows[0].ids[0];
  assert.equal((await apply('managerA',changes,key)).rows[0].ids[0],first);
  await denied(()=>apply('managerA',[row(person.A,'0.4')],key));
  const data=await read();assert.equal(data.total_fraction,'0.5000000000');assert.equal(data.set_reviewed,false);assert.equal(data.records.length,1);
  await denied(()=>review());
 });
 await ok('ownership: foreign scope/person, pending/org/platform and direct mutations refused',async()=>{
  for(const who of ['pending','orgA','platform','managerB'])await denied(()=>apply(who,[row(person.A,'0.5')]));
  await denied(()=>apply('managerA',[row(person.B,'0.5')]));
  await denied(()=>read('managerA',today,scope.B,unit.B));
  assert.equal((await as('managerB','select * from public.ownership_periods')).rows.length,0);
  for(const who of ['pending','orgA','platform'])assert.equal((await as(who,'select * from public.ownership_periods')).rows.length,0);
  await denied(()=>as('managerA',"update public.ownership_periods set ownership_fraction=1 where id=$1",[first]));
  await denied(()=>as('managerA','delete from public.ownership_periods where id=$1',[first]));
  await denied(()=>as('managerA',"insert into public.ownership_set_reviews(scope_id,unit_id,as_of,fingerprint,record_ids,reviewed_by,note) values($1,$2,current_date,'forged','{}',private.actor(),'forged')",[scope.A,unit.A]));
 });
 await ok('ownership: bad fractions/precision, duplicate overlap, future totals and invalid parent period refused atomically',async()=>{
  for(const fraction of ['0','-0.1','1.00000000001','0.12345678901','1e-1'])await denied(()=>apply('managerA',[row(person.duplicate,fraction)]));
  await denied(()=>apply('managerA',[row(person.A,'0.1')]));
  await denied(()=>apply('managerA',[row(person.duplicate,'0.6',tomorrow)]));
  await denied(()=>apply('managerA',[row(person.duplicate,'0.5','2000-01-01')]));
  assert.equal((await read()).records.length,1);
 });
 await ok('ownership: coowners total one is not reviewed until each row AND set explicitly reviewed',async()=>{
  second=(await apply('managerA',[row(person.duplicate,'0.5')])).rows[0].ids[0];
  assert.equal((await read()).total_fraction,'1.0000000000');assert.equal((await read()).set_reviewed,false);
  await denied(()=>review());await review(first);await review(second);assert.equal((await read()).set_reviewed,false);await review();assert.equal((await read()).set_reviewed,true);
 });
 await ok('ownership: atomic sale boundary, original history retained, stale correction denied, set review invalidates',async()=>{
  const changes=[row(person.A,'0.5',today,tomorrow,first),row(person.duplicate,'0.5',today,tomorrow,second),row(person.A,'1',tomorrow)];
  const ids=(await apply('managerA',changes)).rows[0].ids;assert.equal(ids.length,3);
  const now=await read(),future=await read('managerA',tomorrow);
  assert.equal(now.total_fraction,'1.0000000000');assert.equal(now.set_reviewed,false);assert.equal(future.total_fraction,'1.0000000000');
  const old=now.records.find(p=>p.id===first);assert.equal(old.record_state,'superseded');assert.equal(old.valid_to,null);assert.equal(old.verification_status,'verified');
  assert.equal(now.records.find(p=>p.id===ids[0]).verification_status,'needs_review');
  await denied(()=>apply('managerA',[row(person.A,'0.4',today,tomorrow,first)]));
  const count=now.records.length;
  await denied(()=>apply('managerA',[row(person.A,'0.7',today,null,ids[0]),row(person.duplicate,'0.5',today,null,ids[1])]));
  const unchanged=await read();assert.equal(unchanged.records.length,count);assert.equal(unchanged.records.find(p=>p.id===ids[0]).record_state,'current');
  await apply('managerA',[{target:ids[2],void:true}]);assert.equal((await read('managerA',tomorrow)).total_fraction,'0');
  assert.equal((await read()).records.find(p=>p.id===ids[2]).record_state,'voided');
 });
}
