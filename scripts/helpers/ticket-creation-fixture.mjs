import {ticketHandlingFixture} from './ticket-handling-fixture.mjs';
export async function ticketCreationFixture(){const f=await ticketHandlingFixture();try{
 await f.as('orgA','select public.revoke_staff_role($1)',[f.ticketRole]);
 f.emptyRole=(await f.as('orgB',"select public.assign_staff_role($1,$2,$3,'manager',array['manage_tickets']) id",[f.org.B,f.auth.doc,f.scope.B])).rows[0].id;
 f.contexts=who=>f.as(who,'select public.ticket_contexts() data').then(r=>r.rows[0].data);
 f.create=(who,category,unit=f.unit.A,title='Synthetic P2 title',description='Synthetic P2 description')=>f.as(who,'select public.create_ticket($1,$2,$3,$4) id',[unit,title,description,category]).then(r=>r.rows[0].id);
 f.feed=who=>f.as(who,'select public.ticket_feed() data').then(r=>r.rows[0].data);
 return f;
}catch(e){await f.db.close();throw e;}}
