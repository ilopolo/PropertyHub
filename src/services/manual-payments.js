import {getClient,unwrap} from './supabase.js';
import {manualPayment,paymentAllocation,paymentNote} from '../domain/manual-payments.js';
import {paymentAccountSelection,paymentCompensationDate,paymentAccountChangeReason} from '../domain/payment-inbound.js';
const rpc=async(name,p)=>unwrap(await getClient().rpc(name,p).retry(false));
export const manualPaymentFeed=()=>rpc('manual_payment_feed');
export const recordManualPayment=(scope,payload,key,note,account)=>rpc('record_manual_payment_inbound',{scope,...paymentAccountSelection(account),payload:manualPayment(payload),request_key:key,note:paymentNote(note)});
export const allocateManualPayment=(scope,payment,revision,payload,key,note)=>rpc('allocate_manual_payment',{scope,payment_id:payment,expected_revision:revision,...paymentAllocation(payload),request_key:key,note:paymentNote(note)});
export const reverseManualPayment=(scope,target,revision,key,note,date)=>rpc('reverse_manual_payment_inbound',{scope,target,expected_revision:revision,compensation_date:paymentCompensationDate(date),request_key:key,note:paymentNote(note)});
export const replaceManualPayment=(scope,target,revision,payload,key,note,account,date,changeReason)=>rpc('replace_manual_payment_inbound',{scope,target,expected_revision:revision,...paymentAccountSelection(account),compensation_date:paymentCompensationDate(date),account_change_reason:paymentAccountChangeReason(changeReason),payload:manualPayment(payload),request_key:key,note:paymentNote(note)});
