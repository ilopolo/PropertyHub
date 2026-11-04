import{randomUUID}from'node:crypto';import{unitFileFixture}from'./unit-file-fixture.mjs';
export async function cashAccountFixture(){const f=await unitFileFixture();try{
 const initial=(await f.as('A',"select id from public.user_roles where scope_id=$1 and role_code='manager' and valid_to is null",[f.scope.A])).rows[0].id;await f.as('orgA','select public.revoke_staff_role($1)',[initial]);
 f.accountRole=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['manage_cash_accounts']) id",[f.org.A,f.auth.A,f.scope.A])).rows[0].id;
 await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'cashier',array['read_payments'])",[f.org.A,f.auth.B,f.scope.A]);
 await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'controller',array['read_rules'])",[f.org.A,f.auth.doc,f.scope.A]);
 f.cash=()=>({account_type:'cash',currency:'EUR',label:'Синтетична каса',purpose:'Синтетичен обхват — без наличност',holder_label:null,account_reference:null});
 f.bank=()=>({account_type:'bank',currency:'EUR',label:'Синтетична банкова сметка',purpose:'Синтетично предназначение — не е фонд',holder_label:'Синтетична общност',account_reference:'SYNTHETIC-BANK-REFERENCE'});
 f.feed=async(who='A')=>(await f.as(who,'select public.cash_account_feed() data')).rows[0].data;
 f.save=async(payload=f.cash(),target=null,revision=0,key=randomUUID(),who='A')=>(await f.as(who,"select public.save_cash_account($1,$2,$3,$4,$5,'Synthetic account configuration source') id",[f.scope.A,target,revision,key,payload])).rows[0].id;
 f.deactivate=async(target,revision,key=randomUUID(),who='A')=>(await f.as(who,"select public.deactivate_cash_account($1,$2,$3,$4,'Synthetic deactivation; preserve history') id",[f.scope.A,target,revision,key])).rows[0].id;
 return f;
}catch(e){await f.db.close();throw e;}}
