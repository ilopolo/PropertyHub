import {chargeLimit,chargeLabels,chargeError,chargeGap} from '../i18n/financial-publish-bg.js';
const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
function field(form,name,title,value='',choices){const label=el('label',title,'form-label d-block mb-3'),n=el(choices?'select':'input','','form-control');n.name=name;if(choices)for(const[v,t]of choices){const o=el('option',t);o.value=v;n.append(o);}n.value=value;n.maxLength=1000;label.append(n);form.append(label);return n;}
function button(form,label,action){const b=el('button',label,'btn btn-outline-primary me-2 mb-2');b.type='button';form.append(b);b.onclick=action;return b;}
function errorNode(root){const n=el('p','','text-danger');n.setAttribute('role','alert');root.append(n);return n;}
async function run(root,error,action){const buttons=[...root.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);error.textContent='';try{await action();}catch(e){error.textContent=chargeError(e);if(e.code==='PT409')root.querySelectorAll('[data-review],[data-publish]').forEach(b=>b.dataset.conflict='true');}finally{buttons.forEach(b=>b.disabled=b.dataset.conflict==='true');}}
export function renderChargeBatches(root,data,actions){
 root.replaceChildren();root.className='mt-4 text-break';root.append(el('h2','FND-F05 — публикуване A'),el('p',chargeLimit,'alert alert-info'));
 if(!data.scopes.length){root.append(el('p','Няма изрично разрешен финансов обхват за публикуване.'));return;}
 const scope=field(root,'charge_scope','Обхват за начисления',root.dataset.scope||data.scopes[0].id,data.scopes.map(s=>[s.id,s.label]));const body=el('div');root.append(body);
 function render(){const s=data.scopes.find(s=>s.id===scope.value);root.dataset.scope=s.id;body.replaceChildren();const batches=data.batches.filter(b=>b.scope_id===s.id);
  function editor(b=null){const form=el('form','','card card-body mb-3');form.dataset.chargeForm=b?.id||'new';form.append(el('h3',b?'Корекция на чернова':'Нова чернова за публикуване','h5'));
   const values=b?.claim||{},preview=field(form,'preview_id','Точен приет preview',values.preview_id||'',[['','Избери preview'],...data.previews.filter(p=>p.scope_id===s.id).map(p=>[p.id,`${p.date} · ${p.id}`])]);preview.required=true;
   const fields={};for(const[k,label]of Object.entries(chargeLabels)){fields[k]=field(form,k,label,values[k]||'');if(k==='liability_date')fields[k].type='date';}
   const correction=field(form,'replaces_batch_id','Коригира неплатен публикуван вариант',values.replaces_batch_id||'',[['','Ново първоначално публикуване'],...batches.filter(x=>x.status==='published'&&x.kind!=='reversal'&&!batches.some(y=>y.reverses_id===x.id)).map(x=>[x.id,x.id])]);correction.disabled=!s.can_correct;
   const note=field(form,'note','Причина за подготовката/корекцията');note.required=true;const error=errorNode(form);
   form.onsubmit=e=>{e.preventDefault();if(form.reportValidity())run(form,error,()=>actions.save(s.id,b?.id||null,b?.revision||0,crypto.randomUUID(),{preview_id:preview.value,...Object.fromEntries(Object.entries(fields).map(([k,n])=>[k,n.value])),replaces_batch_id:correction.value||null},note.value));};
   const save=el('button','Запази черновата','btn btn-primary');form.append(save);body.append(form);
  }
  for(const b of batches){const card=el('article','','card card-body mb-3');card.dataset.chargeBatch=b.id;card.append(el('h3',`${b.status==='draft'?'Чернова':b.kind==='reversal'?'Обратен запис':'Публикувано'} · редакция ${b.revision}`,'h5'),el('p',b.id,'small'),el('p',`R ${b.pool_amount} EUR · ${b.period_start}…${b.period_end}`),el('p',`Preview ${b.preview_id}`,'small'));
   if(b.status==='published'){card.append(el('p','Неизменим snapshot. Платецът е отделен от длъжника; няма записани плащания.'));
    for(const c of data.charges.filter(c=>c.batch_id===b.id)){const p=data.parties.find(p=>p.charge_id===c.id);card.append(el('p',`Обект ${c.unit_snapshot?.unit_number||c.unit_id} · ${c.amount} EUR · длъжник ${p?.person_snapshot.label||p?.person_id} · L ${p?.liability_date} · падеж ${c.due_date}`,'border rounded p-2'));}
   }else{
    const gaps=b.preparation_snapshot.gaps;for(const gap of gaps)card.append(el('p',chargeGap(gap),'text-danger'));card.append(el('p',b.review?`Прегледан за ${b.review.publication_day} · ${b.review.note}`:'Непрегледана лична отговорност.'));
    const error=errorNode(card),reviewArea=el('div');card.append(reviewArea);
    if(s.can_publish){button(card,'Зареди точните данни за личен преглед',()=>run(card,error,async()=>{const x=(await actions.load(s.id,b.claim)).inputs;reviewArea.replaceChildren();reviewArea.append(el('p',`M ${x.meeting_date} · L ${x.liability_date||'липсва'} · T ${x.publication_day} · D ${x.reference_date} · P ${x.due_date} · техническо покритие [${x.interval_from},${x.interval_to})`,'fw-bold'));
      for(const[k,label]of Object.entries(chargeLabels))reviewArea.append(el('p',`${label}: ${b.claim[k]||'липсва'}`));
      for(const gap of x.gaps)reviewArea.append(el('p',chargeGap(gap),'text-danger'));
      const inputs=x.parties.map(p=>{reviewArea.append(el('p',`Обект ${p.unit_number}: ${p.label} · ${p.amount} EUR · лице ${p.person_id} / ред. ${p.person_revision} · ownership ${p.ownership_id}`,'border-top pt-2'));const n=field(reviewArea,'party_evidence','Доказателство за самоличност и лична отговорност за този ред');n.required=true;return{p,n};});
      const motive=field(reviewArea,'review_note','Мотивиран преглед на основанието, L и точните длъжници');motive.required=true;
      if(!x.gaps.length){const review=button(reviewArea,'Потвърди прегледа на всички длъжници',()=>run(card,error,()=>actions.review(s.id,b.id,b.revision,crypto.randomUUID(),inputs.map(({p,n})=>({unit_id:p.unit_id,person_id:p.person_id,person_revision:p.person_revision,ownership_id:p.ownership_id,evidence_reference:n.value})),motive.value)));review.dataset.review='true';}
     }));
     if(b.review){const note=field(card,'publish_note','Причина за публикуването на целия batch');const pub=button(card,'Публикувай целия batch',()=>run(card,error,()=>actions.publish(s.id,b.id,b.revision,crypto.randomUUID(),note.value)));pub.dataset.publish='true';}
    }
    if(s.can_prepare&&(!b.replaces_id||s.can_correct))button(card,'Редактирай черновата',()=>editor(b));
   }
   const snapshot=el('details'),pre=el('pre',JSON.stringify(b.publication_snapshot||b.preparation_snapshot,null,2),'small');pre.style.whiteSpace='pre-wrap';pre.style.overflowWrap='anywhere';snapshot.append(el('summary','Версии и запазен snapshot'),pre);card.append(snapshot);body.append(card);
  }
  if(s.can_prepare)editor();
  const history=el('details');history.append(el('summary','Проследима история'));
  for(const h of data.history.filter(h=>batches.some(b=>b.id===h.target_id)))history.append(el('p',`${h.at} · ${h.action} · ${h.reason} · ${h.actor}`,'small'));body.append(history);
 }
 scope.onchange=render;render();
}
