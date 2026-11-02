import {financialDraftsBg as t} from '../i18n/financial-drafts-bg.js';
import {registryToday,calendarLabel} from '../domain/registry.js';
import {repairParameters} from '../domain/financial-drafts.js';
const el=(tag,text='',cls='')=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;};
const option=(s,value,text)=>{const o=el('option',text);o.value=value;s.append(o);};
const period=(a,b)=>`${calendarLabel(a)} — ${b?calendarLabel(b)+' (без този ден)':'без записан край'}`;
export function renderFinancialDrafts(root,data,onSave){
 const previous=root.dataset.scope;root.replaceChildren();root.append(el('p',t.limit,'alert alert-info'),el('p',t.legal,'small'),el('p',t.catalog,'small'));
 if(!data.scopes.length){root.append(el('p',t.none));return;}
 const label=el('label','Финансов обхват','form-label'),scopeSelect=el('select','','form-select mb-4');scopeSelect.id='finance-scope';label.htmlFor=scopeSelect.id;for(const s of data.scopes)option(scopeSelect,s.id,s.label);if(data.scopes.some(s=>s.id===previous))scopeSelect.value=previous;root.append(label,scopeSelect);const content=el('div');root.append(content);
 function render(){
 const scope=data.scopes.find(s=>s.id===scopeSelect.value);root.dataset.scope=scope.id;content.replaceChildren();
 const bases=data.resolutions.filter(r=>r.scope_id===scope.id),rules=data.rules.filter(r=>r.scope_id===scope.id);
 content.append(el('p',scope.can_prepare?'Имаш изрично право за подготовка.':'Само преглед — без право за подготовка.'));
 function history(card,id){const events=data.history.filter(e=>e.target_id===id);const d=el('details'),summary=el('summary','История и произход'),list=el('ol','','mt-2');d.append(summary,list);for(const e of events){const li=el('li',`Редакция ${e.change.after.revision} · ${new Date(e.at).toLocaleString('bg-BG')} · ${e.reason}`,'mb-2 text-break');const before=e.change.before,after=e.change.after;const changed=Object.fromEntries(Object.keys(after).filter(k=>JSON.stringify(before?.[k])!==JSON.stringify(after[k])).map(k=>[k,{before:before?.[k]??null,after:after[k]}]));const detail=el('details'),s=el('summary','Записани промени'),pre=el('pre',JSON.stringify(changed,null,2),'small');pre.style.whiteSpace='pre-wrap';pre.style.overflowWrap='anywhere';detail.append(s,pre);li.append(detail);list.append(li);}card.append(d);}
 for(const b of bases){const card=el('article','','card card-body mb-3 text-break');card.dataset.resolution=b.id;card.append(el('h2',b.title,'h5'),el('p',`${b.reference} · редакция ${b.revision}`),el('p',period(b.effective_from,b.effective_to)),el('p',`${b.source_kind==='document'?'Документ':'Сведение'}: ${b.source_reference} · известно от ${calendarLabel(b.known_from)}`,'small'),el('p',t.review,'fw-bold'));history(card,b.id);content.append(card);}
 for(const r of rules){const c=data.catalog.find(c=>c.id===r.category_id),card=el('article','','card card-body mb-3 text-break');card.dataset.rule=r.id;card.append(el('h2',`${c.label_bg} · каталог v${c.version}`,'h5'),el('p',`${t.review} · редакция ${r.revision}`,'fw-bold'),el('p',t.parameters),el('p',period(r.valid_from,r.valid_to)),el('p',`Основание: ${r.resolution_snapshot.reference}, редакция ${r.resolution_snapshot.revision}`));if(r.basis_changed)card.append(el('p',t.changed,'text-warning-emphasis'));history(card,r.id);content.append(card);}
 if(!scope.can_prepare)return;
 function editor(kind,rows,title){const section=el('section','','card card-body mb-4'),heading=el('h2',title,'h4'),form=el('form');form.dataset.financeForm=kind;section.append(heading,form);content.append(section);let record=null;
 function field(name,title,type='text',max){const l=el('label',title,'form-label'),i=el(type==='textarea'?'textarea':type==='select'?'select':'input','','form-control mb-3');if(i.tagName==='INPUT')i.type=type;i.id=`finance-${kind}-${name}`;i.name=name;l.htmlFor=i.id;if(max)i.maxLength=max;if(type==='textarea')i.rows=2;form.append(l,i);return i;}
 const choose=field('edit','Нова или съществуваща чернова','select');option(choose,'','Нов запис');for(const r of rows)option(choose,r.id,`${r.title||data.catalog.find(c=>c.id===r.category_id).label_bg} · редакция ${r.revision}`);
 const fields={};if(kind==='resolution'){
  for(const[n,title,type,max]of[['title','Заглавие','text',160],['reference','Протокол / точка от решение','text',300],['meeting_date','Дата на събранието','date'],['effective_from','Начало','date'],['effective_to','Край (без този ден, незадължителен)','date'],['source_kind','Произход','select'],['source_reference','Източник / референция','text',300],['known_from','Известно от','date']])fields[n]=field(n,title,type,max);
  option(fields.source_kind,'document','Документ');option(fields.source_kind,'statement','Сведение — непроверено');
 }else{fields.category_id=field('category_id','Версия на глобалната категория','select');for(const c of data.catalog)option(fields.category_id,c.id,`${c.label_bg} · v${c.version}`);fields.resolution_id=field('resolution_id','Конкретно записано основание','select');option(fields.resolution_id,'','Избери основание');for(const b of bases)option(fields.resolution_id,b.id,`${b.reference} · редакция ${b.revision}`);fields.valid_from=field('valid_from','Начало','date');fields.valid_to=field('valid_to','Край (без този ден, незадължителен)','date');form.append(el('p',t.parameters,'small'));}
 for(const[n,i]of Object.entries(fields))i.required=!['effective_to','valid_to'].includes(n);
 const note=field('note','Причина / основание за този запис','textarea',1000);note.required=true;
 function fill(){record=rows.find(r=>r.id===choose.value)||null;for(const[n,i]of Object.entries(fields)){const fallback=n.endsWith('_from')||n==='meeting_date'?registryToday():n==='source_kind'?'document':n==='category_id'?data.catalog[0]?.id||'':'';i.value=record?.[n]??fallback;}note.value='';}fill();choose.addEventListener('change',fill);
 const button=el('button','Запази чернова','btn btn-secondary'),error=el('p','','text-danger mt-2');error.setAttribute('role','alert');form.append(button,error);
 form.addEventListener('submit',async event=>{event.preventDefault();if(!form.reportValidity())return;error.textContent='';button.disabled=true;try{const p=Object.fromEntries(Object.entries(fields).map(([k,i])=>[k,i.value||null]));if(kind==='rule')Object.assign(p,{method:'ideal_shares',mode:'POOL',config:{...repairParameters}});await onSave(kind,scope.id,record,p,note.value);}catch(e){error.textContent=e?.code==='PT409'?t.conflict:t.failed;button.disabled=false;}});
 }
 editor('resolution',bases,'Основание — документна чернова');editor('rule',rules,'Правило — неактивна чернова');
 }
 scopeSelect.addEventListener('change',render);render();
}
