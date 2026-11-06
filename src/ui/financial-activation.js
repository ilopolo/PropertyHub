import {humanText} from './public-text.js';
import {applicabilitySchema,applicabilityFields} from '../domain/financial-activation.js';
import {applicabilityLabels,activationLimit} from '../i18n/financial-activation-bg.js';
import {financialDraftsBg as t} from '../i18n/financial-drafts-bg.js';
const el=(tag,text='',cls='')=>{const e=document.createElement(tag);e.textContent=humanText(text);if(cls)e.className=cls;return e;};
const opt=(s,v,t)=>{const o=el('option',t);o.value=v;s.append(o);};
export function renderFinancialActivation(root,scope,bases,rules,onSave){
 const help=document.createElement('details'),summary=el('summary','Условия за преглед и активация');help.append(summary,el('p',activationLimit,'alert alert-warning'));root.append(help);
 for(const kind of ['applicability','activate']){
  if(kind==='applicability'&&!scope.can_prepare||kind==='activate'&&!scope.can_review)continue;
  const rows=kind==='applicability'?bases.filter(b=>b.resolution_type==='planned_repair_shortfall'):rules.filter(r=>r.status==='draft'&&!rules.some(a=>a.source_draft_id===r.id&&a.source_draft_revision===r.revision));if(!rows.length)continue;
  const section=el('section','','card card-body mb-4'),form=el('form'),fields={};form.dataset.financeForm=kind;section.append(el('h2',kind==='activate'?'Активация на неизменим вариант':'Структурирана приложимост — основен ремонт','h4'),form);root.insertBefore(section,help);
  function field(n,label,type='text'){const l=el('label',label,'form-label'),i=el(type==='select'?'select':type==='textarea'?'textarea':'input','','form-control mb-3');i.name=n;i.id=`finance-${kind}-${n}`;l.htmlFor=i.id;if(i.tagName==='INPUT')i.type=type;if(type==='textarea'){i.rows=2;i.maxLength=1000;}form.append(l,i);return i;}
  const choose=field('target',kind==='activate'?'Точна чернова и редакция':'Точно основание и редакция','select');for(const r of rows)opt(choose,r.id,`${r.reference||'Правило'} · редакция ${r.revision}`);
  if(kind==='applicability'){
   for(const[n,title,value]of [['qualification','Квалификация','Основен ремонт'],['property_regime','Режим на собствеността','Общ режим на ЗУЕС — поне 4 самостоятелни обекта'],['procedure','Процедура','Присъствено общо събрание'],['dominant_owner','Специалният случай на чл. 15, ал. 4','Няма едно лице с повече от 51%']]){fields[n]=field(n,title,'select');opt(fields[n],'','Неустановено — активацията е блокирана');opt(fields[n],applicabilitySchema[n],value);}
   for(const n of applicabilityFields){fields[n]=field(n,applicabilityLabels[n],n.endsWith('_percent')?'text':'textarea');fields[n].required=true;if(n.endsWith('_percent'))fields[n].inputMode='decimal';}
  }else{
   fields.supersedes=field('supersedes','Изрична корекция на активен вариант (само същия период)','select');opt(fields.supersedes,'','Нова активация без замяна');for(const r of rules.filter(r=>r.status==='active'&&!rules.some(c=>c.supersedes_id===r.id)))opt(fields.supersedes,r.id,`${r.valid_from} — ${r.valid_to} · редакция ${r.revision}`);
   form.append(el('p','Сървърът проверява текущите права, точните версии, прегледа, участниците, сумите, периода и конфликтите. Самата активация не създава начисления; публикуването е отделно действие. Движение на средства не се обработва.','small'));
  }
  const note=field('note','Мотиви за промяната / активацията','textarea');note.required=true;let record,requestKey,signature;
  const fill=()=>{record=rows.find(r=>r.id===choose.value);for(const[n,i]of Object.entries(fields))i.value=kind==='applicability'?record.applicability?.[n]??'':'';note.value='';};fill();choose.addEventListener('change',fill);
  const button=el('button',kind==='activate'?'Активирай този вариант':'Запази приложимостта','btn btn-secondary'),error=el('p','','text-danger mt-2');error.setAttribute('role','alert');form.append(button,error);
  form.addEventListener('submit',async e=>{e.preventDefault();if(!form.reportValidity())return;button.disabled=true;error.textContent='';try{let p=Object.fromEntries(Object.entries(fields).map(([n,i])=>[n,i.value||null]));if(kind==='applicability')p={...applicabilitySchema,...p};else{const next=JSON.stringify([record.id,record.revision,p.supersedes,note.value.trim()]);if(next!==signature){signature=next;requestKey=crypto.randomUUID();}p.request_key=requestKey;}await onSave(kind,scope.id,record,p,note.value);}catch(err){error.textContent=err?.code==='PT409'?t.conflict:'Отказ: провери квалификацията, прегледа, участниците, периода и текущите права.';button.disabled=false;}});
 }
}
