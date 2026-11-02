import './main.js';
import {loadAccount} from '../services/auth.js';
import {financialDraftFeed,saveFinancialResolution,saveFinancialRule} from '../services/financial-drafts.js';
import {renderFinancialDrafts} from '../ui/financial-drafts.js';
import {message} from '../ui/forms.js';
const root=document.querySelector('#finance-drafts');
async function refresh(){
 root.dataset.ready='false';
 if(!await loadAccount()){root.textContent='Влез с потвърден акаунт. Подготовката и прегледът изискват отделни финансови права.';root.dataset.ready='true';return;}
 const data=await financialDraftFeed();
 renderFinancialDrafts(root,data,async(kind,scope,record,payload,note)=>{await(kind==='resolution'?saveFinancialResolution:saveFinancialRule)(scope,record,payload,note);await refresh();message('Черновата и причината са записани в историята.');});root.dataset.ready='true';
}
document.querySelector('#refresh-finance').addEventListener('click',()=>refresh().catch(()=>message('Прегледът е отказан или услугата не е достъпна.',true)));
refresh().catch(()=>{root.textContent='Прегледът е отказан или услугата не е достъпна.';root.dataset.ready='true';});
