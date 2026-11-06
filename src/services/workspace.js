import {loadAccount} from './auth.js';
import {loadAdministration} from './administration.js';
import {getClient,unwrap} from './supabase.js';
import {workspaceModel} from '../domain/workspace.js';
import {ticketContexts} from './tickets.js';
export async function loadWorkspace(){
  const account=await loadAccount({ensureProfile:false});
  if(!account)return {model:workspaceModel(null),errors:[]};
  const names=['admin','owned','ownerFinance','ticketContexts'];
  const results=await Promise.allSettled([loadAdministration(account),getClient().rpc('my_owned_units').retry(false).then(unwrap),getClient().rpc('my_financial_access').retry(false).then(unwrap),ticketContexts()]);
  const feeds={},errors=[];
  results.forEach((r,i)=>{if(r.status==='fulfilled')feeds[names[i]]=r.value;else errors.push(names[i]);});
  // Role rows only select which guarded discovery request is useful. A capability
  // still comes exclusively from that request's current server-authorized scopes.
  // Do not load every charge/payment/history payload just to repeat a nav link.
  const covered=new Set(),now=Date.now();
  const current=account.roles.filter(r=>Date.parse(r.valid_from)<=now&&(!r.valid_to||now<Date.parse(r.valid_to)));
  const candidates=[
    ['drafts','financial_draft_feed',['read_rules','prepare_rules','publish_rules']],
    ['preview','financial_preview_feed',['prepare_charges']],
    ['charges','charge_batch_feed',['publish_charges','correct_finance']],
    ['payments','manual_payment_feed',['read_payments','record_payments']],
    ['accounts','cash_account_feed',['manage_cash_accounts']],
    ['funds','fund_feed',['read_funds','manage_funds','record_payments']],
    ['expenses','expense_feed',['read_expenses','record_expenses']]
  ];
  for(const [key,rpc,permissions] of candidates){
    const relevant=current.filter(r=>r.permissions.some(p=>permissions.includes(p)));
    if(!relevant.some(r=>key==='expenses'||!covered.has(r.scope_id)))continue;
    try{feeds[key]=unwrap(await getClient().rpc(rpc).retry(false));for(const s of feeds[key]?.scopes||[])covered.add(s.id);}
    catch{errors.push(key);}
  }
  return {model:workspaceModel(account,feeds.admin,feeds),errors};
}
