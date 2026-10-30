import {provenanceFields,dateTime} from './provenance.js';
import {countLabel} from '../domain/occupancy.js';
import {occupantKinds} from '../i18n/occupancy-bg.js';
export function occupancyEditor(){return `<h3 class="h5">Подготви сведения за обитаването</h3><p>Обща декларация и конкретни лица не могат да се застъпват за имота. При преминаване към друг режим приключи или замени старите записи и добави новите в една група. Смяната на имота или датата презарежда черновата.</p><form id="occupancy-save"><div id="occupancy-drafts"></div><button id="occupancy-add" type="button" class="btn btn-outline-secondary mb-3">Добави сведения</button>${provenanceFields('occupancy')}<label for="occupancy-history-note" class="form-label mt-3">Покритие и ограничения на историята</label><input id="occupancy-history-note" name="history_note" class="form-control mb-3" required maxlength="300"><label for="occupancy-reason" class="form-label">Основание за записа / корекцията</label><input id="occupancy-reason" name="reason" class="form-control mb-3" required maxlength="300"><div class="form-check mb-3"><input id="occupancy-packet" class="form-check-input" type="checkbox" required><label for="occupancy-packet" class="form-check-label">Източникът обосновава всички промени, периода и декларирания брой. Празното означава неизвестно, а не нула.</label></div><button class="btn btn-success">Запиши всички сведения заедно</button></form>`;}
export function occupancyDraft(persons,target,voided,index){
 const box=document.createElement('fieldset');box.className='border rounded p-3 mb-3';box.dataset.target=target?.id||'';box.dataset.void=String(voided);
 const legend=document.createElement('legend');legend.className='h6';legend.textContent=target?`${voided?'Оттегляне':'Корекция'}: ${target.person_label||'Обща декларация'}`:'Нови сведения за обитаване';box.append(legend);
 if(!voided){
  const row=document.createElement('div');row.className='row g-3';const controls={},columns={},labels={};
  for(const [name,labelText,type]of [['count_mode','Режим на сведенията','select'],['occupant_kind','Деклариран статут','select'],['person_id','Конкретно лице в обхвата','select'],['units','Общ брой (празно = неизвестен)','text'],['valid_from','Начало на приложимия запис','date'],['valid_to','Край, без тази дата (по желание)','date']]){
   const col=document.createElement('div');col.className='col-sm-6';const label=document.createElement('label');label.className='form-label';label.htmlFor=`occupancy-${index}-${name}`;label.textContent=labelText;
   const input=document.createElement(type==='select'?'select':'input');input.id=label.htmlFor;input.name=name;input.className=type==='select'?'form-select':'form-control';
   if(type!=='select'){input.type=type;if(type==='text'){input.inputMode='numeric';input.pattern='(0|[1-9][0-9]{0,7})';input.maxLength=8;}else{input.min='0001-01-01';input.max='9999-12-31';input.required=name==='valid_from';}}
   col.append(label,input);row.append(col);controls[name]=input;columns[name]=col;labels[name]=label;
  }
  for(const [value,label]of [['aggregate','Обща декларация за имота'],['individual','По конкретни лица']]){const o=document.createElement('option');o.value=value;o.textContent=label;controls.count_mode.append(o);}
  for(const [value,label]of Object.entries(occupantKinds).filter(([key])=>key!=='aggregate')){const o=document.createElement('option');o.value=value;o.textContent=label;controls.occupant_kind.append(o);}
  const empty=document.createElement('option');empty.value='';empty.textContent='Избери конкретното лице';controls.person_id.append(empty);
  for(const p of persons){const o=document.createElement('option');o.value=p.id;o.textContent=`${p.display_name} · ${p.id.slice(0,8)}`;controls.person_id.append(o);}
  controls.count_mode.value=target?.count_mode||'aggregate';controls.occupant_kind.value=target?.occupant_kind==='aggregate'?'other_resident':target?.occupant_kind||'other_resident';
  controls.person_id.value=target?.person_id||'';controls.units.value=target?.household_units==null?'':countLabel(target.household_units);controls.valid_from.value=target?.valid_from||'';controls.valid_to.value=target?.valid_to||'';
  const mode=(changed=false)=>{
   const individual=controls.count_mode.value==='individual';
   for(const name of ['person_id','occupant_kind']){columns[name].hidden=!individual;controls[name].disabled=!individual;controls[name].required=individual;}
   controls.units.readOnly=individual;controls.units.required=individual;labels.units.textContent=individual?'Брой (едно конкретно лице = 1)':'Общ брой (празно = неизвестен)';
   if(individual)controls.units.value='1';else if(changed){controls.units.value='';controls.person_id.value='';}
  };controls.count_mode.addEventListener('change',()=>mode(true));mode();box.append(row);
 }
 const remove=document.createElement('button');remove.type='button';remove.className='btn btn-outline-secondary mt-3';remove.textContent='Премахни от черновата';remove.addEventListener('click',()=>box.remove());box.append(remove);return box;
}
export function collectOccupancyDraft(box){
 if(box.dataset.void==='true')return {target:box.dataset.target,void:true};
 const value=name=>box.querySelector(`[name="${name}"]`).value.trim(),individual=value('count_mode')==='individual';
 return {target:box.dataset.target||null,count_mode:value('count_mode'),occupant_kind:individual?value('occupant_kind'):'aggregate',person_id:individual?value('person_id'):null,units:value('units')||null,valid_from:value('valid_from'),valid_to:value('valid_to')||null};
}
export function occupancyRecord(p,canManage,onDraft,onReview){
 const li=document.createElement('li');li.className='list-group-item text-break';li.dataset.occupancyId=p.id;
 const title=document.createElement('h4');title.className='h6';title.textContent=p.count_mode==='individual'?`${p.person_label} · ${occupantKinds[p.occupant_kind]}`:'Обща декларация за имота';
 const text=document.createElement('p');text.textContent=`Брой: ${countLabel(p.household_units)} · ${p.valid_from} — ${p.valid_to?`${p.valid_to} (краят не е включен)`:'без посочен край'} · ${p.verification_status==='verified'?'Проверен ред':'Нужен преглед'}`;
 const source=document.createElement('p');source.className='small';source.textContent=`${p.source_kind==='document'?'Документ':'Декларирани сведения'}: ${p.source_reference} · Известно от ${p.known_from} · ${p.history_note} · Записано ${dateTime(p.recorded_at)}`;
 li.append(title,text,source);
 if(p.verified_at){const note=document.createElement('p');note.className='small';note.textContent=`Проверка ${dateTime(p.verified_at)} · ${p.verification_note}`;li.append(note);}
 if(p.record_state!=='current'){const note=document.createElement('p');note.textContent=`${p.record_state==='voided'?'Оттеглен':'Заменен'} · ${p.retirement_note} · ${p.retirement_evidence?.source_reference||''} · ${dateTime(p.retired_at)}`;li.append(note);}
 else if(canManage){
  for(const [label,voided]of [['Коригирай',false],['Оттегли',true]]){const b=document.createElement('button');b.type='button';b.className='btn btn-outline-secondary me-2 mb-2';b.textContent=label;b.addEventListener('click',()=>onDraft(p,voided));li.append(b);}
  if(p.verification_status!=='verified'&&p.household_units!==null&&p.subject_eligible!==false){
   const form=document.createElement('form');form.className='my-3';const label=document.createElement('label');label.htmlFor=`occupancy-review-${p.id}`;label.className='form-label';label.textContent='Основание за проверка на реда';const input=document.createElement('input');input.id=label.htmlFor;input.className='form-control mb-2';input.required=true;input.maxLength=300;
   const b=document.createElement('button');b.className='btn btn-outline-secondary';b.textContent='Провери реда';form.append(label,input,b);form.addEventListener('submit',async e=>{e.preventDefault();b.disabled=true;try{await onReview(p,input.value.trim());}finally{b.disabled=false;}});li.append(form);
  }
 }return li;
}
