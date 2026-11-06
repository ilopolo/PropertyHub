import {userError} from '../i18n/public-errors.js';
import {humanText} from './public-text.js';
import {financeState,financeDetails} from './finance-help.js';
import {bindWorkspaceScope} from './workspace-context.js';
const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=humanText(text);n.className=cls;return n;};
function field(form,name,label,value='',options){
 const box=el('label',label,'form-label d-block mb-3'),n=el(options?'select':'input','','form-control');n.name=name;
 if(options)for(const[v,label]of options){const o=el('option',label);o.value=v;n.append(o);}
 n.value=value;n.required=true;box.append(n);form.append(box);return n;
}
export function renderCashAccounts(root,data,actions){
 root.replaceChildren();root.dataset.state='ready';root.append(el('h2','Парични сметки — каса и банка'),el('p','Конфигурация на сметките, без касова или банкова наличност. Сметката е отделна от фонд и категория.','alert alert-info'));
 if(!data.scopes.length){financeState(root,'no-access','Нямаш право за преглед на парични сметки. Поискай изрично назначение за необходимия обхват от организационния администратор.');return;}
 const scope=field(root,'account_scope','Обхват за парични сметки',root.dataset.scope||data.scopes[0].id,data.scopes.map(s=>[s.id,s.label])),body=el('div');root.append(body);
 function submit(form,label,fn){
  const error=el('p','','text-danger');error.setAttribute('role','alert');const button=el('button',label,'btn btn-primary');form.append(error,button);
  form.onsubmit=async e=>{e.preventDefault();if(!form.reportValidity())return;button.disabled=true;error.textContent='';try{await fn();}catch(e){error.textContent=e.code==='PT409'?'Сметката е променена или деактивирана. Натисни „Обнови“ и прегледай текущата версия.':e.code==='42501'?'Нямаш текущо право за тази операция.':e.code==='23514'?'Провери вида, EUR, името, предназначението, реквизитите и причината.':userError(e,"Операцията не е потвърдена. Обнови преди повторение.");}finally{button.disabled=false;}};
 }
 function render(){
  body.replaceChildren();const s=data.scopes.find(s=>s.id===scope.value);if(!s){financeState(body,'no-context','Нямаш достъп до парични сметки в избрания контекст. Избери разрешен обхват.');return;}root.dataset.scope=s.id;
  const accounts=data.accounts.filter(a=>a.scope_id===s.id);
  if(!accounts.length)financeState(body,'empty',s.can_manage?'Още няма сметки. Създай каса или банкова сметка с изрично предназначение.':'Още няма парични сметки в този обхват. Конфигурацията се подготвя от оправомощен представител.');
  for(const a of accounts){
   const card=el('article','','card card-body mb-3');card.dataset.cashAccount=a.id;
   card.append(el('h3',`${a.label} · ${a.account_type==='cash'?'Каса':'Банкова сметка'}`,'h5'),el('p',`${a.archived_at?'Деактивирана':'Активна'} · EUR · версия ${a.revision}`),el('p',a.purpose));
   if(a.account_type==='bank')card.append(el('p',`Титуляр: ${a.holder_label}`),el('p',`Банков реквизит: ${a.account_reference}`,'text-break'));
   if(s.can_manage&&!a.archived_at){
    const edit=el('form','','border-top pt-3');edit.dataset.cashEdit=a.id;edit.append(el('h4','Промени име или предназначение','h6'));
    const label=field(edit,'label','Име',a.label),purpose=field(edit,'purpose','Предназначение',a.purpose),note=field(edit,'note','Причина за промяната'),key=crypto.randomUUID();label.maxLength=160;purpose.maxLength=500;note.maxLength=1000;
    submit(edit,'Запази промяната',()=>actions.save(s.id,a.id,Number(a.revision),key,{label:label.value,purpose:purpose.value},note.value));card.append(edit);
    const deactivate=el('form','','border-top pt-3 mt-3');deactivate.dataset.cashDeactivate=a.id;deactivate.append(el('p','Деактивирането спира бъдещото използване. Историята остава достъпна; повторно активиране не се предлага.','small'));
    const reason=field(deactivate,'note','Причина за деактивиране'),deactivateKey=crypto.randomUUID();reason.maxLength=1000;submit(deactivate,'Деактивирай сметката',()=>actions.deactivate(s.id,a.id,Number(a.revision),deactivateKey,reason.value));card.append(deactivate);
   }
   const history=financeDetails('История на сметката');for(const h of data.history.filter(h=>h.account_id===a.id)){
    const v=h.snapshot;history.append(el('p',`Версия ${h.revision} · ${new Date(h.recorded_at).toLocaleString('bg-BG',{timeZone:'Europe/Sofia'})} · ${h.reason}`,'small'),el('p',`${v.label} · ${v.purpose} · ${v.archived_at?'Деактивирана':'Активна'}`,'small'),financeDetails('Идентификатор на извършилия промяната',el('p',h.recorded_by,'small text-break')));
   }card.append(history);body.append(card);
  }
  if(s.can_manage){
   const form=el('form','','card card-body mb-3');form.dataset.cashCreate='true';form.append(el('h3','Нова парична сметка','h4'));
   const type=field(form,'account_type','Вид','',[['','Избери изрично'],['cash','Каса'],['bank','Банкова сметка']]);field(form,'currency','Валута','EUR',[['EUR','EUR']]);
   const label=field(form,'label','Име'),purpose=field(form,'purpose','Предназначение');label.maxLength=160;purpose.maxLength=500;
   const bank=el('div');form.append(bank);const holder=field(bank,'holder_label','Титуляр според документа'),reference=field(bank,'account_reference','Банков реквизит според документа (IBAN / номер)');holder.maxLength=reference.maxLength=160;
   bank.append(el('p','Въведи само служебните реквизити, без пароли, ключове или адреси за вход. Попълването не удостоверява собственост или банково потвърждение.','small'));
   const toggle=()=>{bank.hidden=type.value!=='bank';holder.disabled=reference.disabled=bank.hidden;};type.addEventListener('change',toggle);toggle();
   const note=field(form,'note','Основание за конфигурацията'),key=crypto.randomUUID();note.maxLength=1000;
   submit(form,'Създай сметката',()=>actions.save(s.id,null,0,key,{account_type:type.value,currency:'EUR',label:label.value,purpose:purpose.value,holder_label:type.value==='bank'?holder.value:null,account_reference:type.value==='bank'?reference.value:null},note.value));body.append(form);
  }
  body.append(financeDetails('Ограничения и промяна на банковите реквизити',el('p','Видът, обхватът, валутата и банковите реквизити са постоянна идентичност. За различен реквизит създай нова сметка и деактивирай старата. Името и предназначението имат отделна история. Няма изтриване или автоматичен избор по начин на плащане.','small'),el('p','Проверяваме наличието и формата на текста, без проверка на IBAN, банката или правото върху сметката. Свързването с платежно постъпление е следваща стъпка; тази конфигурация не създава движение на средства.','small')));
 }
 bindWorkspaceScope(scope,render);
}
