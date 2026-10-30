import {readOwnership,applyOwnership,reviewOwnership} from '../services/ownership.js';
import {listPersons} from '../services/persons.js';
import {ownershipEditor,ownershipDraft,ownershipRecord} from '../ui/ownership.js';
import {readProvenance} from '../ui/provenance.js';
import {bindForm,message,option} from '../ui/forms.js';
import {authError} from '../i18n/auth-bg.js';
import {ownershipBg} from '../i18n/ownership-bg.js';
import {decimalLabel,ownershipState} from '../domain/ownership.js';
let generation=0,selectedUnit;
export async function showOwnership(scope,units,asOf,canManage) {
 const version=++generation;const root=document.querySelector('#ownership');root.hidden=false;
 const select=document.querySelector('#ownership-unit');select.replaceChildren();
 for(const unit of units)option(select,unit.id,`${unit.unit_number} · ${unit.id.slice(0,8)}`);
 if(units.some(u=>u.id===selectedUnit))select.value=selectedUnit;
 document.querySelector('#ownership-body').hidden=!units.length;
 document.querySelector('#ownership-status').textContent=units.length?`Преглед на собственост към ${asOf}, със сегашните ти права. Корекциите се записват проследимо с нов източник.`:'Няма достъпни имоти за избраната дата.';
 document.querySelector('#ownership-disclaimer').textContent=ownershipBg.disclaimer;
 if(!units.length)return;
 const load=async()=>{
  const unit=select.value;selectedUnit=unit;const loadId=++generation;
  select.disabled=true;root.dataset.ready='false';
  const body=document.querySelector('#ownership-body');body.hidden=true;
  const [data,persons]=await Promise.all([readOwnership(scope,unit,asOf),listPersons(scope)]);
  if(loadId!==generation||!root.isConnected)return;
  body.hidden=false;
  const summary=document.querySelector('#ownership-summary');summary.textContent=`Установен сбор: ${decimalLabel(data.total_fraction)} от 1. ${ownershipBg[ownershipState(data)]}${data.set_reviewed?` ${data.review_note}`:''}`;
  const rows=document.querySelector('#ownership-rows'),history=document.querySelector('#ownership-history');rows.replaceChildren();history.replaceChildren();
  const editor=document.querySelector('#ownership-editor');editor.replaceChildren();editor.hidden=!canManage;
  const refresh=()=>load();let index=0;let requestKey=crypto.randomUUID();
  const draft=(target=null,voided=false)=>{
   const drafts=editor.querySelector('#ownership-drafts');
   if(target&&[...drafts.children].some(x=>x.dataset.target===target.id)){message('Този ред вече е подготвен за промяна.',true);return;}
   if(drafts.children.length>=20){message('Допустими са до 20 промени наведнъж.',true);return;}
   drafts.append(ownershipDraft(persons,target,voided,++index));
  };
  if(canManage){
   editor.innerHTML=ownershipEditor();editor.querySelector('#ownership-add').addEventListener('click',()=>draft());
   bindForm('#ownership-save',async formData=>{
    const changes=[...editor.querySelector('#ownership-drafts').children].map(box=>{
     if(box.dataset.void==='true')return {target:box.dataset.target,void:true};
     const values=Object.fromEntries([...box.querySelectorAll('[name]')].map(input=>[input.name,input.value.trim()]));
     return {...values,target:box.dataset.target||null,valid_to:values.valid_to||null};
    });
    if(!changes.length){message('Подготви поне един нов ред, корекция или оттегляне.',true);return;}
    await applyOwnership(scope,unit,requestKey,changes,{...readProvenance(formData),reason:String(formData.get('reason')).trim(),history_note:String(formData.get('history_note')).trim()});
    requestKey=crypto.randomUUID();if(loadId===generation){await refresh();message('Всички промени са записани заедно. Новите редове очакват проверка; оригиналите са запазени.');}
   });
  }
  for(const record of data.records){
   const row=ownershipRecord(record,canManage,draft,async(p,note)=>{try{await reviewOwnership(scope,unit,p.id,asOf,note);if(loadId===generation){await refresh();message('Проверката на реда е записана. Пълнотата на набора се преглежда отделно.');}}catch(error){message(authError(error),true);}});
   (record.record_state==='current'?rows:history).append(row);
  }
  if(!rows.children.length)rows.textContent='Няма записани текущи версии на собственически периоди.';
  if(!history.children.length)history.textContent='Няма заменени или оттеглени записи.';
  const review=document.querySelector('#ownership-set-review');review.hidden=!canManage||ownershipState(data)!=='needs_set_review';
  const old=review.querySelector('form');if(old)old.reset();
  const submit=async event=>{
   event.preventDefault();const form=event.currentTarget;const button=form.querySelector('button');button.disabled=true;
   try{await reviewOwnership(scope,unit,null,asOf,form.elements.namedItem('note').value.trim());if(loadId===generation){await refresh();message('Проверката на точния набор за датата е записана.');}}
   catch(error){message(authError(error),true);}finally{button.disabled=false;}
  };
  // Replace the handler on reload; never accumulate review submissions.
  review.querySelector('form').onsubmit=submit;
  root.dataset.loadedScope=scope;root.dataset.loadedUnit=unit;root.dataset.ready='true';select.disabled=false;
 };
 select.onchange=()=>load().catch(error=>message(authError(error),true));
 if(version===generation)await load();
}
