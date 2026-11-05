// Separate disposable synthetic local state; no env, hosted accounts or persistent demo.
import{randomUUID}from'node:crypto';import{fundFixture}from'./fund-fixture.mjs';
export async function expenseFixture(){const f=await fundFixture();try{
 for(const who of['A','B','owner']){const rows=(await f.db.query('select r.id from public.user_roles r join public.organization_memberships m on m.id=r.membership_id where r.scope_id=$1 and m.profile_id=$2 and r.valid_to is null',[f.scope.A,f.profile[who]])).rows;for(const r of rows)await f.as('orgA','select public.revoke_staff_role($1)',[r.id]);}
 f.expenseRole=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['record_expenses','correct_finance']) id",[f.org.A,f.auth.A,f.scope.A])).rows[0].id;
 f.expenseWriter=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'cashier',array['record_expenses']) id",[f.org.A,f.auth.B,f.scope.A])).rows[0].id;
 f.expenseReader=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'controller',array['read_expenses']) id",[f.org.A,f.auth.owner,f.scope.A])).rows[0].id;
 await f.as('orgA','select public.revoke_staff_role($1)',[f.configRole]);
 f.configRole=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'cashier',array['manage_funds','manage_cash_accounts']) id",[f.org.A,f.auth.doc,f.scope.A])).rows[0].id;
 f.general=await f.saveFund(f.fundPayload('expense_general'),null,0,randomUUID(),'doc');
 f.repair=await f.saveFund({...f.fundPayload('expense_repair'),kind:'repair_renewal',account_id:f.bank,account_revision:1},null,0,randomUUID(),'doc');
 f.document=(amount='100.00')=>({supplier_label:'Синтетичен доставчик',document_number:'QA-'+randomUUID(),document_date:f.today,amount,currency:'EUR',category_label:'Синтетичен ремонт',description:'Синтетичен разход, без реални пари',source_reference:'Synthetic invoice reference, not an uploaded file',basis_reference:'Synthetic authorized expense/purpose; not legal certification'});
 f.settlement=(amount='40.00')=>({amount,paid_on:f.today,method:'bank_transfer',payment_reference:'QA-PAY-'+randomUUID()});
 f.expenseFeed=async(who='A')=>(await f.as(who,'select public.expense_feed() data')).rows[0].data;
 f.expenseState=async id=>(await f.db.query('select private.expense_state($1) s',[id])).rows[0].s;
 f.saveExpense=async(p=f.document(),id=null,rev=0,srev=0,key=randomUUID(),who='A')=>(await f.as(who,"select public.save_expense($1,$2,$3,$4,$5,$6,'Synthetic expense document review') id",[f.scope.A,id,rev,srev,key,p])).rows[0].id;
 f.lines=amount=>[{fund_id:f.general,fund_revision:1,amount}];
 f.payExpense=async(id,p=f.settlement(),srev=0,lines=f.lines(p.amount),key=randomUUID(),who='A',account=f.bank,arev=1,rev=1)=>(await f.as(who,"select public.pay_expense($1,$2,$3,$4,$5,$6,$7,$8,$9,'Synthetic explicit outgoing report') id",[f.scope.A,id,rev,srev,account,arev,lines,key,p])).rows[0].id;
 f.reverseExpense=async(id,srev=1,key=randomUUID(),who='A')=>(await f.as(who,"select public.reverse_expense_payment($1,$2,1,$3,$4,$5,'Synthetic full expense compensation') id",[f.scope.A,id,srev,f.today,key])).rows[0].id;
 f.replaceExpense=async(id,p=f.settlement(),srev=1,lines=f.lines(p.amount),account=f.bank,arev=1,reason=null,key=randomUUID())=>(await f.as('A',"select public.replace_expense_payment($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,'Synthetic atomic expense replacement') id",[f.scope.A,id,srev,f.today,account,arev,reason,lines,key,p])).rows[0].id;
 return f;
}catch(e){await f.db.close();throw e;}}
