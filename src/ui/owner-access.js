import {ownerAccessBg as bg} from '../i18n/owner-access-bg.js';
import {dateTime} from './provenance.js';
export function ownedUnitsList(root,units){
 root.replaceChildren();
 if(!units.length){const p=document.createElement('li');p.className='list-group-item text-break';p.textContent=bg.empty;root.append(p);return;}
 for(const unit of units){const li=document.createElement('li');li.className='list-group-item text-break';li.textContent=`${unit.building_label}${unit.entrance_code?' · Вход '+unit.entrance_code:''} · ${unit.unit_number} · ${({apartment:'Апартамент',office:'Офис',shop:'Магазин',garage:'Гараж',other:'Друг обект'})[unit.unit_type]||'Обект'} · ${unit.scope_label} · Имот: ${unit.unit_id}`;root.append(li);}
}
export function ownerVerificationForm(){return `<h2 class="h4">${bg.verificationTitle}</h2><p>${bg.verificationLimits}</p><form id="confirm-owner-link"><label for="owner-target" class="form-label">Точен Auth UUID на потвърдения акаунт</label><input id="owner-target" name="target" class="form-control mb-3" required pattern="[0-9a-fA-F-]{36}" autocomplete="off"><label for="owner-person" class="form-label">Проверено лице в този обхват</label><select id="owner-person" name="person" class="form-select mb-3" required></select><label for="owner-evidence" class="form-label">Референция към провереното доказателство</label><input id="owner-evidence" name="evidence" class="form-control mb-3" required maxlength="200"><label for="owner-note" class="form-label">Основание за потвърждението</label><input id="owner-note" name="note" class="form-control mb-3" required maxlength="300"><p class="small">Без излишни лични данни. Връзката не създава собственост или служебно назначение.</p><button class="btn btn-success">Потвърди проверената връзка</button></form><h3 class="h5 mt-4">Проверки и оттегляния</h3><div id="owner-links" class="d-grid gap-3"></div>`;}
export function ownerLinkRecord(link,onRevoke){
 const article=document.createElement('article');article.className='border rounded p-3 text-break';article.dataset.ownerLink=link.id;
 const p=document.createElement('p');p.textContent=`${link.person_label} · Профил: ${link.profile_id} · ${link.revoked_at?'Оттеглена':'Потвърдена'} · ${dateTime(link.verified_at)} · Проверяващ: ${link.verified_by} · ${link.evidence_reference} · ${link.verification_note}`;article.append(p);
 if(link.revoked_at){const history=document.createElement('p');history.textContent=`Оттегляне: ${dateTime(link.revoked_at)} · ${link.revoked_by} · ${link.revocation_note} · ${link.revocation_evidence}`;article.append(history);}
 else{
  const form=document.createElement('form');
  for(const [name,label,max]of [['evidence','Доказателство за оттеглянето',200],['note','Основание за оттеглянето',300]]){const input=document.createElement('input');input.id=`revoke-${link.id}-${name}`;input.name=name;input.required=true;input.maxLength=max;input.className='form-control mb-3';const text=document.createElement('label');text.htmlFor=input.id;text.className='form-label';text.textContent=label;form.append(text,input);}
  const button=document.createElement('button');button.className='btn btn-outline-danger';button.textContent='Оттегли тази връзка';form.append(button);form.addEventListener('submit',async e=>{e.preventDefault();button.disabled=true;try{await onRevoke(form.elements.evidence.value.trim(),form.elements.note.value.trim());}finally{button.disabled=false;}});article.append(form);
 }
 return article;
}
