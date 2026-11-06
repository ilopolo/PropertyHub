import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {mkdir,writeFile} from 'node:fs/promises';
import {ticketHandlingFixture} from './helpers/ticket-handling-fixture.mjs';import {ticketCategoryCodes,ticketHandling} from '../src/domain/ticket-handling.js';import {ticketCategoriesBg} from '../src/i18n/ticket-handling-bg.js';
const f=await ticketHandlingFixture(),checks=[],feed=async who=>(await f.as(who,'select public.ticket_feed() data')).rows[0].data,targets=async who=>(await f.as(who,'select public.ticket_assignees($1) data',[f.ticket])).rows[0].data;
const change=(who,rev,cat,person,note='Synthetic handling reason')=>f.as(who,'select public.update_ticket_handling($1,$2,$3,$4,$5)',[f.ticket,rev,cat,person,note]);
const denied=(p,code)=>assert.rejects(p,e=>e.code===code),snapshot=async()=>({row:(await f.db.query('select * from public.work_items where id=$1',[f.ticket])).rows[0],events:(await f.db.query('select * from public.work_item_events where item_id=$1 order by revision',[f.ticket])).rows,audits:(await f.db.query('select * from public.audit_events where target_id=$1 order by happened_at,id',[f.ticket])).rows});
try{
 assert.deepEqual(Object.keys(ticketCategoriesBg),ticketCategoryCodes);assert.equal(ticketCategoryCodes.length,9);assert.deepEqual(ticketHandling(null,null,' reason '),{category:null,assignee:null,note:'reason'});
 for(const args of [['free-text',null,'reason'],['other','not-uuid','reason'],['other',null,''],['other',null,'x'.repeat(1001)],[false,null,'reason']])assert.throws(()=>ticketHandling(...args));
 const initial=await snapshot();assert.equal(initial.row.category_code,null);assert.equal(initial.row.assignee_profile_id,null);assert.equal(initial.row.revision,1);
 assert.deepEqual((await targets('doc')).map(p=>p.profile_id).sort(),[f.profile.A,f.profile.doc].sort());
 for(const who of ['owner','B','orgA','platform','pending','anon']){await denied(targets(who),'42501');await denied(change(who,1,'other',f.profile[who]),'42501');}
 for(const p of [f.profile.owner,f.profile.B,f.profile.pending,f.profile.orgA,f.profile.platform,randomUUID()])await denied(change('doc',1,'other',p),'23514');
 await denied(change('doc',1,'free-text',f.profile.A),'23514');await denied(change('doc',1,'other',f.profile.A,''),'23514');
 await denied(f.as('owner','update public.work_items set assignee_profile_id=$1 where id=$2',[f.profile.owner,f.ticket]),'42501');
 await denied(f.as('doc',"insert into public.work_item_events(scope_id,item_id,event_type,to_status,actor_profile_id,revision) values($1,$2,'status_changed','completed',$3,2)",[f.scope.A,f.ticket,f.profile.doc]),'42501');
 assert.deepEqual(await snapshot(),initial);checks.push('fixed catalog/domain; no backfill; scoped-only minimal directory; invalid/foreign/co-owner/admin/self-escalation/direct DML denial without writes');
 let rev=1;for(const code of ticketCategoryCodes){await change('doc',rev++,code,f.profile.A);const w=(await snapshot()).row;assert.equal(w.category_code,code);assert.equal(w.assignee_profile_id,f.profile.A);assert.equal(w.status,'new');}
 let s=await snapshot();assert.equal(s.events.length,10);assert.equal(s.audits.length,10);assert.equal(s.events[1].handling_delta.category.from,null);assert.equal(s.events[1].handling_delta.assignee.to_name,'Synthetic A');assert.equal(s.events[1].body,'Synthetic handling reason');assert.equal(s.events[1].event_type,'handling_changed');
 await change('doc',rev,'other',f.profile.A);assert.deepEqual(await snapshot(),s);await denied(change('doc',1,'plumbing',null),'PT409');assert.deepEqual(await snapshot(),s);
 await denied(f.as('doc',"select public.change_ticket_status($1,1,'accepted','stale')",[f.ticket]),'PT409');assert.deepEqual(await snapshot(),s);
 assert((await feed('owner')).find(t=>t.id===f.ticket).events.some(e=>e.handling_delta?.assignee));assert(!(await feed('B')).some(t=>t.id===f.ticket));
 await denied(f.db.query("update public.work_item_events set handling_delta='{}' where item_id=$1",[f.ticket]),'42501');checks.push('all nine stable codes; atomic before/after snapshots/reason/shared revision; no-op and stale PT409 leave exact row/event/audit snapshot unchanged');
 const probes=[
  ["update public.profiles set status='disabled' where id=$1","update public.profiles set status='active' where id=$1",f.profile.A],
  ['update auth.users set email_confirmed_at=null where id=$1','update auth.users set email_confirmed_at=now() where id=$1',f.auth.A],
  ['update auth.users set is_anonymous=true where id=$1','update auth.users set is_anonymous=false where id=$1',f.auth.A],
  ["update public.organization_memberships set status='inactive' where id=$1","update public.organization_memberships set status='active' where id=$1",f.assigneeMember],
  ["update public.user_roles set valid_from=now()-interval '2 days',valid_to=now()-interval '1 day' where id=$1",'update public.user_roles set valid_from=now(),valid_to=null where id=$1',f.assigneeRole],
  ["update public.user_roles set valid_from=now()+interval '1 day',valid_to=null where id=$1",'update public.user_roles set valid_from=now(),valid_to=null where id=$1',f.assigneeRole],
  ["update public.organization_memberships set valid_from=now()+interval '1 day',valid_to=null where id=$1",'update public.organization_memberships set valid_from=now(),valid_to=null where id=$1',f.assigneeMember]
 ];
 for(const[off,on,id]of probes){await f.db.query(off,[id]);assert(!(await targets('doc')).some(p=>p.profile_id===f.profile.A));await denied(change('doc',rev,'plumbing',f.profile.A),'23514');await f.db.query(on,[id]);assert((await targets('doc')).some(p=>p.profile_id===f.profile.A));}
 // Global context guards affect both actor and recipient; the actor must fail closed.
 for(const[table,id]of [['organizations',f.org.A],['management_units',f.scope.A]]){await f.db.query(`update public.${table} set status='inactive' where id=$1`,[id]);await denied(change('doc',rev,'other',null),'42501');await f.db.query(`update public.${table} set status='active' where id=$1`,[id]);}
 checks.push('recipient Auth/profile/role/member current eligibility and periods; organization/scope deactivation fail closed');
 await f.as('orgA','select public.revoke_staff_role($1)',[f.assigneeRole]);const revoked=(await feed('owner')).find(t=>t.id===f.ticket);assert.equal(revoked.assignee_profile_id,f.profile.A);assert.equal(revoked.assignee_eligible,false);assert.equal((await feed('A')).length,0);await denied(change('doc',rev,'plumbing',f.profile.A),'23514');
 await change('doc',rev++,null,null,'Synthetic explicit clear');assert.equal((await snapshot()).row.assignee_profile_id,null);
 const roleCount=(await f.db.query('select count(*)::int n from public.user_roles')).rows[0].n;await change('doc',rev++,'administration',f.profile.doc,'Synthetic existing-right self assignment');assert.equal((await f.db.query('select count(*)::int n from public.user_roles')).rows[0].n,roleCount);
 await f.as('doc',"select public.change_ticket_status($1,$2,'accepted','Synthetic status after handling')",[f.ticket,rev]);s=await snapshot();assert.equal(s.row.status,'accepted');assert.equal(s.row.assignee_profile_id,f.profile.doc);assert.equal(s.row.revision,rev+1);assert.equal(s.events.length,s.row.revision);assert.equal(s.audits.length,s.row.revision);
 const acl=(await f.db.query("select has_function_privilege('anon','public.update_ticket_handling(uuid,integer,text,uuid,text)','execute') anon,has_function_privilege('authenticated','private.ticket_eligible_staff(uuid)','execute') helper,has_table_privilege('authenticated','public.work_items','update') dml")).rows[0];assert.deepEqual(acl,{anon:false,helper:false,dml:false});checks.push('revocation retains assignment/history but removes access; explicit clear/reassign; no role creation; status integration and minimal grants');
 await mkdir('.local/ticket-handling-qa',{recursive:true});await writeFile('.local/ticket-handling-qa/db.json',JSON.stringify({pass:true,hosted:false,runtime:'disposable PGlite with simulated Auth identity; no multi-transaction hosted proof',checks,migrations:f.migrations,history:{revision:s.row.revision,events:s.events.length,audits:s.audits.length}},null,2));console.log('PASS category/assignee DB/RLS/domain:',checks.length,'groups');
}finally{await f.db.close();}
