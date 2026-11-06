import {registryDate,registryToday} from './registry.js';
import {paymentNote} from './manual-payments.js';
export function paymentAccountSelection(account){
 if(!account||typeof account.id!=='string'||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(account.id)||!Number.isSafeInteger(account.revision)||account.revision<1)throw Error('Избери изрично актуална парична сметка.');
 return {account_id:account.id.toLowerCase(),account_revision:account.revision};
}
export function paymentCompensationDate(value){const d=registryDate(value);if(d>registryToday())throw Error('Датата на компенсацията не може да е бъдеща.');return d;}
export const paymentAccountChangeReason=value=>value==null||value===''?null:paymentNote(value);
