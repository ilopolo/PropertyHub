import {readOccupancy,applyOccupancy,reviewOccupancy} from '../services/occupancy.js';
import {listPersons} from '../services/persons.js';
import {occupancyEditor,occupancyDraft,occupancyRecord,collectOccupancyDraft} from '../ui/occupancy.js';
import {readProvenance} from '../ui/provenance.js';
import {bindForm,message,option} from '../ui/forms.js';
import {authError} from '../i18n/auth-bg.js';
import {occupancyBg} from '../i18n/occupancy-bg.js';
import {countLabel,occupancyState} from '../domain/occupancy.js';
let generation=0,selectedUnit;
export async function showOccupancy(scope,units,asOf,canManage) {
 const version=++generation;const root=document.querySelector('#occupancy');root.hidden=false;
 const select=document.querySelector('#occupancy-unit');select.replaceChildren();
 for(const unit of units)option(select,unit.id,`${unit.unit_number} · ${unit.id.slice(0,8)}`);
 if(units.some(u=>u.id===selectedUnit))select.value=selectedUnit;
 document.querySelector('#occupancy-body').hidden=!units.length;
 document.querySelector('#occupancy-status').textContent=units.length?`Преглед на обитаване към ${asOf}, със сегашните ти права. Корекциите се записват проследимо с нов източник.`:'Няма достъпни имоти за избраната дата.';
 document.querySelector('#occupancy-disclaimer').textContent=occupancyBg.disclaimer;
 if(!units.length)return;
 const load=async()=>{
  const unit=select.value;selectedUnit=unit;const loadId=++generation;
  select.disabled=true;root.dataset.ready='false';
  const body=document.querySelector('#occupancy-body');body.hidden=true;
  const [data,persons]=await Promise.all([readOccupancy(scope,unit,asOf),listPersons(scope)]);
  if(loadId!==generation||!root.isConnected)return;
  body.hidden=false;
  const summary=document.querySelector('#occupancy-summary');summary.textContent=`${data.count_value===null?'Броят е неизвестен.':`Деклариран брой: ${countLabel(data.count_value)}.`} ${occupancyBg[occupancyState(data)]}${data.set_reviewed?` ${data.review_note}`:''}`;
  const rows=document.querySelector('#occupancy-rows'),history=document.querySelector('#occupancy-history');rows.replaceChildren();history.replaceChildren();
  const editor=document.querySelector('#occupancy-editor');editor.replaceChildren();editor.hidden=!canManage;
  const refresh=()=>load();let index=0;let requestKey=crypto.randomUUID();
  const draft=(target=null,voided=false)=>{
   const drafts=editor.querySelector('#occupancy-drafts');
   if(target&&[...drafts.children].some(x=>x.dataset.target===target.id)){message('Този ред вече е подготвен за промяна.',true);return;}
   if(drafts.children.length>=20){message('Допустими са до 20 промени наведнъж.',true);return;}
   drafts.append(occupancyDraft(persons.filter(p=>p.person_kind==='physical'),target,voided,++index));
  };
  if(canManage){
   editor.innerHTML=occupancyEditor();editor.querySelector('#occupancy-add').addEventListener('click',()=>draft());
   bindForm('#occupancy-save',async formData=>{
    const changes=[...editor.querySelector('#occupancy-drafts').children].map(collectOccupancyDraft);
    if(!changes.length){message('Подготви поне един нов ред, корекция или оттегляне.',true);return;}
    await applyOccupancy(scope,unit,requestKey,changes,{...readProvenance(formData),reason:String(formData.get('reason')).trim(),history_note:String(formData.get('history_note')).trim()});
    requestKey=crypto.randomUUID();if(loadId===generation){await refresh();message('Всички промени са записани заедно. Новите сведения очакват проверка; оригиналите са запазени.');}
   });
  }
  for(const record of data.records){
   const row=occupancyRecord(record,canManage,draft,async(p,note)=>{try{await reviewOccupancy(scope,unit,p.id,asOf,note);if(loadId===generation){await refresh();message('Проверката на реда е записана. Пълнотата на набора се преглежда отделно.');}}catch(error){message(authError(error),true);}});
   (record.record_state==='current'?rows:history).append(row);
  }
  if(!rows.children.length)rows.textContent='Няма записани текущи версии на периоди на обитаване.';
  if(!history.children.length)history.textContent='Няма заменени или оттеглени записи.';
  const review=document.querySelector('#occupancy-set-review');review.hidden=!canManage||!['needs_set_review','needs_zero_review'].includes(occupancyState(data));
  const old=review.querySelector('form');if(old)old.reset();
  const submit=async event=>{
   event.preventDefault();const form=event.currentTarget;const button=form.querySelector('button');button.disabled=true;
   try{await reviewOccupancy(scope,unit,null,asOf,form.elements.namedItem('note').value.trim());if(loadId===generation){await refresh();message('Проверката на точния набор за датата е записана.');}}
   catch(error){message(authError(error),true);}finally{button.disabled=false;}
  };
  // Replace the handler on reload; never accumulate review submissions.
  review.querySelector('form').onsubmit=submit;
  root.dataset.loadedScope=scope;root.dataset.loadedUnit=unit;root.dataset.loadedDate=asOf;root.dataset.ready='true';select.disabled=false;
 };
 select.onchange=()=>load().catch(error=>message(authError(error),true));
 if(version===generation)await load();
}
