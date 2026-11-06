import{getClient,unwrap}from'./supabase.js';
import{ownerFinanceFilter,ownerFinanceData}from'../domain/owner-finances.js';
export async function myFinancialHistory(unit=null){const unit_filter=ownerFinanceFilter(unit);return ownerFinanceData(unwrap(await getClient().rpc('my_financial_history',{unit_filter}).retry(false)));}
