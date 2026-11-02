import {ticketAssignees,updateTicketHandling} from '../services/tickets.js';
import {renderTicketHandling} from '../ui/ticket-handling.js';
export async function mountTicketHandling(body,ticket,onChanged){
 if(!ticket.can_manage)return;
 const root=document.createElement('section');root.dataset.handling=ticket.id;body.append(root);
 try{const candidates=await ticketAssignees(ticket.id);renderTicketHandling(root,ticket,candidates,async(category,assignee,note)=>{await updateTicketHandling(ticket,category,assignee,note);await onChanged();});}
 catch{renderTicketHandling(root,ticket,null,()=>{});}
}
