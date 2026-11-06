import {ticketCategoriesBg as categories,ticketHandlingBg as t} from '../i18n/ticket-handling-bg.js';
import {ticketCategoryCodes} from '../domain/ticket-handling.js';
import {ticketStatuses} from '../domain/tickets.js';
const el=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=text??'';if(cls)e.className=cls;return e;};
export const categoryName=code=>code==null?t.uncategorized:categories[code]||'Непозната категория';
const staffName=(id,name)=>id?(name||t.employee):t.unassigned;
export function ticketHandlingSummary(ticket){
 const box=el('div','','mb-3 text-break');box.dataset.handlingSummary='';
 box.append(el('p','Категория: '+categoryName(ticket.category_code),'mb-1'),el('p','Отговорник: '+staffName(ticket.assignee_profile_id,ticket.assignee_name),'mb-1'));
 if(ticket.assignee_profile_id&&ticket.assignee_eligible===false)box.append(el('p',t.inactive,'small text-warning-emphasis mb-1'));
 return box;
}
export function ticketEventLabel(event){
 if(event.event_type==='created'&&event.created_category_code)return 'Подаден · Категория: '+categoryName(event.created_category_code);
 if(event.event_type!=='handling_changed')return ticketStatuses[event.to_status]||event.to_status;
 const d=event.handling_delta||{},parts=[];
 if(d.category)parts.push(`Категория: ${categoryName(d.category.from)} → ${categoryName(d.category.to)}`);
 if(d.assignee)parts.push(`Отговорник: ${staffName(d.assignee.from,d.assignee.from_name)} → ${staffName(d.assignee.to,d.assignee.to_name)}`);
 return parts.join('; ');
}
export function renderTicketHandling(root,ticket,candidates,onSave){
 root.replaceChildren();if(!candidates){root.append(el('p','Настройките на сигнала не са достъпни. Обнови сигналите.','text-danger'));return;}
 const details=el('details','','mt-3'),summary=el('summary','Категория и отговорник'),form=el('form','','mt-3');form.dataset.handlingForm=ticket.id;details.append(summary,form);root.append(details);
 function field(name,label,input){input.id=`ticket-${name}-${ticket.id}`;input.name=name;const l=el('label',label,'form-label');l.htmlFor=input.id;form.append(l,input);return input;}
 const category=field('category','Категория',el('select','','form-select mb-3')),assignee=field('assignee','Отговорник',el('select','','form-select mb-3'));
 for(const code of [null,...ticketCategoryCodes]){const o=el('option',categoryName(code));o.value=code||'';category.append(o);}category.value=ticket.category_code||'';
 const empty=el('option',t.unassigned);empty.value='';assignee.append(empty);
 for(const p of candidates){const o=el('option',`${p.display_name||t.employee} (${p.profile_id.slice(0,8)})`);o.value=p.profile_id;assignee.append(o);}
 if(ticket.assignee_profile_id&&!candidates.some(p=>p.profile_id===ticket.assignee_profile_id)){const o=el('option',`${ticket.assignee_name||t.employee} — ${t.inactive}`);o.value=ticket.assignee_profile_id;assignee.append(o);}
 assignee.value=ticket.assignee_profile_id||'';
 const validate=()=>assignee.setCustomValidity(assignee.value&&!candidates.some(p=>p.profile_id===assignee.value)?t.invalidAssignee:'');validate();assignee.addEventListener('change',validate);
 const note=field('handling_note',t.reason,el('textarea','','form-control mb-2'));note.required=true;note.maxLength=1000;note.rows=2;
 const button=el('button',t.save,'btn btn-secondary'),error=el('p','','text-danger mt-2');error.setAttribute('role','alert');form.append(el('p',t.hint,'small'),button,error);
 form.addEventListener('submit',async e=>{e.preventDefault();validate();if(!form.reportValidity())return;button.disabled=true;error.textContent='';try{await onSave(category.value||null,assignee.value||null,note.value);}catch(e){error.textContent=e?.code==='PT409'?t.conflict:t.failed;button.disabled=false;}});
}
