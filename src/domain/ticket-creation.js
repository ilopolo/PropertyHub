import {ticketCategoryCodes} from './ticket-handling.js';
export function ownerTicketCategory(value){if(typeof value!=='string'||!ticketCategoryCodes.includes(value))throw Error('Избери категория за сигнала.');return value;}
export function ticketContextData(data){
 if(!Array.isArray(data)||data.some(x=>!x||typeof x.scope_label!=='string'||typeof x.scope_id!=='string'||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(x.scope_id)||Object.keys(x).some(k=>!['scope_id','scope_label'].includes(k)))||new Set(data.map(x=>x.scope_id)).size!==data.length)throw Error('Контекстите за сигнали не са заредени изцяло.');
 return data;
}
