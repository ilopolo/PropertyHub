import { provenanceFields, dateTime } from './provenance.js';
// All interpolated prefixes are internal constants. Values always use textContent/value.
export function personForm() {
  return `<h3 class="h5" id="person-editor-title">Добави лице</h3>
  <form id="person-save" class="row g-3">
  <div class="col-sm-6"><label for="person-kind" class="form-label">Вид лице</label><select id="person-kind" name="person_kind" class="form-select"><option value="physical">Физическо лице</option><option value="legal">Юридическо лице</option></select></div>
  <div class="col-sm-6"><label for="person-name" class="form-label">Име / наименование</label><input id="person-name" name="display_name" class="form-control" required maxlength="160"></div>
  <div class="col-sm-6"><label for="person-email" class="form-label">Имейл (по желание)</label><input id="person-email" name="contact_email" type="email" class="form-control" maxlength="254"></div>
  <div class="col-sm-6"><label for="person-phone" class="form-label">Телефон (по желание)</label><input id="person-phone" name="contact_phone" type="tel" class="form-control" maxlength="40"></div>
  <div class="col-sm-6"><label for="person-status" class="form-label">Статус на записа</label><select id="person-status" name="status" class="form-select"><option value="active">Активен</option><option value="inactive">Неактивен</option></select></div>
  <div class="col-12">${provenanceFields('person')}</div>
  <div class="col-12"><div class="form-check"><input id="person-packet" name="packet" type="checkbox" class="form-check-input" required><label for="person-packet" class="form-check-label">Посоченият източник обосновава всички попълнени стойности. Празните контакти са неизвестни; при редакция заменям целия набор и е нужна нова проверка.</label></div></div>
  <div class="col-12 d-flex gap-2 flex-wrap"><button class="btn btn-success">Запиши лицето</button><button id="person-cancel" type="button" class="btn btn-outline-secondary">Ново лице / откажи редакцията</button></div></form>`;
}
export function personRow(person,canManage,onEdit,onVerify) {
  const li=document.createElement('li');li.className='list-group-item text-break';li.dataset.personId=person.id;
  const title=document.createElement('h3');title.className='h6';title.textContent=`${person.display_name} · ${person.person_kind==='physical'?'Физическо':'Юридическо'} лице`;
  const text=document.createElement('p');text.textContent=`${person.status==='active'?'Активен':'Неактивен'} запис · ${person.contact_email || 'имейл неизвестен'} · ${person.contact_phone || 'телефон неизвестен'}`;
  const source=document.createElement('p');source.className='small';source.textContent=`Ревизия ${person.revision} · ${person.verification_status==='verified'?'Проверени въведени стойности':'Нужен преглед'} · ${person.source_kind==='document'?'Документ':'Декларирани сведения'}: ${person.source_reference} · Известно от ${person.known_from} · Записано ${dateTime(person.recorded_at)}${person.verified_at?` · Проверено ${dateTime(person.verified_at)}: ${person.verification_note}`:''}`;
  li.append(title,text,source);
  if(canManage){
    const edit=document.createElement('button');edit.type='button';edit.className='btn btn-outline-secondary mb-3';edit.textContent='Редактирай целия запис';edit.addEventListener('click',()=>onEdit(person));li.append(edit);
    if(person.verification_status!=='verified'){
      const form=document.createElement('form');form.className='mb-3';
      const label=document.createElement('label');label.htmlFor=`person-note-${person.id}`;label.className='form-label';label.textContent='Основание за отделната проверка';
      const input=document.createElement('input');input.id=label.htmlFor;input.name='note';input.className='form-control mb-2';input.required=true;input.maxLength=300;
      const submit=document.createElement('button');submit.className='btn btn-outline-secondary';submit.textContent='Запиши проверката';form.append(label,input,submit);
      form.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;try{await onVerify(person,input.value.trim());}finally{submit.disabled=false;}});li.append(form);
    }
  }
  return li;
}
