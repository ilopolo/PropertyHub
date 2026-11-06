import assert from'node:assert/strict';import{mkdir,writeFile}from'node:fs/promises';
import{preparePaymentReceipt,preparePaymentCompensation,paymentMovementPolicy}from'../src/domain/payment-movements.js';
const ids={payment:'abcdef00-0000-4000-8000-000000000001',scope:'00000000-0000-4000-8000-000000000002',account:'00000000-0000-4000-8000-000000000003',other:'00000000-0000-4000-8000-000000000004',reversal:'00000000-0000-4000-8000-000000000005',movement:'00000000-0000-4000-8000-000000000006'};
const payment={id:ids.payment,scope_id:ids.scope,currency:'EUR',amount:'120.00',payment_date:'2026-11-03',method:'bank_transfer',origin:'manual_report_v1',kind:'receipt',reversal_of_id:null,replaces_id:null};
const account={id:ids.account,scope_id:ids.scope,currency:'EUR',account_type:'bank',archived_at:null};
const fixture=()=>({payment:{...payment},account:{...account},allocation_state:{allocated_amount:'40.00',unallocated_amount:'80.00'},as_of_date:'2026-11-04'});
const compensation=()=>({reversal_payment:{...payment,id:ids.reversal,kind:'reversal',amount:'-120.00',reversal_of_id:ids.payment},original_movement:{id:ids.movement,...preparePaymentReceipt(fixture())},account:{...account},compensation_date:'2026-11-04',as_of_date:'2026-11-04',reason:'Synthetic correction of a recorded receipt; not a bank refund'});
const checks=[],check=(name,fn)=>{fn();checks.push({name,pass:true});console.log('PASS',name);};
const refusal=(fn,code)=>assert.throws(fn,e=>e.code===code),change=(base,part,values)=>({...base,[part]:{...base[part],...values}});
check('one full receipt for partial/full/unallocated payment; allocation changes do not alter movement',()=>{
 const a=preparePaymentReceipt(fixture());assert.equal(a.amount,'120.00');assert.equal(a.amount_cents,'12000');assert.equal(a.direction,'in');assert.equal(a.policy,paymentMovementPolicy);
 for(const [allocated_amount,unallocated_amount]of [['0.00','120.00'],['100.00','20.00'],['120.00','0.00']])assert.deepEqual(preparePaymentReceipt({...fixture(),allocation_state:{allocated_amount,unallocated_amount}}),a);
 assert.equal('fund_id'in a,false);assert.equal('category_id'in a,false);assert.equal('allocated_amount'in a,false);
 assert.deepEqual(preparePaymentReceipt({...fixture(),as_of_date:'2026-11-05'}),a);
});
check('exact cents including large amount; no floats, zero, rounding or missing balance',()=>{
 const f=fixture();f.payment.amount='999999999999.99';f.allocation_state={allocated_amount:'0',unallocated_amount:'999999999999.99'};assert.equal(preparePaymentReceipt(f).amount_cents,'99999999999999');
 for(const amount of ['0','-1.00','1.001','NaN','',null,120])refusal(()=>preparePaymentReceipt(change(fixture(),'payment',{amount})),'invalid_payment_amount');
 for(const allocated_amount of ['-1.00','40.001',null])refusal(()=>preparePaymentReceipt(change(fixture(),'allocation_state',{allocated_amount})),'invalid_allocated_amount');
 refusal(()=>preparePaymentReceipt(change(fixture(),'allocation_state',{unallocated_amount:'79.99'})),'allocation_balance_mismatch');refusal(()=>preparePaymentReceipt({...fixture(),allocation_state:null}),'missing_allocation_state');
});
check('explicit EUR account/scope/type/method and active configuration; no automatic choice',()=>{
 refusal(()=>preparePaymentReceipt({...fixture(),account:null}),'missing_account');
 for(const [part,values,code]of [['payment',{currency:'USD'},'invalid_currency'],['payment',{currency:null},'invalid_currency'],['account',{currency:'USD'},'account_currency_mismatch'],['account',{scope_id:ids.other},'account_scope_mismatch'],['account',{id:'default'},'invalid_account_id'],['account',{archived_at:'2026-11-03'},'account_not_active'],['account',{archived_at:undefined},'account_not_active'],['account',{account_type:'fund'},'invalid_account_type'],['account',{account_type:'cash'},'account_method_mismatch']])refusal(()=>preparePaymentReceipt(change(fixture(),part,values)),code);
 const cash=change(change(fixture(),'payment',{method:'cash'}),'account',{account_type:'cash'});assert.equal(preparePaymentReceipt(cash).cash_account_id,ids.account);
 refusal(()=>preparePaymentReceipt({...fixture(),fund_id:ids.other}),'unsupported_input_field');
});
check('stable canonical source identity on repeat/order/case; changed configuration is not a new source',()=>{
 const f=fixture(),a=preparePaymentReceipt(f);assert.deepEqual(preparePaymentReceipt({as_of_date:f.as_of_date,allocation_state:f.allocation_state,account:f.account,payment:f.payment}),a);
 assert.deepEqual(preparePaymentReceipt(change(f,'payment',{id:ids.payment.toUpperCase()})),a);assert.equal(a.source_key,'payment:'+ids.payment);
 const other=preparePaymentReceipt(change(f,'account',{id:ids.other}));assert.equal(other.source_key,a.source_key);assert.notDeepEqual(other,a); // Future server must reject changed payload under this unique source, not insert twice.
});
check('source/provenance and explicit calendar dates; opening/legacy or reversal cannot become normal receipt',()=>{
 refusal(()=>preparePaymentReceipt(change(fixture(),'payment',{origin:'opening_advance'})),'unsupported_payment_origin');refusal(()=>preparePaymentReceipt(change(fixture(),'payment',{kind:'reversal'})),'unsupported_payment_kind');
 refusal(()=>preparePaymentReceipt(change(fixture(),'payment',{payment_date:'2026-02-30'})),'invalid_payment_date');refusal(()=>preparePaymentReceipt({...fixture(),as_of_date:'2026-11-02'}),'future_payment_date');refusal(()=>preparePaymentReceipt({...fixture(),as_of_date:null}),'invalid_as_of_date');
});
check('whole compensation on same original account/source with stable reversal identity; original retained',()=>{
 const f=compensation(),before=structuredClone(f),a=preparePaymentCompensation(f);assert.deepEqual(f,before);assert.equal(a.direction,'out');assert.equal(a.amount,'120.00');assert.equal(a.amount_cents,'12000');assert.equal(a.reversal_of_id,ids.movement);assert.equal(a.reversal_of_key,'payment:'+ids.payment);assert.equal(a.source_key,'payment:'+ids.reversal);assert.equal(a.cash_account_id,ids.account);assert.deepEqual(preparePaymentCompensation(f),a);
});
check('compensation refuses missing persisted original, tampering, partial amount, foreign source/account and invalid dates',()=>{
 refusal(()=>preparePaymentCompensation({...compensation(),original_movement:null}),'missing_original_movement');refusal(()=>preparePaymentCompensation(change(compensation(),'original_movement',{id:null})),'missing_original_movement_id');
 for(const [part,values,code]of [['original_movement',{amount_cents:'1'},'original_movement_mismatch'],['original_movement',{source_key:'other'},'original_movement_mismatch'],['original_movement',{direction:'out'},'original_movement_mismatch'],['reversal_payment',{amount:'-40.00'},'reversal_amount_mismatch'],['reversal_payment',{amount:'120.00'},'reversal_amount_mismatch'],['reversal_payment',{reversal_of_id:ids.other},'invalid_reversal_source'],['reversal_payment',{scope_id:ids.other},'reversal_source_mismatch'],['account',{id:ids.other},'original_movement_mismatch']])refusal(()=>preparePaymentCompensation(change(compensation(),part,values)),code);
 for(const d of ['2026-11-02','2026-11-05'])refusal(()=>preparePaymentCompensation({...compensation(),compensation_date:d}),'compensation_date_outside_interval');refusal(()=>preparePaymentCompensation({...compensation(),compensation_date:null}),'invalid_compensation_date');refusal(()=>preparePaymentCompensation({...compensation(),reason:''}),'compensation_reason_required');
});
check('frozen inputs unchanged, fresh deterministic outputs; no clock/random/env/network needed',()=>{
 const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};const f=freeze(fixture()),before=JSON.stringify(f),a=preparePaymentReceipt(f);a.amount='1.00';assert.equal(preparePaymentReceipt(f).amount,'120.00');assert.equal(JSON.stringify(f),before);preparePaymentCompensation(freeze(compensation()));
});
await mkdir('.local/payment-movement-qa',{recursive:true});await writeFile('.local/payment-movement-qa/report.json',JSON.stringify({pass:true,domainOnly:true,hosted:false,mvcc:false,credentialsLoaded:false,checks,policy:paymentMovementPolicy,remaining:'Atomic DB/RPC/account lifecycle/cutover/posting uniqueness/access and combined payment PostgreSQL MVCC acceptance remain unimplemented'},null,2));console.log('PASS pure movement domain; no DB/API/UI/hosted evidence');
