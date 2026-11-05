import {loadAccount} from './auth.js';
import {loadAdministration} from './administration.js';
import {getClient,unwrap} from './supabase.js';
import {workspaceModel} from '../domain/workspace.js';
import {ticketContexts} from './tickets.js';
export async function loadWorkspace(){
  const account=await loadAccount({ensureProfile:false});
  if(!account)return {model:workspaceModel(null),errors:[]};
  const names=['admin','owned','tickets','drafts','preview','charges','payments','accounts','ownerFinance','ticketContexts','funds','expenses'];
  const results=await Promise.allSettled([loadAdministration(account),...['my_owned_units','ticket_feed','financial_draft_feed','financial_preview_feed','charge_batch_feed','manual_payment_feed','cash_account_feed','my_financial_access'].map(name=>getClient().rpc(name).then(unwrap)),ticketContexts(),getClient().rpc('fund_feed').retry(false).then(unwrap),getClient().rpc('expense_feed').retry(false).then(unwrap)]);
  const feeds={},errors=[];
  results.forEach((r,i)=>{if(r.status==='fulfilled')feeds[names[i]]=r.value;else errors.push(names[i]);});
  return {model:workspaceModel(account,feeds.admin,feeds),errors};
}
