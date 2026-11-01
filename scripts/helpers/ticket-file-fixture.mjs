import {randomUUID} from 'node:crypto';
import {unitFileFixture} from './unit-file-fixture.mjs';
export async function ticketFileFixture(){
 const f=await unitFileFixture();
 try{
  await f.as('orgA','select public.revoke_staff_role($1)',[f.docRole]);
  f.ticketRole=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['manage_tickets']) id",[f.org.A,f.auth.doc,f.scope.A])).rows[0].id;
  f.ticket=(await f.as('owner',"select public.create_ticket($1,'Synthetic attachment','Synthetic attachment test') id",[f.unit.A])).rows[0].id;
  // A second verified co-owner of the SAME unit still has no reporter access.
  const today=(await f.db.query("select (now() at time zone 'Europe/Sofia')::date::text d")).rows[0].d;
  const person=(await f.as('A',"select public.save_scoped_person($1,null,0,'physical','Synthetic co-owner',null,null,'active','document','Synthetic',$2) id",[f.scope.A,today])).rows[0].id;
  await f.as('A',"select public.verify_scoped_person($1,$2,1,'Synthetic')",[f.scope.A,person]);
  const original=(await f.db.query("select id from public.ownership_periods where unit_id=$1 and record_state='current'",[f.unit.A])).rows[0].id;
  const ownership=(await f.as('A',"select public.apply_ownership_changes($1,$2,$3,$4,'Synthetic','document','Synthetic',$5,'Synthetic') ids",[f.scope.A,f.unit.A,randomUUID(),JSON.stringify([{target:original,person_id:f.person.A,fraction:'0.5',valid_from:today,valid_to:null},{person_id:person,fraction:'0.5',valid_from:today,valid_to:null}]),today])).rows[0].ids;
  for(const record of ownership)await f.as('A',"select public.review_ownership($1,$2,$3,$4,'Synthetic')",[f.scope.A,f.unit.A,record,today]);
  f.coownerLink=(await f.as('A','select public.confirm_owner_link($1,$2,$3,1,$4,$5,$6) id',[f.scope.A,f.auth.B,person,'Synthetic','Synthetic',randomUUID()])).rows[0].id;
  f.coownerTicket=(await f.as('B',"select public.create_ticket($1,'Synthetic other reporter','Synthetic') id",[f.unit.A])).rows[0].id;
  const foreignRole=(await f.as('B',"select id from public.user_roles where scope_id=$1 and role_code='manager'",[f.scope.B])).rows[0].id;
  await f.as('orgB','select public.revoke_staff_role($1)',[foreignRole]);
  f.foreignTicketRole=(await f.as('orgB',"select public.assign_staff_role($1,$2,$3,'manager',array['manage_tickets']) id",[f.org.B,f.auth.B,f.scope.B])).rows[0].id;
  return f;
 }catch(error){await f.db.close();throw error;}
}
