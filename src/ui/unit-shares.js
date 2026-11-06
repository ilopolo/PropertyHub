import {userError} from './public-text.js';
import {assessPersistedShares} from '../domain/unit-share-records.js';
import {shareStates,shareLimit,shareReasons} from '../i18n/unit-shares-bg.js';
import {registryToday} from '../domain/registry.js';
const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
function field(parent,name,label,value='',{type='text',required=true,choices,max=300}={}){
 const wrap=el('label',label,'form-label d-block mb-3'),n=el(choices?'select':type==='textarea'?'textarea':'input','','form-control');n.name=name;n.required=required;
 if(choices)for(const[v,t]of choices){const o=el('option',t);o.value=v;n.append(o);}else if(n.tagName==='INPUT')n.type=type;
 if(!choices&&['text','textarea'].includes(type))n.maxLength=max;n.value=value??'';wrap.append(n);parent.append(wrap);return n;
}
const button=(parent,text,cls='btn btn-primary')=>{const b=el('button',text,cls);parent.append(b);return b;};
const read=parent=>Object.fromEntries([...parent.querySelectorAll('input,select,textarea')].map(n=>[n.name,n.value||null]));
function action(form,run){form.addEventListener('submit',async e=>{e.preventDefault();const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);let error=form.querySelector('[role=alert]');if(!error){error=el('p','','text-danger text-break mt-2');error.setAttribute('role','alert');form.append(error);}error.textContent='';try{await run();}catch(e){error.textContent=e.code==='PT409'?'Конфликт на версията. Презареди набора преди нова редакция.':e.code?'Операцията е отказана. Провери правата, участниците, периодите, източниците и точните стойности.':userError(e);}finally{buttons.forEach(b=>b.disabled=false);}});}
function provenance(parent,p={}){
 field(parent,'source_kind','Вид източник',p.source_kind||'document',{choices:[['document','Документ'],['declaration','Декларация']]});
 field(parent,'source_reference','Източник',p.source_reference,{max:200});field(parent,'known_from','Известно от',p.known_from||registryToday(),{type:'date'});field(parent,'history_note','Ограничения на известната история',p.history_note,{type:'textarea'});
}
export function renderUnitShares(root,data,actions){
 root.replaceChildren();root.className='card mt-4 p-3 text-break';root.append(el('h2','Идеални части'),el('p',shareLimit,'small'));
 const reload=button(root,'Презареди наборите','btn btn-outline-secondary align-self-start mb-3');reload.type='button';reload.onclick=()=>actions.refresh();
 const unitName=id=>{const u=data.units.find(u=>u.id===id);return u?`Обект ${u.unit_number}`:id;};
 for(const basis of data.bases){
  const v=data.versions.find(v=>v.id===basis.current_version_id),r=data.reviews.find(r=>r.version_id===v.id),assessment=assessPersistedShares(v,r,basis.review_current);
  const card=el('article','','border rounded p-3 mb-3');card.dataset.shareBasis=basis.id;
  card.append(el('h3',v.packet.common_parts_reference||'Набор','h5'),el('p',`${basis.kind==='building'?'Сграда':'Вход'} · версия ${v.revision}`),el('p',shareStates[assessment.state]||assessment.state,'fw-bold share-state'));
  card.append(el('p',`Период: ${v.packet.interval.valid_from} — ${v.packet.interval.valid_to||'без край'} (краят не се включва)`));
  for(const s of assessment.segments)card.append(el('p',`${s.valid_from} — ${s.valid_to||'без край'}: известен сбор ${s.known_total}%`,'small share-total'));
  card.append(el('p',[...new Set(assessment.reasons.map(r=>shareReasons[r.code]||'Невалидни данни'))].join(' · '),'small'));
  if(r&&!basis.review_current)card.append(el('p','Предходната проверка не разрешава нова употреба на текущия набор. Нужни са актуални регистрови данни и нова проверена версия.','text-warning-emphasis'));
  const details=el('details');details.append(el('summary','Редове и произход'));
  for(const row of v.packet.rows)details.append(el('p',`${unitName(row.unit_id)}: ${row.percentage??'неизвестно'}${row.percentage==null?'':'%'} · ${row.valid_from} — ${row.valid_to||'без край'} · ${row.source_reference} · ${row.history_note}`,'small'));
  card.append(details);if(r)card.append(el('p',`Проверка: ${r.verified_at} · ${r.verified_by} · ${r.note}`,'small'));
  const history=el('details');history.append(el('summary','История на версиите'));
  for(const old of data.versions.filter(x=>x.basis_id===basis.id)){
   const p=el('p',`Версия ${old.revision} · ${old.recorded_at} · ${old.reason} `,'small');
   if(data.reviews.some(r=>r.version_id===old.id)){const b=button(p,'Преглед на проверения snapshot','btn btn-sm btn-outline-secondary');b.type='button';b.onclick=async()=>{try{const result=await actions.read(old.id);p.append(el('span',result.ready_for_new_use?' Текущ проверен snapshot за избраната дата.':' Исторически snapshot; не е разрешен за нова употреба.'));}catch{p.append(el('span',' Няма проверена версия за избраната дата.'));}};}history.append(p);
  }card.append(history);
  if(data.can_manage&&!r){
   const form=el('form','','mt-3 share-review');form.dataset.version=v.id;form.append(el('h4','Отделна проверка на точната версия','h6'));
   field(form,'basis_reference','Проверено основание за знаменателя','',{type:'textarea'});field(form,'participants_reference','Проверено основание за пълния набор участници','',{type:'textarea'});
   for(const row of v.packet.rows){const label=el('label',`Проверих източника за ${unitName(row.unit_id)}: ${row.percentage??'неизвестно'} · ${row.source_reference}`,'d-block mb-2'),c=el('input');c.type='checkbox';c.name='row_ids';c.value=row.id;c.required=true;c.className='form-check-input me-2';label.prepend(c);form.append(label);}
   field(form,'note','Мотивирана бележка за проверката','',{type:'textarea'});button(form,'Запиши отделната проверка');action(form,()=>actions.verify(v,{...read(form),row_ids:[...form.querySelectorAll('[name=row_ids]:checked')].map(n=>n.value)}));card.append(form);
  }root.append(card);
 }
 if(!data.bases.length)root.append(el('p','Няма записани набори. Липсващи проценти не са нула.'));
 if(!data.can_manage)return;
 const section=el('details','','share-editor mt-3');section.append(el('summary','Подготви или коригирай набор'));const form=el('form','','mt-3');section.append(form);root.append(section);
 const top=name=>form.querySelector(`:scope > label > [name="${name}"]`);
 const target=field(form,'target','Набор','',{required:false,choices:[['','Нов набор'],...data.bases.map(b=>[b.id,`${b.kind==='building'?'Сграда':'Вход'} · версия ${b.revision}`])]});
 const kind=field(form,'kind','Физически знаменател','building',{choices:[['building','Общи части на сграда'],['entrance','Общи части на вход']]}),building=field(form,'building_id','Изрично избрана сграда','',{choices:[['','Избери сграда'],[data.building.id,data.building.label]]}),entrance=field(form,'entrance_id','Вход','',{required:false,choices:[['','Без вход'],...data.entrances.map(e=>[e.id,e.label])]});
 field(form,'common_parts_reference','Конкретни общи части и основание','',{max:200});field(form,'participants_reference','Основание за явния списък обекти','',{max:200});field(form,'valid_from','Начало на набора',registryToday(),{type:'date'});field(form,'valid_to','Край на набора (изключва се)','',{type:'date',required:false});provenance(form);
 const participants=el('fieldset','','border rounded p-2 mb-3');participants.append(el('legend','Явни участници','h6'));form.append(participants);const rows=el('div','','share-rows');form.append(rows);
 const selected=()=>[...participants.querySelectorAll('input:checked')].map(n=>n.value);
 function roster(ids=[]){participants.querySelectorAll('label').forEach(n=>n.remove());for(const u of data.units.filter(u=>kind.value==='building'||u.entrance_id===entrance.value)){const l=el('label',unitName(u.id),'d-block mb-2'),c=el('input');c.type='checkbox';c.name='participant';c.value=u.id;c.checked=ids.includes(u.id);c.className='form-check-input me-2';l.prepend(c);participants.append(l);}}
 function row(p={}){const box=el('fieldset','','border rounded p-3 mb-3 share-row');box.append(el('legend','Процентен ред','h6'));field(box,'unit_id','Обект',p.unit_id,{choices:[['','Избери участник'],...selected().map(id=>[id,unitName(id)])]});field(box,'percentage','Процент (празно = неизвестно)',p.percentage,{required:false,max:12});field(box,'valid_from','Начало на реда',p.valid_from||top('valid_from').value,{type:'date'});field(box,'valid_to','Край на реда (изключва се)',p.valid_to||top('valid_to').value,{type:'date',required:false});provenance(box,p);const remove=button(box,'Премахни реда от подготвяната версия','btn btn-outline-danger');remove.type='button';remove.onclick=()=>box.remove();rows.append(box);}
 const add=button(form,'Добави процентен ред','btn btn-outline-secondary mb-3');add.type='button';add.onclick=()=>row();field(form,'reason','Причина за новата версия','',{type:'textarea'});button(form,'Запиши нова версия');
 function fill(){rows.replaceChildren();const b=data.bases.find(b=>b.id===target.value),p=data.versions.find(v=>v.id===b?.current_version_id)?.packet;for(const name of ['kind','building_id','entrance_id'])top(name).disabled=Boolean(b);if(p){for(const name of ['kind','building_id','entrance_id','common_parts_reference','participants_reference','source_kind','source_reference','known_from','history_note'])top(name).value=p[name]??p.basis[name]??'';top('valid_from').value=p.interval.valid_from;top('valid_to').value=p.interval.valid_to||'';roster(p.participants.unit_ids);p.rows.forEach(row);}else{kind.value='building';building.value='';entrance.value='';roster();}}
 target.onchange=fill;kind.onchange=()=>roster();entrance.onchange=()=>roster();fill();let signature,key;
 participants.onchange=()=>{for(const select of rows.querySelectorAll('[name=unit_id]')){const old=select.value;select.replaceChildren();for(const id of ['',...selected()]){const o=el('option',id?unitName(id):'Избери участник');o.value=id;select.append(o);}select.value=selected().includes(old)?old:'';}};
 action(form,async()=>{const b=data.bases.find(b=>b.id===target.value),p={kind:kind.value,building_id:building.value,entrance_id:kind.value==='entrance'?entrance.value:null};for(const name of ['common_parts_reference','participants_reference','source_kind','source_reference','known_from','history_note','valid_from','valid_to'])p[name]=top(name).value||null;p.unit_ids=selected();p.rows=[...rows.children].map(read);const reason=top('reason').value,next=JSON.stringify([b?.id,b?.revision,p,reason]);if(next!==signature){signature=next;key=crypto.randomUUID();}await actions.save(b,p,reason,key);});
}
