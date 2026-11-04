import {loadAccount} from './auth.js';
import {loadAdministration} from './administration.js';
import {getClient,unwrap} from './supabase.js';
import {workspaceModel} from '../domain/workspace.js';
export async function loadWorkspace(){
  const account=await loadAccount({ensureProfile:false});
  if(!account)return {model:workspaceModel(null),errors:[]};
  const names=['admin','owned','tickets','drafts','preview','charges','payments'];
  const results=await Promise.allSettled([loadAdministration(account),...['my_owned_units','ticket_feed','financial_draft_feed','financial_preview_feed','charge_batch_feed','manual_payment_feed'].map(name=>getClient().rpc(name).then(unwrap))]);
  const feeds={},errors=[];
  results.forEach((r,i)=>{if(r.status==='fulfilled')feeds[names[i]]=r.value;else errors.push(names[i]);});
  return {model:workspaceModel(account,feeds.admin,feeds),errors};
}
