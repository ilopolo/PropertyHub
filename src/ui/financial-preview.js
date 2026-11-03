import {financeDetails,financeState} from './finance-help.js';
import {bindWorkspaceScope} from './workspace-context.js';
import {previewLimit,previewRounding,previewError} from '../i18n/financial-preview-bg.js';
import {registryToday} from '../domain/registry.js';
const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
function field(form,name,title,choices){const label=el('label',title,'form-label d-block mb-3'),n=el(choices?'select':'input','','form-control');n.name=name;n.required=true;if(choices)for(const[v,t]of choices){const o=el('option',t);o.value=v;n.append(o);}label.append(n);form.append(label);return n;}
export function renderFinancialPreview(root,data,actions){
 root.replaceChildren();root.className='mt-4 text-break';root.dataset.state='ready';root.append(el('h2','Изчисли сумите по имоти'),el('p',previewLimit,'alert alert-info'));const help=financeDetails('Метод и използвани данни',el('p','FND-F05 — целево набиране за одобрен основен ремонт.','small'),el('p',previewRounding,'small'));root.append(help);
 if(!data.scopes.length){financeState(root,'no-access','Нямаш финансов достъп за изчислителен преглед.');root.append(help);return;}
 const scope=field(root,'preview_scope','Финансов обхват',data.scopes.map(s=>[s.id,s.label]));if(data.scopes.some(s=>s.id===root.dataset.scope))scope.value=root.dataset.scope;
 const body=el('div');root.insertBefore(scope.parentElement,help);root.insertBefore(body,help);
 function render(){const s=data.scopes.find(s=>s.id===scope.value);body.replaceChildren();if(!s){financeState(body,'no-access','Нямаш достъп до изчисление за избрания контекст.');return;}root.dataset.scope=s.id;const previews=data.previews.filter(p=>p.scope_id===s.id);
  for(const p of previews){const card=el('article','','card card-body mb-3');card.dataset.preview=p.id;card.append(el('h3','Запазен преглед — не е задължение','h5'),el('p',`Дата: ${p.reference_date} · R: ${p.inputs.collection_amount} EUR`,'fw-bold'),el('p',`${p.recorded_at} · ${p.note}`,'small'));
   card.append(el('p',`Основание: ${p.inputs.activation_snapshot.basis.reference} · решение от ${p.inputs.activation_snapshot.basis.meeting_date}`),el('p',`Знаменател: ${p.inputs.share_snapshot.common_parts_reference}`,'small'));
   for(const row of p.result.rows){const input=p.inputs.units.find(u=>u.unit_id===row.unit_id),line=el('div','','border rounded p-3 mb-2');line.dataset.previewUnit=row.unit_id;
    line.append(el('h4',`Обект ${input.unit_number}: ${row.amount} EUR`,'h6'),el('p',`${input.percentage}% · ${row.residual_cent?'получава +1 остатъчен цент':'без остатъчен цент'}`),financeDetails('Подробности за закръглянето',el('p',`Цели центове надолу: ${row.floor_cents}; точен дробен остатък: ${row.remainder_numerator}/${row.remainder_denominator} цент`,'small')),el('p','Собственици само като контекст: '+input.owners_context.map(o=>`${o.label} (съсобственически дял ${o.fraction})`).join('; '),'small'));card.append(line);
   }
   const total=p.result.total_cents.padStart(3,'0');card.append(el('p',`Сбор на редовете: ${total.slice(0,-2)}.${total.slice(-2)} EUR`,'fw-bold'));
   const details=el('details'),pre=el('pre',JSON.stringify({inputs:p.inputs,result:p.result},null,2),'small');pre.style.whiteSpace='pre-wrap';pre.style.overflowWrap='anywhere';details.append(el('summary','Точни фиксирани версии, основание и изчисление'),pre);card.append(details);body.append(card);
  }
  if(!previews.length)financeState(body,'empty','Още няма запазени изчислителни прегледи.');
  if(!s.can_prepare){body.append(el('p','Само четене — нямаш право за подготовка на изчисление.'));return;}
  const form=el('form','','card card-body mb-3');form.dataset.previewForm='create';body.append(form);form.append(el('h3','Подготви изчислителен преглед','h5'));
  const rule=field(form,'rule_id','Активирано правило',[['','Избери конкретно правило'],...data.rules.filter(r=>r.scope_id===s.id).map(r=>[r.id,r.label||'Правило за ремонт'])]),shares=field(form,'share_version_id','Точна версия идеални части',[['','Избери версия'],...data.shares.filter(v=>v.scope_id===s.id).map(v=>[v.id,`${v.label} · версия ${v.revision}`])]),date=field(form,'reference_date','Референтна дата');date.type='date';date.value=registryToday();const note=field(form,'note','Причина за фиксиране на preview');note.maxLength=1000;
  const status=el('p','','small preview-input-status'),error=el('p','','text-danger mt-2');error.setAttribute('role','alert');const inspect=el('button','Провери точните входове','btn btn-outline-secondary mb-3'),create=el('button','Фиксирай preview','btn btn-primary');inspect.type='button';create.disabled=true;form.append(inspect,status,create,error);
  let loaded=null,signature=null,key=null;const selection=()=>({rule_id:rule.value,share_version_id:shares.value,reference_date:date.value});
  for(const n of[rule,shares,date])n.onchange=()=>{loaded=null;create.disabled=true;status.textContent='Изборът е променен — провери входовете отново.';};
  inspect.onclick=async()=>{inspect.disabled=true;create.disabled=true;error.textContent='';try{loaded=await actions.load(s.id,selection());const same=previews.find(p=>p.input_token===loaded.input_token);status.textContent=`Проверени входове: R ${loaded.inputs.collection_amount} EUR (без повторно приспадане) · ${loaded.inputs.units.length} обекта · ${same?'същите входни версии като съществуващ запазен преглед':'нови входни версии спрямо запазените previews'}.`;create.disabled=false;}catch(e){loaded=null;status.textContent='';error.textContent=previewError(e);}finally{inspect.disabled=false;}};
  form.onsubmit=async event=>{event.preventDefault();if(!loaded||!form.reportValidity())return;create.disabled=true;inspect.disabled=true;error.textContent='';try{const p=selection(),next=JSON.stringify([p,loaded.input_token,note.value]);if(signature!==next){signature=next;key=crypto.randomUUID();}await actions.create(s.id,p,loaded.input_token,key,note.value);}catch(e){error.textContent=previewError(e);if(e.code==='PT409')loaded=null;}finally{create.disabled=!loaded;inspect.disabled=false;}};
 }
 bindWorkspaceScope(scope,render);
}
