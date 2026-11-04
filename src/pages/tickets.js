import './main.js';
import {loadAccount} from '../services/auth.js';
import {myOwnedUnits} from '../services/owner-access.js';
import {createTicket,ticketFeed,ticketContexts,changeTicketStatus} from '../services/tickets.js';
import {bindForm,message,option} from '../ui/forms.js';
import {renderTickets} from '../ui/tickets.js';
import {mountTicketFiles} from './ticket-files.js';
import {getWorkspaceScope} from '../ui/workspace-context.js';
import {mountTicketHandling} from './ticket-handling.js';
import {ticketCategoryCodes} from '../domain/ticket-handling.js';
import {ticketCategoriesBg} from '../i18n/ticket-handling-bg.js';
import {ticketCreationBg as bg} from '../i18n/ticket-creation-bg.js';
const create=document.querySelector('#ticket-create'),list=document.querySelector('#ticket-list'),refreshButton=document.querySelector('#refresh-tickets');
const category=document.querySelector('#ticket-category');option(category,'',bg.choose);for(const code of ticketCategoryCodes)option(category,code,ticketCategoriesBg[code]);
list.setAttribute('aria-live','polite');
let loadGeneration=0;
async function refresh(){
 const generation=++loadGeneration;
 create.hidden=true;list.replaceChildren();list.dataset.ready='false';list.dataset.state='loading';document.querySelector('#ticket-access').textContent=bg.loading;
 try{
 const account=await loadAccount();
 if(generation!==loadGeneration)return;
 if(!account){document.querySelector('#ticket-access').textContent=bg.signedOut;refreshButton.hidden=true;list.dataset.state='signed-out';list.dataset.ready='true';return;}
 refreshButton.hidden=false;
 const [allUnits,allTickets,contexts]=await Promise.all([myOwnedUnits(),ticketFeed(),ticketContexts()]);
 if(generation!==loadGeneration)return;
 const scope=getWorkspaceScope(),units=allUnits.filter(u=>!scope||u.scope_id===scope),tickets=allTickets.filter(t=>!scope||t.scope_id===scope);
 const allowed=units.length>0||contexts.some(c=>!scope||c.scope_id===scope);
 const select=document.querySelector('#ticket-unit');select.replaceChildren();
 if(!allowed){list.textContent=bg.noAccess;document.querySelector('#ticket-access').textContent=bg.noAccess;list.dataset.state='no-access';list.dataset.ready='true';return;}
 for(const u of units)option(select,u.unit_id,`${u.scope_label} · Имот ${u.unit_number}`);
 create.hidden=!units.length;refreshButton.hidden=false;
 document.querySelector('#ticket-access').textContent=units.length?bg.owner:bg.staff;
 const attachments=[];
 renderTickets(list,tickets,async(ticket,status,note)=>{await changeTicketStatus(ticket,status,note);await refresh();message('Статусът и основанието са записани в историята.');},(body,ticket)=>attachments.push(mountTicketFiles(body,ticket)),(body,ticket)=>attachments.push(mountTicketHandling(body,ticket,refresh)));
 await Promise.all(attachments);
 if(generation!==loadGeneration)return;
 list.dataset.ready='true';list.dataset.state=tickets.length?'ready':'empty';if(!tickets.length)list.textContent=units.length?bg.emptyOwner:bg.emptyStaff;
 }catch(error){if(generation!==loadGeneration)return;create.hidden=true;list.replaceChildren();refreshButton.hidden=false;list.dataset.ready='true';list.dataset.state=error?.code==='42501'?'no-access':'error';list.textContent=error?.code==='42501'?bg.noAccess:bg.error;document.querySelector('#ticket-access').textContent=list.textContent;}
}
bindForm('#new-ticket',async(data,form)=>{await createTicket(String(data.get('unit')),data.get('title'),data.get('description'),data.get('category'));form.reset();await refresh();message('Сигналът и категорията са записани.');});
refreshButton.addEventListener('click',refresh);
window.addEventListener('workspace-scope',refresh);
window.addEventListener('focus',refresh);
refresh();
