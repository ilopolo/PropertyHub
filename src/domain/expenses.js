import {paymentAmount,paymentNote} from './manual-payments.js';
import {registryDate,registryToday} from './registry.js';
import {exactFundSplit} from './funds.js';
import {moneyClaim} from './financial-evidence.js';
export const expenseLimits={supplier_label:160,document_number:120,category_label:160,description:1000,source_reference:500,basis_reference:1000,payment_reference:120};
const strict=(p,keys)=>{if(!p||Array.isArray(p)||typeof p!=='object'||Object.keys(p).some(k=>!keys.includes(k)))throw Error('Непозволени разходни полета.');};
const text=(p,k,optional=false)=>{const v=p[k];if(optional&&(v==null||v===''))return null;if(typeof v!=='string'||!v.trim()||[...v.trim()].length>expenseLimits[k]||/[\u0000-\u001f\u007f]/.test(v))throw Error('Попълни валиден текст за '+k+' до '+expenseLimits[k]+' знака.');return v.trim();};
const day=v=>{const d=registryDate(v);if(d>registryToday())throw Error('Ръчно отчетената дата не може да е бъдеща.');return d;};
export function expenseDocument(p){strict(p,['supplier_label','document_number','document_date','amount','currency','category_label','description','source_reference','basis_reference']);if(p.currency!=='EUR')throw Error('Валутата е EUR.');return{supplier_label:text(p,'supplier_label'),document_number:text(p,'document_number',true),document_date:day(p.document_date),amount:paymentAmount(p.amount),currency:'EUR',category_label:text(p,'category_label'),description:text(p,'description'),source_reference:text(p,'source_reference'),basis_reference:text(p,'basis_reference')};}
export function expenseSettlement(p){strict(p,['amount','paid_on','method','payment_reference']);if(!['cash','bank_transfer'].includes(p.method))throw Error('Избери начин на отчетеното плащане.');return{amount:paymentAmount(p.amount),paid_on:day(p.paid_on),method:p.method,payment_reference:text(p,'payment_reference')};}
export const expenseFundSplit=(amount,lines)=>exactFundSplit(paymentAmount(amount),lines);
export const expenseNote=paymentNote;
export function expenseFeedData(data){if(!data||['scopes','expenses','history','payments','accounts','funds'].some(k=>!Array.isArray(data[k])))throw Error('Разходните данни не са заредени изцяло.');for(const e of data.expenses){const total=paymentAmount(e.amount);if(!e.state||!moneyClaim(e.state.paid)||!moneyClaim(e.state.remaining)||BigInt(e.state.paid.replace('.',''))+BigInt(e.state.remaining.replace('.',''))!==BigInt(total.replace('.','')))throw Error('Липсва точен разходен остатък.');}return data;}
