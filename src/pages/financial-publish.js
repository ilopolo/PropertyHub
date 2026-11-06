import {chargeBatchFeed,loadChargeBatchInputs,saveChargeBatch,reviewChargeBatch,publishChargeBatch} from '../services/financial-publish.js';
import {renderChargeBatches} from '../ui/financial-publish.js';
import {financeState} from '../ui/finance-help.js';
export async function refreshChargeBatches(){
 const root=document.querySelector('#financial-publish');root.dataset.ready='false';root.dataset.state='loading';root.textContent='Зареждане на начисленията…';
 try{const data=await chargeBatchFeed();renderChargeBatches(root,data,{load:loadChargeBatchInputs,
  save:async(...args)=>{await saveChargeBatch(...args);await refreshChargeBatches();},
  review:async(...args)=>{await reviewChargeBatch(...args);await refreshChargeBatches();},
  publish:async(...args)=>{await publishChargeBatch(...args);await refreshChargeBatches();}});
 }catch(error){root.replaceChildren();financeState(root,error.code==='42501'?'no-access':'error',error.code==='42501'?'Нямаш достъп до начисленията.':'Начисленията не са заредени поради техническа грешка. Натисни „Обнови“.');}
 root.dataset.ready='true';
}
