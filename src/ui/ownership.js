import {provenanceFields,dateTime} from './provenance.js';
import {decimalLabel} from '../domain/ownership.js';
export function ownershipEditor() {
 return `<h3 class="h5">Подготви промени за този имот</h3><p>Добави нови връзки или използвай „Коригирай“ / „Оттегли“ до реда. Всички подготвени промени се записват заедно. При смяна на собственик приключи старите периоди и добави новите в същата група. Смяната на имота или датата презарежда черновата.</p>
 <form id="ownership-save"><div id="ownership-drafts"></div><button id="ownership-add" type="button" class="btn btn-outline-secondary mb-3">Добави нов собственик</button>
 ${provenanceFields('ownership')}
 <label for="ownership-history-note" class="form-label mt-3">Покритие и ограничения на историята</label><input id="ownership-history-note" name="history_note" class="form-control mb-3" required maxlength="300"><p class="small">Началото на записа не е автоматично дата на покупка. Посочи, ако сведенията са известни само от определена дата.</p>
 <label for="ownership-reason" class="form-label">Основание за записа / корекцията</label><input id="ownership-reason" name="reason" class="form-control mb-3" required maxlength="300">
 <div class="form-check mb-3"><input id="ownership-packet" class="form-check-input" type="checkbox" required><label class="form-check-label" for="ownership-packet">Източникът обосновава всички подготвени промени. Прегледах периодите и дяловете.</label></div><button class="btn btn-success">Запиши всички подготвени промени</button></form>`;
}
export function ownershipDraft(persons,target,voided,index) {
 const box=document.createElement('fieldset');box.className='border rounded p-3 mb-3';box.dataset.target=target?.id||'';box.dataset.void=String(voided);
 const legend=document.createElement('legend');legend.className='h6';legend.textContent=target?`${voided?'Оттегляне':'Корекция'}: ${target.person_label}`:'Нова собственическа връзка';box.append(legend);
 if(voided){const text=document.createElement('p');text.textContent='Оригиналът и основанието за оттегляне остават в историята.';box.append(text);}
 else{
  const row=document.createElement('div');row.className='row g-3';
  const fields=[['person_id','Лице в този обхват','select'],['fraction','Дял от имота (0.5 = 1/2, до 10 десетични знака)','text'],['valid_from','Начало на приложимия запис','date'],['valid_to','Край, без тази дата (по желание)','date']];
  for(const [name,labelText,type]of fields){
   const col=document.createElement('div');col.className='col-sm-6';const label=document.createElement('label');label.className='form-label';label.htmlFor=`ownership-${index}-${name}`;label.textContent=labelText;
   const input=document.createElement(type==='select'?'select':'input');input.id=label.htmlFor;input.name=name;input.className=type==='select'?'form-select':'form-control';input.required=name!=='valid_to';
   if(type==='select'){const empty=document.createElement('option');empty.value='';empty.textContent='Избери конкретното лице';input.append(empty);for(const p of persons){const o=document.createElement('option');o.value=p.id;o.textContent=`${p.display_name} · ${p.id.slice(0,8)}`;input.append(o);}}
   else{input.type=type;if(type==='text'){input.inputMode='decimal';input.pattern='[01](\\.[0-9]{1,10})?';input.maxLength=12;}else{input.min='0001-01-01';input.max='9999-12-31';}}
   if(target)input.value=name==='fraction'?decimalLabel(target.ownership_fraction):target[name]||'';
   col.append(label,input);row.append(col);
  }box.append(row);
 }
 const remove=document.createElement('button');remove.type='button';remove.className='btn btn-outline-secondary mt-3';remove.textContent='Премахни от черновата';remove.addEventListener('click',()=>box.remove());box.append(remove);return box;
}
export function ownershipRecord(p,canManage,onDraft,onReview) {
 const li=document.createElement('li');li.className='list-group-item text-break';li.dataset.ownershipId=p.id;
 const title=document.createElement('h4');title.className='h6';title.textContent=`${p.person_label} · дял ${decimalLabel(p.ownership_fraction)} от 1`;
 const period=document.createElement('p');period.textContent=`${p.valid_from} — ${p.valid_to?`${p.valid_to} (краят не е включен)`:'без посочен край'} · ${p.verification_status==='verified'?'Проверен ред':'Нужен преглед'}`;
 const source=document.createElement('p');source.className='small';source.textContent=`${p.source_kind==='document'?'Документ':'Декларирани сведения'}: ${p.source_reference} · Известно от ${p.known_from} · ${p.history_note} · Записано ${dateTime(p.recorded_at)}. Име при въвеждането, ревизия на лицето ${p.person_revision}.`;
 li.append(title,period,source);
 if(p.verified_at){const check=document.createElement('p');check.className='small';check.textContent=`Проверка: ${dateTime(p.verified_at)} · ${p.verification_note}`;li.append(check);}
 if(p.record_state!=='current'){const note=document.createElement('p');note.textContent=`${p.record_state==='voided'?'Оттеглен':'Заменен'} запис · ${p.retirement_note} · ${p.retirement_evidence?.source_reference||''} · ${dateTime(p.retired_at)}`;li.append(note);}
 else if(canManage){
  for(const [text,voided]of [['Коригирай',false],['Оттегли',true]]){const b=document.createElement('button');b.type='button';b.className='btn btn-outline-secondary me-2 mb-2';b.textContent=text;b.addEventListener('click',()=>onDraft(p,voided));li.append(b);}
  if(p.verification_status!=='verified'){
   const form=document.createElement('form');form.className='my-3';const label=document.createElement('label');label.htmlFor=`ownership-review-${p.id}`;label.className='form-label';label.textContent='Основание за проверка на реда';
   const input=document.createElement('input');input.id=label.htmlFor;input.className='form-control mb-2';input.required=true;input.maxLength=300;
   const b=document.createElement('button');b.className='btn btn-outline-secondary';b.textContent='Провери реда';form.append(label,input,b);form.addEventListener('submit',async e=>{e.preventDefault();b.disabled=true;try{await onReview(p,input.value.trim());}finally{b.disabled=false;}});li.append(form);
  }
 }return li;
}
