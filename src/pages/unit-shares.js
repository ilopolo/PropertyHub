import {unitShareFeed,saveUnitShareSet,verifyUnitShareSet,unitShareVersionAt} from '../services/unit-shares.js';
import {renderUnitShares} from '../ui/unit-shares.js';
let generation=0;
export function canReadUnitShares(account,scope){const now=Date.now();return account.roles.some(r=>r.scope_id===scope&&r.permissions.includes('read_registry')&&Date.parse(r.valid_from)<=now&&(!r.valid_to||now<Date.parse(r.valid_to)));}
export function hideUnitShares(){generation++;document.querySelector('#unit-shares').hidden=true;}
export async function showUnitShares(scope,date){
 const root=document.querySelector('#unit-shares'),current=++generation;root.hidden=false;root.textContent='Зареждане на идеалните части…';delete root.dataset.ready;
 try{const data=await unitShareFeed(scope);if(current!==generation)return;const refresh=()=>current===generation?showUnitShares(scope,date):Promise.resolve();renderUnitShares(root,data,{refresh,save:async(b,p,n,k)=>{await saveUnitShareSet(scope,b,p,n,k);await refresh();},verify:async(v,p)=>{await verifyUnitShareSet(scope,v,{...p,as_of:date});await refresh();},read:id=>unitShareVersionAt(scope,id,date)});root.dataset.ready='true';}
 catch{if(current===generation)root.textContent='Идеалните части не са достъпни. Проверете правото за регистъра и наличието на актуалната миграция.';}
}
