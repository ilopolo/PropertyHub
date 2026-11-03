import './main.js';
import {loadAccount} from '../services/auth.js';
import {myOwnedUnits} from '../services/owner-access.js';
import {createTicket,ticketFeed,changeTicketStatus} from '../services/tickets.js';
import {bindForm,message,option} from '../ui/forms.js';
import {renderTickets} from '../ui/tickets.js';
import {mountTicketFiles} from './ticket-files.js';
import {getWorkspaceScope} from '../ui/workspace-context.js';
const create=document.querySelector('#ticket-create'),list=document.querySelector('#ticket-list'),refreshButton=document.querySelector('#refresh-tickets');
let loadGeneration=0;
async function refresh(){
 const generation=++loadGeneration;
 create.hidden=true;list.replaceChildren();list.dataset.ready='false';list.dataset.state='loading';document.querySelector('#ticket-access').textContent='Зареждане на сигналите…';
 const account=await loadAccount();
 if(generation!==loadGeneration)return;
 if(!account){document.querySelector('#ticket-access').textContent='Влез с потвърден акаунт за разрешените сигнали.';refreshButton.hidden=true;list.dataset.state='signed-out';list.dataset.ready='true';return;}
 const [allUnits,allTickets]=await Promise.all([myOwnedUnits(),ticketFeed()]);
 if(generation!==loadGeneration)return;
 const scope=getWorkspaceScope(),units=allUnits.filter(u=>!scope||u.scope_id===scope),tickets=allTickets.filter(t=>!scope||t.scope_id===scope);
 const select=document.querySelector('#ticket-unit');select.replaceChildren();
 for(const u of units)option(select,u.unit_id,`${u.scope_label} · Имот ${u.unit_number}`);
 create.hidden=!units.length;refreshButton.hidden=false;
 document.querySelector('#ticket-access').textContent=units.length?'Подай сигнал за свой разрешен имот или прегледай подадените сигнали.':'За подаване е нужен проверен собствен достъп; обработката изисква отделно служебно право.';
 const attachments=[];
 renderTickets(list,tickets,async(ticket,status,note)=>{await changeTicketStatus(ticket,status,note);await refresh();message('Статусът и основанието са записани в историята.');},(body,ticket)=>attachments.push(mountTicketFiles(body,ticket)));
 await Promise.all(attachments);
 if(generation!==loadGeneration)return;
 list.dataset.ready='true';list.dataset.state=tickets.length?'ready':'empty';if(!tickets.length)list.textContent=units.length?'Още нямаш подадени сигнали за избрания контекст. Използвай „Подай сигнал“.':'Няма видими сигнали за избрания контекст. Провери достъпа в акаунта си.';
}
bindForm('#new-ticket',async(data,form)=>{await createTicket(String(data.get('unit')),data.get('title'),data.get('description'));form.reset();await refresh();message('Сигналът е подаден.');});
refreshButton.addEventListener('click',()=>refresh().catch(failed));
const failed=error=>{list.dataset.ready='true';list.dataset.state=error?.code==='42501'?'no-access':'error';list.textContent=error?.code==='42501'?'Нямаш текущо право за тези сигнали. Провери достъпа в акаунта си.':'Сигналите не са заредени поради техническа грешка. Опитай „Обнови сигналите“.';};
window.addEventListener('workspace-scope',()=>refresh().catch(failed));
refresh().catch(failed);
