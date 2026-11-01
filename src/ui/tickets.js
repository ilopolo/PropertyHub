import {ticketStatuses,nextTicketStatus} from '../domain/tickets.js';
function element(tag,text,cls){const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;}
export function renderTickets(root,tickets,onTransition){
 if(!tickets.length){root.append(element('p','Няма разрешени сигнали.'));return;}
 for(const ticket of tickets){
  const card=element('article','','card mb-3'),body=element('div','','card-body p-4 text-break');card.dataset.ticket=ticket.id;
  const description=element('p',ticket.description);description.style.whiteSpace='pre-wrap';
  body.append(element('h2',ticket.title,'h4'),element('p',`${ticket.scope_label} · Имот ${ticket.unit_number}`,'small'),description,element('p',`Статус: ${ticketStatuses[ticket.status]}`,'fw-bold'));
  const details=element('details',''),summary=element('summary','История на сигнала'),history=element('ol','','mt-3');details.append(summary,history);
  for(const event of ticket.events)history.append(element('li',`${ticketStatuses[event.to_status]} · ${new Date(event.created_at).toLocaleString('bg-BG')}${event.body?' · '+event.body:''}`));
  body.append(details);
  if(ticket.can_manage){
   const form=element('form','','mt-3'),label=element('label',ticket.status==='completed'?'Причина за повторно отваряне':'Основание / резултат','form-label'),input=element('textarea','','form-control mb-3'),button=element('button',ticket.status==='completed'?'Отвори повторно':`Промени на „${ticketStatuses[nextTicketStatus(ticket.status)]}“`,'btn btn-outline-secondary');
   input.id=`ticket-note-${ticket.id}`;label.htmlFor=input.id;input.name='note';input.maxLength=1000;input.required=true;input.rows=2;
   form.append(label,input,element('p','Основанието / резултатът се вижда и от подателя.','small'),button);form.addEventListener('submit',async event=>{event.preventDefault();if(!form.reportValidity())return;button.disabled=true;try{await onTransition(ticket,nextTicketStatus(ticket.status),input.value.trim());}catch{const error=element('p','Промяната е отказана. Обнови сигналите и провери правата.','text-danger');error.setAttribute('role','alert');form.append(error);button.disabled=false;}});body.append(form);
  }
  card.append(body);root.append(card);
 }
}
