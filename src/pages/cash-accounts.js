import {cashAccountFeed,saveCashAccount,deactivateCashAccount} from '../services/cash-accounts.js';
import {renderCashAccounts} from '../ui/cash-accounts.js';
import {financeState} from '../ui/finance-help.js';
export async function refreshCashAccounts(){
 const root=document.getElementById('cash-accounts');root.replaceChildren();root.dataset.ready='false';root.dataset.state='loading';root.textContent='Зареждане на паричните сметки…';
 try{const data=await cashAccountFeed(),refresh=fn=>async(...args)=>{await fn(...args);await refreshCashAccounts();};renderCashAccounts(root,data,{save:refresh(saveCashAccount),deactivate:refresh(deactivateCashAccount)});}
 catch(e){root.replaceChildren();financeState(root,e.code==='42501'?'no-access':'error',e.code==='42501'?'Нямаш достъп до паричните сметки.':'Паричните сметки не са заредени поради техническа грешка. Натисни „Обнови“.');}root.dataset.ready='true';
}
