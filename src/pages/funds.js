import {fundFeed,saveFund,deactivateFund,classifyFundMovement} from '../services/funds.js';
import {renderFunds} from '../ui/funds.js';
import {financeState} from '../ui/finance-help.js';
import {fundsBg as bg} from '../i18n/funds-bg.js';
let generation=0;
export async function refreshFunds(){
 const root=document.getElementById('funds');if(!root)return;const current=++generation;
 root.replaceChildren();root.dataset.ready='false';root.dataset.state='loading';root.textContent=bg.loading;
 try{const data=await fundFeed();if(current!==generation)return;const refresh=fn=>async(...args)=>{await fn(...args);await refreshFunds();};renderFunds(root,data,{save:refresh(saveFund),deactivate:refresh(deactivateFund),classify:refresh(classifyFundMovement)});}
 catch(e){if(current!==generation)return;root.replaceChildren();financeState(root,e.code==='42501'?'no-access':'error',e.code==='42501'?bg.noAccess:bg.error);}root.dataset.ready='true';
}
window.addEventListener('fund-data-changed',refreshFunds);
window.addEventListener('focus',()=>{if(document.getElementById('funds')?.dataset.ready==='true')refreshFunds();});
