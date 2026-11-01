import './main.js';
import {loadAccount} from '../services/auth.js';
import {myOwnedUnits} from '../services/owner-access.js';
import {createTicket,ticketFeed,changeTicketStatus} from '../services/tickets.js';
import {bindForm,message,option} from '../ui/forms.js';
import {renderTickets} from '../ui/tickets.js';
const create=document.querySelector('#ticket-create'),list=document.querySelector('#ticket-list'),refreshButton=document.querySelector('#refresh-tickets');
async function refresh(){
 create.hidden=true;list.replaceChildren();list.dataset.ready='false';
 const account=await loadAccount();
 if(!account){document.querySelector('#ticket-access').textContent='Влез с потвърден акаунт за разрешените сигнали.';refreshButton.hidden=true;return;}
 const [units,tickets]=await Promise.all([myOwnedUnits(),ticketFeed()]);
 const select=document.querySelector('#ticket-unit');select.replaceChildren();
 for(const u of units)option(select,u.unit_id,`${u.scope_label} · Имот ${u.unit_number}`);
 create.hidden=!units.length;refreshButton.hidden=false;
 document.querySelector('#ticket-access').textContent='Показани са собствените текущо разрешени сигнали и сигналите в обхвати с изрично право за обработка.';
 renderTickets(list,tickets,async(ticket,status,note)=>{await changeTicketStatus(ticket,status,note);await refresh();message('Статусът и основанието са записани в историята.');});
 list.dataset.ready='true';
}
bindForm('#new-ticket',async(data,form)=>{await createTicket(String(data.get('unit')),data.get('title'),data.get('description'));form.reset();await refresh();message('Сигналът е подаден.');});
refreshButton.addEventListener('click',()=>refresh().catch(()=>message('Неуспешно обновяване. Опитай отново.',true)));
refresh().catch(()=>message('Сигналите не могат да се заредят. Провери сесията и достъпа.',true));
