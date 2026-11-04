import {getClient,unwrap} from './supabase.js';
import {manualPayment,paymentAllocation,paymentNote} from '../domain/manual-payments.js';
const rpc=async(name,p)=>unwrap(await getClient().rpc(name,p).retry(false));
export const manualPaymentFeed=()=>rpc('manual_payment_feed');
export const recordManualPayment=(scope,payload,key,note)=>rpc('record_manual_payment',{scope,payload:manualPayment(payload),request_key:key,note:paymentNote(note)});
export const allocateManualPayment=(scope,payment,revision,payload,key,note)=>rpc('allocate_manual_payment',{scope,payment_id:payment,expected_revision:revision,...paymentAllocation(payload),request_key:key,note:paymentNote(note)});
export const reverseManualPayment=(scope,target,revision,key,note)=>rpc('reverse_manual_payment',{scope,target,expected_revision:revision,request_key:key,note:paymentNote(note)});
export const replaceManualPayment=(scope,target,revision,payload,key,note)=>rpc('replace_manual_payment',{scope,target,expected_revision:revision,payload:manualPayment(payload),request_key:key,note:paymentNote(note)});
