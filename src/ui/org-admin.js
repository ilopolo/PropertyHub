import {humanText} from './public-text.js';
import {dateTime} from './provenance.js';
const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
export function orgAdminState(root,state,text){root.dataset.state=state;root.replaceChildren(el('h2','Организационни администратори','h4'),el('p',text));}
export function renderOrgAdmins(root,data,{reload,submit}){
 orgAdminState(root,'ready','Променяш само администраторския достъп в избраната организация. Служебните права върху регистър и финанси се назначават отделно.');
 const refresh=el('button','Обнови назначенията','btn btn-outline-secondary mb-3');refresh.type='button';refresh.id='org-admin-refresh';refresh.onclick=reload;root.append(refresh);
 const list=el('div','','d-grid gap-2 mb-3');list.id='org-admin-grants';
 for(const g of data.grants){const n=el('p',`${humanText(g.label)}${g.self?' · твоето назначение':''} · ${g.current?'действащо':'приключило / извън текущ период'} · от ${dateTime(g.valid_from)} · ${g.valid_to?'до '+dateTime(g.valid_to):'безсрочно'}`,'border rounded p-2 mb-0');list.append(n);}root.append(list);
 const form=document.createElement('form');form.id='org-admin-change';form.className='card card-body';
 const fields={};function field(tag,name,label){const id='org-admin-'+name,l=el('label',label,'form-label'),n=el(tag,'',tag==='select'?'form-select mb-3':'form-control mb-3');l.htmlFor=id;n.id=id;n.name=name;fields[name]=n;form.append(l,n);return n;}
 const option=(s,v,t)=>{const o=el('option',humanText(t));o.value=v;s.append(o);};
 const action=field('select','operation','Действие');action.required=true;option(action,'','Избери изрично');for(const[v,t]of[['grant','Ново назначение'],['end','Прекратяване'],['handover','Атомарно предаване']])option(action,v,t);
 const old=field('select','role','Точно действащо назначение за прекратяване');option(old,'','Избери назначение');data.grants.filter(g=>g.current).forEach(g=>option(old,g.id,g.label+(g.self?' · твоето назначение':'')));
 const member=field('select','member','Нов администратор — проверен член');option(member,'','Избери член');data.members.filter(m=>!data.grants.some(g=>g.current&&g.membership_id===m.id)).forEach(m=>option(member,m.id,m.label));
 const term=field('select','term','Валидност на новото назначение');option(term,'','Избери изрично');option(term,'permanent','Безсрочно');option(term,'finite','С изричен краен срок');
 const ends=field('input','ends','Край на срока с часова зона');ends.type='text';ends.placeholder='2026-12-01T18:00:00+02:00';ends.maxLength=35;
 form.append(el('p','При срок трябва да остане друг действащ администратор с безсрочни назначение и членство. Предаването записва новото назначение и прекратява старото заедно. При отказ нищо не се променя.','small'));
 const reason=field('textarea','reason','Причина и основание');reason.required=true;reason.maxLength=300;reason.rows=3;form.append(el('p','Например: проверено решение за смяна на представителя, дата и референция. Не въвеждай пароли или ненужни лични данни.','small'));
 const label=el('label','','form-check mb-3'),accept=el('input','','form-check-input me-2');accept.type='checkbox';accept.id='org-admin-confirm';accept.required=true;label.append(accept,el('span','Проверих получателя и разбирам коя промяна потвърждавам.'));form.append(label);
 const status=el('p','','small');status.id='org-admin-result';status.setAttribute('role','status');status.setAttribute('aria-live','polite');form.append(status);
 const button=el('button','Потвърди промяната','btn btn-success align-self-start');button.type='submit';button.id='org-admin-submit';form.append(button);root.append(form);
 function configure(){old.disabled=!['end','handover'].includes(action.value);old.required=!old.disabled;member.disabled=!['grant','handover'].includes(action.value);member.required=!member.disabled;term.disabled=member.disabled;term.required=!term.disabled;ends.disabled=term.disabled||term.value!=='finite';ends.required=!ends.disabled;}
 action.onchange=configure;term.onchange=configure;configure();
 form.onsubmit=event=>{event.preventDefault();if(form.reportValidity())submit({operation:action.value,role:old.disabled?null:old.value,member:member.disabled?null:member.value,ends:ends.disabled?null:ends.value,reason:reason.value},form,status,configure);};
 const details=el('details','','mt-3'),summary=el('summary','История на промените');details.append(summary);
 if(!data.history.length)details.append(el('p','Няма записани промени през този процес.'));
 for(const h of data.history){const label={grant:'Ново назначение',end:'Прекратяване',handover:'Предаване'}[h.change.operation]||'Промяна',people=[h.change.from_label?'От: '+humanText(h.change.from_label):'',h.change.to_label?'Към: '+humanText(h.change.to_label):'',h.change.actor_label?'Записал: '+humanText(h.change.actor_label):''].filter(Boolean).join(' · ');details.append(el('p',`${dateTime(h.at)} · ${label} · ${people} · ${humanText(h.reason)}`));}root.append(details);
}
