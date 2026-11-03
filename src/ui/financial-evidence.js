import {evidenceSchema,evidenceTextFields,moneyFields} from '../domain/financial-evidence.js';
import {evidenceLabels as labels,evidenceStatus,evidenceDisclaimer,evidenceUnitTypes} from '../i18n/financial-evidence-bg.js';
import {supportedResolutionType} from '../domain/financial-drafts.js';
import {financialDraftsBg} from '../i18n/financial-drafts-bg.js';
const el=(tag,text='',cls='')=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;};
const option=(select,value,label)=>{const o=el('option',label);o.value=value;select.append(o);};
export function appendFinancialEvidence(card,b){
 card.append(el('p',evidenceStatus[b.verification_status]||evidenceStatus.needs_review,'fw-bold'));
 if(b.reviewed_at)card.append(el('p',`Преглед на редакция ${b.reviewed_revision} · ${new Date(b.reviewed_at).toLocaleString('bg-BG')} · ${b.review_note}`,'small text-break'));
 const gaps=b.evidence_gaps||[];card.append(el('p',gaps.length?'Структурни липси: '+gaps.map(k=>labels[k]||'Историческо основание').join('; '):'Структурните полета са попълнени. Това не е юридическа валидация.','small'));
 if(b.evidence?.record_kind)card.append(el('p',b.evidence.record_kind==='synthetic'?'Синтетично основание — само за техническа проверка':'Клиентско основание — заявени данни','badge text-bg-secondary text-wrap'));
 const details=el('details'),summary=el('summary','Данни от основанието и финансиране'),dl=el('dl','','mt-2');details.append(summary,el('p',evidenceDisclaimer,'small'),dl);
 if(b.reviewed_by)dl.append(el('dt','Проверяващ (идентификатор)','small'),el('dd',b.reviewed_by,'small text-break'));
 for(const k of [...moneyFields,...evidenceTextFields].filter(k=>k!=='record_kind'))dl.append(el('dt',labels[k],'small'),el('dd',b.evidence?.[k]??'Неизвестно / непопълнено','small text-break'));
 dl.append(el('dt',labels.unit_ids,'small'),el('dd',`${b.evidence?.unit_ids?.length??0} изрично записани имота; пълнотата и идеалните части изискват отделна проверка.`,'small'));card.append(details);
}
export function renderFinancialEvidenceEditors(root,scope,bases,units,onSave){
 const available=bases.filter(b=>b.resolution_type===supportedResolutionType);if(!available.length)return;
 root.append(el('p',evidenceDisclaimer,'alert alert-info'));
 for(const kind of ['evidence','review']){
  if(kind==='evidence'&&!scope.can_prepare||kind==='review'&&!scope.can_review)continue;
  const section=el('section','','card card-body mb-4'),form=el('form'),fields={};form.dataset.financeForm=kind;
  section.append(el('h2',kind==='evidence'?'Доказателства и финансиране на ремонта':'Преглед на конкретно основание','h4'),form);root.append(section);
  function field(name,label,type='text',parent=form){const l=el('label',label,'form-label'),i=el(type==='select'?'select':type==='textarea'?'textarea':'input','','form-control mb-3');if(i.tagName==='INPUT')i.type=type;i.name=name;i.id=`finance-${kind}-${name}`;l.htmlFor=i.id;if(type==='textarea')i.rows=2;if(!['date','select'].includes(type))i.maxLength=1000;parent.append(l,i);return i;}
  const choose=field('target','Конкретно основание и редакция','select');for(const b of available)option(choose,b.id,`${b.reference} · редакция ${b.revision}`);
  const checks=[];if(kind==='evidence'){
   fields.record_kind=field('record_kind',labels.record_kind,'select');option(fields.record_kind,'','Неизвестно');option(fields.record_kind,'synthetic','Синтетично — техническа проверка');option(fields.record_kind,'client','Клиентски документи');
   const set=el('fieldset','','mb-3');set.append(el('legend',labels.unit_ids,'h6'));for(const u of units.filter(u=>u.scope_id===scope.id)){const label=el('label','','d-block'),input=el('input');input.type='checkbox';input.value=u.id;input.name='unit_ids';input.className='form-check-input me-2';label.append(input,document.createTextNode(`${evidenceUnitTypes[u.unit_type]||'Обект'} ${u.unit_number}`));checks.push(input);set.append(label);}form.append(set);
   const groups=[['Работи, доказателства и правно основание',evidenceTextFields.filter(k=>!['record_kind','funds_as_of','funds_reference','use_reference','collection_reference','due_on'].includes(k))],['Финансиране — заявени суми, не банков баланс',[...moneyFields,'funds_as_of','funds_reference','use_reference','collection_reference','due_on']]];
   for(const[title,keys]of groups){const details=el('details','','mb-3'),body=el('div','','mt-3');details.append(el('summary',title),body);form.append(details);for(const k of keys){fields[k]=field(k,labels[k],['funds_as_of','due_on'].includes(k)?'date':moneyFields.includes(k)||k==='evidence_sha256'?'text':'textarea',body);if(moneyFields.includes(k)){fields[k].inputMode='decimal';fields[k].placeholder='0.00';}}}
   form.append(el('p','Празните полета остават неизвестни. Суми в EUR с десетична точка; няма автоматично изразходване на наличностите.','small'));
  }else{
   form.append(el('p','Имаш изрично право за преглед в този обхват. Записваш преглед на представената версия с мотиви; не активираш правило и не удостоверяваш автоматично юридическа валидност.','small'));
   fields.outcome=field('outcome','Резултат от прегледа','select');option(fields.outcome,'changes_requested','Върни за корекция');option(fields.outcome,'reviewed','Прегледано — без активация');
  }
  const note=field('note','Мотиви и основание за промяната','textarea');note.required=true;let record;
  const fill=()=>{record=available.find(b=>b.id===choose.value);for(const[k,i]of Object.entries(fields))i.value=kind==='review'?'changes_requested':record.evidence?.[k]??'';for(const c of checks)c.checked=!!record.evidence?.unit_ids?.includes(c.value);note.value='';};fill();choose.addEventListener('change',fill);
  const button=el('button',kind==='review'?'Запиши прегледа':'Запази данните от основанието','btn btn-secondary'),error=el('p','','text-danger mt-2');error.setAttribute('role','alert');form.append(button,error);
  form.addEventListener('submit',async event=>{event.preventDefault();if(!form.reportValidity())return;error.textContent='';button.disabled=true;try{const p=Object.fromEntries(Object.entries(fields).map(([k,i])=>[k,i.value||null]));if(kind==='evidence')Object.assign(p,evidenceSchema,{unit_ids:checks.filter(c=>c.checked).map(c=>c.value)});await onSave(kind,scope.id,record,p,note.value);}catch(e){error.textContent=e?.code==='PT409'?financialDraftsBg.conflict:'Промяната е отказана. Провери структурните липси, сумите, периода и текущите права.';button.disabled=false;}});
 }
}
