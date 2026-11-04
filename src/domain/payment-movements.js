import {moneyClaim} from './financial-evidence.js';
import {paymentAmount,paymentNote} from './manual-payments.js';
import {registryDate} from './registry.js';

export const paymentMovementPolicy='manual-payment-movement-v1';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const object=(value,code)=>{if(!value||typeof value!=='object'||Array.isArray(value))fail(code,'Липсват изричните входни данни.');return value;};
const id=(value,code)=>{if(typeof value!=='string'||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value))fail(code,'Нужен е конкретен UUID.');return value.toLowerCase();};
const date=(value,code)=>{try{if(typeof value!=='string')throw Error();return registryDate(value);}catch{fail(code,'Нужна е валидна календарна дата.');}};
const amount=(value,code,positive=true)=>{try{const out=positive?paymentAmount(value):moneyClaim(value);if(out==null)throw Error();return out;}catch{fail(code,'Нужна е точна сума в евроценти, без закръгляне.');}};
const cents=value=>BigInt(value.replace('.',''));
function args(value,allowed){object(value,'missing_input');if(Object.keys(value).some(k=>!allowed.includes(k)))fail('unsupported_input_field','Сметка, фонд, категория и разрешения не се подменят чрез допълнителни полета.');}
function source(payment,kind){
 object(payment,'missing_payment');const payment_id=id(payment.id,'invalid_payment_id'),scope_id=id(payment.scope_id,'invalid_scope');
 if(payment.origin!=='manual_report_v1')fail('unsupported_payment_origin','Начални салда и legacy credits изискват отделен контролиран преход.');
 if(payment.kind!==kind)fail('unsupported_payment_kind','Неподдържан вид платежен източник.');
 if(payment.currency!=='EUR')fail('invalid_currency','В този договор валутата е изрично EUR.');
 if(!['cash','bank_transfer'].includes(payment.method))fail('invalid_payment_method','Нужен е изричен отчетен начин на плащане.');
 const payment_date=date(payment.payment_date,'invalid_payment_date');
 return {payment_id,scope_id,currency:'EUR',payment_date,payment_method:payment.method,source_origin:payment.origin};
}
function configured(account,p){
 object(account,'missing_account');const cash_account_id=id(account.id,'invalid_account_id');
 if(id(account.scope_id,'invalid_account_scope')!==p.scope_id)fail('account_scope_mismatch','Сметката и плащането са от различни обхвати.');
 if(account.currency!=='EUR'||account.currency!==p.currency)fail('account_currency_mismatch','Валутата на сметката не съответства на плащането.');
 if(account.archived_at!==null)fail('account_not_active','Нужна е изрично активна конфигурация; няма автоматичен избор или възстановяване на сметка.');
 if(!['cash','bank'].includes(account.account_type))fail('invalid_account_type','Неподдържан вид парична сметка.');
 if((p.payment_method==='cash'?'cash':'bank')!==account.account_type)fail('account_method_mismatch','Избраната сметка е несъвместима с отчетения начин.');
 return cash_account_id;
}
const sourceKey=id=>'payment:'+id;
function receipt(payment,account){
 const p=source(payment,'receipt');
 if(payment.reversal_of_id!==null)fail('receipt_reversal_link_invalid','Първичният източник не може да е отменящ запис.');
 const replaces_payment_id=payment.replaces_id===null?null:id(payment.replaces_id,'invalid_replacement_source');
 if(replaces_payment_id===p.payment_id)fail('invalid_replacement_source','Корекцията не може да заменя самата себе си.');
 const value=amount(payment.amount,'invalid_payment_amount');
 return {policy:paymentMovementPolicy,source_key:sourceKey(p.payment_id),payment_id:p.payment_id,scope_id:p.scope_id,
  cash_account_id:configured(account,p),currency:p.currency,kind:'payment_receipt',direction:'in',amount:value,amount_cents:String(cents(value)),
  movement_date:p.payment_date,payment_method:p.payment_method,source_origin:p.source_origin,replaces_payment_id,reversal_of_id:null,reversal_of_key:null};
}

