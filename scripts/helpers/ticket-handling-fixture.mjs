import {ticketFileFixture} from './ticket-file-fixture.mjs';
export async function ticketHandlingFixture(){
 const f=await ticketFileFixture();
 try{
  const prior=(await f.as('A',"select id from public.user_roles where scope_id=$1 and role_code='manager' and valid_to is null",[f.scope.A])).rows[0].id;
  await f.as('orgA','select public.revoke_staff_role($1)',[prior]);
  f.assigneeRole=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['manage_tickets']) id",[f.org.A,f.auth.A,f.scope.A])).rows[0].id;
  f.assigneeMember=(await f.as('A','select membership_id from public.user_roles where id=$1',[f.assigneeRole])).rows[0].membership_id;
  return f;
 }catch(e){await f.db.close();throw e;}
}
