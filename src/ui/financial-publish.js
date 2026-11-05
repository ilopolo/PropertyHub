import {financeDetails,financeState} from './finance-help.js';
import {bindWorkspaceScope} from './workspace-context.js';
import {chargeLimit,chargeLabels,chargeError,chargeGap} from '../i18n/financial-publish-bg.js';
const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
function field(form,name,title,value='',choices){const label=el('label',title,'form-label d-block mb-3'),n=el(choices?'select':'input','','form-control');n.name=name;if(choices)for(const[v,t]of choices){const o=el('option',t);o.value=v;n.append(o);}n.value=value;n.maxLength=1000;label.append(n);form.append(label);return n;}
function button(form,label,action){const b=el('button',label,'btn btn-outline-primary me-2 mb-2');b.type='button';form.append(b);b.onclick=action;return b;}
function errorNode(root){const n=el('p','','text-danger');n.setAttribute('role','alert');root.append(n);return n;}
async function run(root,error,action){const buttons=[...root.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);error.textContent='';try{await action();}catch(e){error.textContent=chargeError(e);if(e.code==='PT409')root.querySelectorAll('[data-review],[data-publish]').forEach(b=>b.dataset.conflict='true');}finally{buttons.forEach(b=>b.disabled=b.dataset.conflict==='true');}}
export function renderChargeBatches(root,data,actions,{monthly=false}={}){
 root.replaceChildren();root.className='mt-4 text-break';root.dataset.state='ready';root.append(el('h2',monthly?'Прегледай и публикувай месечните задължения':'Прегледай и публикувай начисленията'),el('p',monthly?'Публикуването създава лични задължения за целия месечен набор след отделен мотивиран преглед. Собственикът не става автоматично длъжник. Платецът остава отделен; тук не се извършват банкови плащания.':chargeLimit,'alert alert-info'));
 if(!data.scopes.length){financeState(root,'no-access','Нямаш финансов достъп за начисления.');return;}
 const scope=field(root,'charge_scope','Обхват за начисления',root.dataset.scope||data.scopes[0].id,data.scopes.map(s=>[s.id,s.label]));const body=el('div');root.append(body);
 function render(){const s=data.scopes.find(s=>s.id===scope.value);body.replaceChildren();if(!s){financeState(body,'no-access','Нямаш достъп до начисления за избрания контекст.');return;}root.dataset.scope=s.id;const batches=data.batches.filter(b=>b.scope_id===s.id);
  function editor(b=null){const form=el('form','','card card-body mb-3');form.dataset.chargeForm=b?.id||'new';form.append(el('h3',b?'Корекция на чернова':'Нова чернова за публикуване','h5'));
   const values=b?.claim||{},preview=field(form,'preview_id','Точен приет preview',values.preview_id||'',[['','Избери preview'],...data.previews.filter(p=>p.scope_id===s.id).map(p=>[p.id,`${p.date} · ${p.amount} EUR`])]);preview.required=true;
   const model=field(form,'publication_model','Режим на личната отговорност',monthly?'monthly-owner-occupant-v1':values.publication_model||'sole-owner-v1',monthly?[['monthly-owner-occupant-v1','Прегледан единствен собственик и обитател за целия месец']]:[['sole-owner-v1','Единствен собственик на всеки имот'],['ordinary-coowner-v1','Обикновена дялова съсобственост — отделен преглед на лицата']]);
   const fields={};for(const[k,label]of Object.entries(chargeLabels)){fields[k]=field(form,k,label,values[k]||'');if(k==='liability_date')fields[k].type='date';}
   if(monthly){const sync=()=>{fields.liability_date.value=data.previews.find(p=>p.id===preview.value)?.date||'';};preview.onchange=sync;fields.liability_date.readOnly=true;sync();}
   const correction=field(form,'replaces_batch_id','Коригира неплатен публикуван вариант',values.replaces_batch_id||'',[['','Ново първоначално публикуване'],...batches.filter(x=>x.status==='published'&&x.kind!=='reversal'&&!batches.some(y=>y.reverses_id===x.id)).map(x=>[x.id,`${x.pool_amount} EUR · редакция ${x.revision}`])]);correction.disabled=!s.can_correct;
   const note=field(form,'note','Причина за подготовката/корекцията');note.required=true;const error=errorNode(form);
   form.onsubmit=e=>{e.preventDefault();if(form.reportValidity())run(form,error,()=>actions.save(s.id,b?.id||null,b?.revision||0,crypto.randomUUID(),{preview_id:preview.value,...Object.fromEntries(Object.entries(fields).map(([k,n])=>[k,n.value])),replaces_batch_id:correction.value||null,...(model.value!=='sole-owner-v1'?{publication_model:model.value}:{})},note.value));};
   const save=el('button','Запази черновата','btn btn-primary');form.append(save);body.append(form);
  }
  for(const b of batches){const card=el('article','','card card-body mb-3');card.dataset.chargeBatch=b.id;card.append(el('h3',`${b.status==='draft'?'Чернова':b.kind==='reversal'?'Обратен запис':'Публикувано'} · редакция ${b.revision}`,'h5'),el('p',`${monthly?'Общо':'R'} ${b.pool_amount} EUR · ${b.period_start}…${b.period_end}`),financeDetails('Идентификатори и версии',el('p',`Набор ${b.id} · изчисление ${b.preview_id}`,'small')));
   if(b.status==='published'){card.append(el('p','Неизменим snapshot. Платецът е отделен от длъжника; покритията и остатъкът се показват в раздела за плащания.'));
    for(const c of data.charges.filter(c=>c.batch_id===b.id)){const item=el('section','','border rounded p-2 mb-2');item.dataset.charge=c.id;item.append(el('p',`Обект ${c.unit_snapshot?.unit_number||c.unit_id} · общо ${c.amount} EUR · падеж ${c.due_date}`,'fw-bold'));
     for(const p of data.parties.filter(p=>p.charge_id===c.id)){const line=el('p',`Длъжник: ${p.person_snapshot.label||p.person_id} · ${p.assessed_amount} EUR · дата на отговорността ${p.liability_date}`);line.dataset.obligationParty=p.id;item.append(line);}
     card.append(item);}
   }else{
    const gaps=b.preparation_snapshot.gaps;for(const gap of gaps)card.append(el('p',chargeGap(gap),'text-danger'));card.append(el('p',b.review?`Прегледан за ${b.review.publication_day} · ${b.review.note}`:'Непрегледана лична отговорност.'));
    const error=errorNode(card),reviewArea=el('div');card.append(reviewArea);
    if(s.can_publish){button(card,'Зареди точните данни за личен преглед',()=>run(card,error,async()=>{const x=(await actions.load(s.id,b.claim)).inputs,isB=b.publication_model==='ordinary-coowner-v1';reviewArea.replaceChildren();reviewArea.append(el('p',monthly?`Решение: ${x.basis.meeting_date} · Отговорност: ${x.liability_date} · Публикуване: ${x.publication_day} · Падеж: ${x.due_date}`:`Решение: ${x.meeting_date} · Отговорност: ${x.liability_date||'липсва'} · Публикуване: ${x.publication_day} · Изчисление: ${x.reference_date} · Падеж: ${x.due_date}`,'fw-bold'),financeDetails('Технически период на проверката',el('p',monthly?`CALC-04 · [${x.preview.inputs.period_start},${x.preview.inputs.period_end}) · Europe/Sofia. Отделен преглед на личното основание.`:`FND-F05 / ${isB?'Co-owner B':'Publish A'} · [${x.interval_from},${x.interval_to}) · Europe/Sofia`)));
      for(const[k,label]of Object.entries(chargeLabels))reviewArea.append(el('p',`${label}: ${b.claim[k]||'липсва'}`));
      for(const gap of x.gaps)reviewArea.append(el('p',chargeGap(gap),'text-danger'));
      if(isB)reviewArea.append(el('p','За всяко лице установи обикновена дялова собственост и приложимо лично основание. СИО, спор, променен състав или квоти, които не се представят точно, блокират целия набор. Попълването не е юридическа заверка.','alert alert-warning'));
      const inputs=x.parties.map(p=>{reviewArea.append(el('p',`Обект ${p.unit_number}: ${p.label} · ${p.amount} EUR${isB?' · квота '+p.fraction:''}`,'border-top pt-2'));const n=field(reviewArea,'party_evidence','Доказателство за самоличност и лична отговорност за този ред');n.required=true;
       let regime,representation,reason;if(isB){regime=field(reviewArea,'ownership_regime','Установен собственически режим','',[['','Избери след преглед'],['ordinary_fractional','Обикновена дялова собственост'],['joint_marital','СИО — неподдържано'],['disputed','Неизяснен спор — блокирано'],['unknown','Неустановен режим — блокирано']]);representation=field(reviewArea,'quota_representation','Представяне на източниковата квота','',[['','Избери след преглед'],['exact_decimal','Точно представима десетична квота'],['rational_required','Нужна е точна дроб, напр. 1/3 — неподдържано']]);reason=field(reviewArea,'proportionality_reason','Защо собственическата квота е приложима лична тежест към тази дата');reason.required=true;}
       return{p,n,regime,representation,reason};});
      const motive=field(reviewArea,'review_note','Мотивиран преглед на основанието, L и точните длъжници');motive.required=true;
      if(!x.gaps.length){const review=button(reviewArea,'Потвърди прегледа на всички длъжници',()=>run(card,error,()=>actions.review(s.id,b.id,b.revision,crypto.randomUUID(),inputs.map(({p,n,regime,representation,reason})=>({unit_id:p.unit_id,person_id:p.person_id,person_revision:p.person_revision,ownership_id:p.ownership_id,evidence_reference:n.value,...(isB?{ownership_regime:regime.value,quota_representation:representation.value,coowner_basis_kind:'reviewed_proportional_liability',proportionality_reason:reason.value}:{})})),motive.value)));review.dataset.review='true';}
     }));
     if(b.review){const note=field(card,'publish_note','Причина за публикуване на целия набор');const pub=button(card,'Публикувай всички начисления',()=>run(card,error,()=>actions.publish(s.id,b.id,b.revision,crypto.randomUUID(),note.value)));pub.dataset.publish='true';}
    }
    if(s.can_prepare&&(!b.replaces_id||s.can_correct))button(card,'Редактирай черновата',()=>editor(b));
   }
   const snapshot=el('details'),pre=el('pre',JSON.stringify(b.publication_snapshot||b.preparation_snapshot,null,2),'small');pre.style.whiteSpace='pre-wrap';pre.style.overflowWrap='anywhere';snapshot.append(el('summary','Версии и запазен snapshot'),pre);card.append(snapshot);body.append(card);
  }
  if(!batches.length)financeState(body,'empty','Още няма подготвени или публикувани начисления.');
  if(s.can_prepare)editor();
  const history=el('details');history.append(el('summary','Проследима история'));
  for(const h of data.history.filter(h=>batches.some(b=>b.id===h.target_id)))history.append(el('p',`${h.at} · ${h.action} · ${h.reason} · ${h.actor}`,'small'));body.append(history);
 }
 bindWorkspaceScope(scope,render);
}
