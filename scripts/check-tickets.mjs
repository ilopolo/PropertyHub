import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {unitFileFixture} from './helpers/unit-file-fixture.mjs';
import {ticketContent,nextTicketStatus} from '../src/domain/tickets.js';
const checks=[],f=await unitFileFixture();
async function denied(label,sql,args,code){await assert.rejects(f.as(label,sql,args),e=>!code||e.code===code);}
try{
 assert.deepEqual(ticketContent(' Test ',' Description '),{title:'Test',description:'Description'});
 for(const pair of [['','x'],['x',''],['x'.repeat(161),'ok'],['ok','x'.repeat(4001)]])assert.throws(()=>ticketContent(...pair));
 assert.equal(ticketContent('😀'.repeat(160),'x').title.length,320);assert.equal(nextTicketStatus('completed'),'in_progress');checks.push('domain required content, exact Unicode limits and transitions');
 const id=(await f.as('owner','select public.create_ticket($1,$2,$3) id',[f.unit.A,'Synthetic leak','Synthetic description'])).rows[0].id;
 const row=(await f.as('owner','select * from public.work_items')).rows[0];assert.equal(row.scope_id,f.scope.A);assert.equal(row.reporter_profile_id,f.profile.owner);assert.equal(row.status,'new');
 assert.equal((await f.as('owner','select * from public.work_item_events')).rows.length,1);
 for(const who of ['anon','pending','A','B','platform','orgA','doc']){
  await denied(who,'select public.create_ticket($1,$2,$3)',[f.unit.A,'bad','bad'],'42501');
  if(who!=='anon')assert.equal((await f.as(who,'select * from public.work_items')).rows.length,0);
 }
 await denied('owner','select public.create_ticket($1,$2,$3)',[f.unit.B,'bad','bad'],'42501');
 for(const pair of [['','x'],['x',''],['x'.repeat(161),'ok'],['ok','x'.repeat(4001)]])await denied('owner','select public.create_ticket($1,$2,$3)',[f.unit.A,...pair],'23514');
 checks.push('server derives author/scope/new; only verified current owner can create; foreign unit and invalid content denied');
 for(const who of ['owner','A','orgA','platform']){
  await denied(who,"update public.work_items set status='completed' where id=$1",[id],'42501');
  await denied(who,"insert into public.work_items(scope_id,unit_id,reporter_profile_id,title,description) values($1,$2,$3,'forged','forged')",[f.scope.A,f.unit.A,f.profile.pending],'42501');
  await denied(who,'delete from public.work_item_events where item_id=$1',[id],'42501');
  await denied(who,"select public.change_ticket_status($1,1,'accepted','forged')",[id],'42501');
 }
 checks.push('direct forged author/unit/scope/status writes and event edits denied; no platform/org/registry inheritance');
 await f.as('orgA','select public.revoke_staff_role($1)',[f.docRole]);
 const role=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['manage_tickets']) id",[f.org.A,f.auth.doc,f.scope.A])).rows[0].id;
 assert.equal((await f.as('doc','select * from public.work_items')).rows.length,1);
 const feed=(await f.as('doc','select public.ticket_feed() data')).rows[0].data;assert.equal(feed[0].can_manage,true);assert.equal(feed[0].events.length,1);
 await denied('B',"select public.change_ticket_status($1,1,'accepted','foreign')",[id],'42501');
 await denied('doc',"select public.change_ticket_status($1,1,'completed','skip')",[id],'23514');
 await denied('doc',"select public.change_ticket_status($1,1,'accepted','')",[id],'23514');
 await denied('doc','select public.change_ticket_status($1,1,null,$2)',[id,'bad'],'23514');
 for(const [i,status] of ['accepted','in_progress','completed','in_progress'].entries())await f.as('doc','select public.change_ticket_status($1,$2,$3,$4)',[id,i+1,status,'Synthetic result/reopen reason']);
 await denied('doc',"select public.change_ticket_status($1,1,'completed','stale')",[id],'PT409');
 const final=(await f.db.query('select * from public.work_items where id=$1',[id])).rows[0];assert.equal(final.revision,5);assert.equal(final.completed_on,null);
 const events=(await f.db.query('select * from public.work_item_events where item_id=$1 order by revision',[id])).rows;assert.equal(events.length,5);assert.equal(events[3].to_status,'completed');assert.equal(events[4].from_status,'completed');assert.equal(events[4].actor_profile_id,f.profile.doc);
 assert.equal((await f.db.query("select * from public.audit_events where target_id=$1",[id])).rows.length,5);
 await assert.rejects(f.db.query("update public.work_item_events set body='tampered' where item_id=$1",[id]),e=>e.code==='42501');
 checks.push('explicit manager grant; ordered transitions/reopen reason; stale revision refusal; append-only event/audit history');
 // Even another verified co-owner does not inherit the reporter's private signal.
 const today=(await f.db.query("select (now() at time zone 'Europe/Sofia')::date::text d")).rows[0].d;
 const person=(await f.as('A',"select public.save_scoped_person($1,null,0,'physical','Synthetic co-owner',null,null,'active','document','Synthetic',$2) id",[f.scope.A,today])).rows[0].id;
 await f.as('A',"select public.verify_scoped_person($1,$2,1,'Synthetic')",[f.scope.A,person]);
 const original=(await f.db.query("select id from public.ownership_periods where unit_id=$1 and record_state='current'",[f.unit.A])).rows[0].id;
 const ownership=(await f.as('A',"select public.apply_ownership_changes($1,$2,$3,$4,'Synthetic','document','Synthetic',$5,'Synthetic') ids",[f.scope.A,f.unit.A,randomUUID(),JSON.stringify([{target:original,person_id:f.person.A,fraction:'0.5',valid_from:today,valid_to:null},{person_id:person,fraction:'0.5',valid_from:today,valid_to:null}]),today])).rows[0].ids;
 for(const record of ownership)await f.as('A',"select public.review_ownership($1,$2,$3,$4,'Synthetic')",[f.scope.A,f.unit.A,record,today]);
 await f.as('A','select public.confirm_owner_link($1,$2,$3,1,$4,$5,$6)',[f.scope.A,f.auth.B,person,'Synthetic','Synthetic',randomUUID()]);
 assert.equal((await f.as('B','select * from public.my_owned_units()')).rows.length,1);
 assert.equal((await f.as('B','select * from public.work_items')).rows.length,0);
 assert.equal((await f.as('B','select public.ticket_feed() data')).rows[0].data.length,0);
 checks.push('other verified owner of same unit cannot read foreign reporter or events');
 await f.as('orgA','select public.revoke_staff_role($1)',[role]);assert.equal((await f.as('doc','select public.ticket_feed() data')).rows[0].data.length,0);
 await f.as('A','select public.revoke_owner_link($1,$2,$3,$4)',[f.scope.A,f.link,'Synthetic','Synthetic revoke']);
 assert.equal((await f.as('owner','select public.ticket_feed() data')).rows[0].data.length,0);assert.equal((await f.as('owner','select * from public.work_item_events')).rows.length,0);
 await denied('owner','select public.create_ticket($1,$2,$3)',[f.unit.A,'bad','revoked'],'42501');checks.push('fresh local identity evaluation after scoped role and owner link revocation');
 await mkdir('.local/tickets-qa',{recursive:true});await writeFile('.local/tickets-qa/db.json',JSON.stringify({pass:true,runtime:'disposable PGlite; simulated Auth identity, not hosted Supabase',checks},null,2));console.log('PASS tickets DB/RLS/domain:',checks.length,'groups');
}finally{await f.db.close();}
