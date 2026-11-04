import{getClient,unwrap}from'./supabase.js';import{cashAccountPayload,cashAccountNote}from'../domain/cash-accounts.js';
const rpc=async(name,args)=>unwrap(await getClient().rpc(name,args).retry(false));
export const cashAccountFeed=()=>rpc('cash_account_feed');
export const saveCashAccount=(scope,target,revision,key,payload,note)=>rpc('save_cash_account',{scope,target,expected_revision:revision,request_key:key,payload:cashAccountPayload(payload,target===null),note:cashAccountNote(note)});
export const deactivateCashAccount=(scope,target,revision,key,note)=>rpc('deactivate_cash_account',{scope,target,expected_revision:revision,request_key:key,note:cashAccountNote(note)});
