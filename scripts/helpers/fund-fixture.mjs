import {randomUUID} from 'node:crypto';
import {manualPaymentFixture} from './manual-payment-fixture.mjs';
export async function fundFixture(){const f=await manualPaymentFixture();try{
 f.fundRole=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'cashier',array['manage_funds','read_funds']) id",[f.org.A,f.auth.A,f.scope.A])).rows[0].id;
 const docRole=(await f.as('doc',"select id from public.user_roles where scope_id=$1 and role_code='cashier' and valid_to is null",[f.scope.A])).rows[0].id;
 await f.as('orgA','select public.revoke_staff_role($1)',[docRole]);
 f.configRole=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'cashier',array['manage_funds']) id",[f.org.A,f.auth.doc,f.scope.A])).rows[0].id;
 const reader=(await f.as('owner',"select id from public.user_roles where scope_id=$1 and role_code='controller' and valid_to is null",[f.scope.A])).rows[0].id;
 await f.as('orgA','select public.revoke_staff_role($1)',[reader]);
 f.fundReader=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'controller',array['read_funds']) id",[f.org.A,f.auth.owner,f.scope.A])).rows[0].id;
 f.fundPayload=(code='current')=>({code,kind:'general',currency:'EUR',label:'Синтетичен фонд '+code,purpose:'Синтетично предназначение, не наличност',basis_reference:'Synthetic resolution / approved purpose',account_id:null,account_revision:null});
 f.fundFeed=async(who='A')=>(await f.as(who,'select public.fund_feed() data')).rows[0].data;
 f.saveFund=async(payload=f.fundPayload(),target=null,revision=0,key=randomUUID(),who='A')=>(await f.as(who,"select public.save_fund($1,$2,$3,$4,$5,'Synthetic fund configuration') id",[f.scope.A,target,revision,key,payload])).rows[0].id;
 f.deactivateFund=async(target,revision,key=randomUUID(),who='A')=>(await f.as(who,"select public.deactivate_fund($1,$2,$3,$4,'Synthetic fund deactivation') id",[f.scope.A,target,revision,key])).rows[0].id;
 f.classify=async(movement,lines,revision=0,key=randomUUID(),who='A',note='Synthetic complete fund purpose')=>(await f.as(who,'select public.classify_fund_movement($1,$2,$3,$4,$5,$6) id',[f.scope.A,movement,revision,key,lines,note])).rows[0].id;
 f.move=async payment=>(await f.db.query('select * from public.money_movements where payment_id=$1',[payment])).rows[0];
 return f;
}catch(e){await f.db.close();throw e;}}