// Pure preparation of trusted source projections. No DB, bank, clock, rights or duplicate lookup.
export function preparePaymentReceipt(input){
 args(input,['payment','account','allocation_state','as_of_date']);
 const result=receipt(input.payment,input.account),asOf=date(input.as_of_date,'invalid_as_of_date');
 if(result.movement_date>asOf)fail('future_payment_date','Получаването е след изрично подадената проверочна дата.');
 const state=object(input.allocation_state,'missing_allocation_state');
 if(Object.keys(state).some(k=>!['allocated_amount','unallocated_amount'].includes(k)))fail('invalid_allocation_state','Нужни са точните отнесена и неразнесена сума.');
 const allocated=amount(state.allocated_amount,'invalid_allocated_amount',false),unallocated=amount(state.unallocated_amount,'invalid_unallocated_amount',false);
 if(cents(allocated)+cents(unallocated)!==cents(result.amount))fail('allocation_balance_mismatch','Отнесено + неразнесено трябва да е точно цялата платежна сума.');
 // Allocation state and as_of are validation inputs, never a second receipt or part of movement identity/content.
 return result;
}

export function preparePaymentCompensation(input){
 args(input,['reversal_payment','original_movement','account','compensation_date','as_of_date','reason']);
 const original=object(input.original_movement,'missing_original_movement'),original_id=id(original.id,'missing_original_movement_id');
 const canonical=receipt({id:original.payment_id,scope_id:original.scope_id,currency:original.currency,amount:original.amount,
  payment_date:original.movement_date,method:original.payment_method,origin:original.source_origin,kind:'receipt',reversal_of_id:null,replaces_id:original.replaces_payment_id},input.account);
 if(Object.entries(canonical).some(([k,v])=>original[k]!==v))fail('original_movement_mismatch','Нужен е точният първичен запис с неизменени данни.');
 const r=source(input.reversal_payment,'reversal'),p=input.reversal_payment;
 if(id(p.reversal_of_id,'invalid_reversal_source')!==canonical.payment_id||r.payment_id===canonical.payment_id||p.replaces_id!==null)fail('invalid_reversal_source','Отменящият платежен запис не сочи точния оригинал.');
 if(r.scope_id!==canonical.scope_id||r.payment_method!==canonical.payment_method||r.payment_date!==canonical.movement_date)fail('reversal_source_mismatch','Scope, начинът или изходната дата на отменящия запис не съответстват.');
 if(typeof p.amount!=='string'||!p.amount.startsWith('-')||amount(p.amount.slice(1),'invalid_reversal_amount')!==canonical.amount)fail('reversal_amount_mismatch','Компенсацията е за точната цяла сума на оригинала.');
 const accountId=configured(input.account,r);if(accountId!==canonical.cash_account_id)fail('compensation_account_mismatch','Компенсацията не е трансфер към друга сметка.');
 const movement_date=date(input.compensation_date,'invalid_compensation_date'),asOf=date(input.as_of_date,'invalid_as_of_date');
 if(movement_date<canonical.movement_date||movement_date>asOf)fail('compensation_date_outside_interval','Нужна е изрична дата между първичния запис и проверочната дата.');
 let reason;try{reason=paymentNote(input.reason);}catch{fail('compensation_reason_required','Нужна е проследима причина за компенсацията.');}
 return {policy:paymentMovementPolicy,source_key:sourceKey(r.payment_id),payment_id:r.payment_id,scope_id:r.scope_id,
  cash_account_id:canonical.cash_account_id,currency:r.currency,kind:'payment_reversal',direction:'out',amount:canonical.amount,amount_cents:canonical.amount_cents,
  movement_date,payment_method:r.payment_method,source_origin:r.source_origin,replaces_payment_id:null,reversal_of_id:original_id,reversal_of_key:canonical.source_key,reason};
}
