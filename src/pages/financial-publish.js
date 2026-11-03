import {chargeBatchFeed,loadChargeBatchInputs,saveChargeBatch,reviewChargeBatch,publishChargeBatch} from '../services/financial-publish.js';
import {renderChargeBatches} from '../ui/financial-publish.js';
export async function refreshChargeBatches(){
 const root=document.querySelector('#financial-publish');root.dataset.ready='false';
 try{const data=await chargeBatchFeed();renderChargeBatches(root,data,{load:loadChargeBatchInputs,
  save:async(...args)=>{await saveChargeBatch(...args);await refreshChargeBatches();},
  review:async(...args)=>{await reviewChargeBatch(...args);await refreshChargeBatches();},
  publish:async(...args)=>{await publishChargeBatch(...args);await refreshChargeBatches();}});
 }catch{root.textContent='Публикуването не е достъпно. Нужни са изрични финансови права и приложен сървърен договор.';}
 root.dataset.ready='true';
}
