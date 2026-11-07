import * as monthly from '../services/monthly-management.js';
import {chargeBatchFeed,loadChargeBatchInputs,saveChargeBatch,reviewChargeBatch,publishChargeBatch} from '../services/financial-publish.js';
import {renderMonthlyManagement} from '../ui/monthly-management.js';
import {renderChargeBatches} from '../ui/financial-publish.js';
import {financeState} from '../ui/finance-help.js';
export async function refreshMonthlyManagement(){
 const root=document.getElementById('monthly-management'),batches=document.getElementById('monthly-publication');root.dataset.ready='false';root.dataset.state='loading';root.textContent='Зареждане на месечните основания…';batches.replaceChildren();
 try{const data=await monthly.monthlyManagementFeed();const after=fn=>async(...args)=>{const id=await fn(...args);await refreshMonthlyManagement();return id;};
  renderMonthlyManagement(root,data,{context:monthly.loadMonthlyContext,reviewContext:monthly.reviewMonthlyContext,save:after(monthly.saveMonthlyRule),inputs:monthly.loadMonthlyInputs,activate:after(monthly.activateMonthlyRule),preview:after(monthly.createMonthlyPreview)});
 }catch(e){root.replaceChildren();financeState(root,e.code==='42501'?'no-access':'error',e.code==='42501'?'Нямаш текущ достъп до месечния процес.':'Месечните данни не са заредени поради техническа грешка. Обнови; липсващите данни не са нула.');root.dataset.ready='true';return;}
 try{const data=await chargeBatchFeed();data.previews=data.previews.filter(p=>p.policy==='equal-unit-cent-tariff-v1');data.batches=data.batches.filter(b=>b.publication_model==='monthly-owner-occupant-v1');
  const after=fn=>async(...args)=>{await fn(...args);await refreshMonthlyManagement();};renderChargeBatches(batches,data,{load:loadChargeBatchInputs,save:after(saveChargeBatch),review:after(reviewChargeBatch),publish:after(publishChargeBatch)},{monthly:true});
 }catch(e){financeState(batches,e.code==='42501'?'no-access':'error',e.code==='42501'?'Нямаш текущ достъп за публикуване.':'Месечните начисления не са заредени поради техническа грешка. Обнови.');}
 root.dataset.ready='true';
}
