import { listPersons, savePerson, verifyPerson } from '../services/persons.js';
import { personForm, personRow } from '../ui/persons.js';
import { readProvenance } from '../ui/provenance.js';
import { bindForm, message } from '../ui/forms.js';
import { authError } from '../i18n/auth-bg.js';
let generation=0;
export async function showPersons(scope,canManage,showCurrent) {
  const version=++generation;
  const section=document.querySelector('#persons');section.hidden=!showCurrent;
  if(!showCurrent) return;
  const list=document.querySelector('#person-list');list.textContent='Зареждане…';
  const editor=document.querySelector('#person-editor');editor.replaceChildren();editor.hidden=true;
  const persons=await listPersons(scope);
  if(version!==generation)return;
  list.replaceChildren();
  if(!persons.length)list.textContent='Няма записани лица в този разрешен обхват.';
  let editing=null;
  const refresh=()=>showPersons(scope,canManage,true);
  const edit=person=>{
    editing=person;
    const form=editor.querySelector('form');form.reset();
    for(const name of ['person_kind','display_name','contact_email','contact_phone','status'])form.elements.namedItem(name).value=person[name] || '';
    // A fresh full-record source assertion is required; never silently borrow prior evidence.
    editor.querySelector('#person-editor-title').textContent=`Редакция на ревизия ${person.revision}`;
    editor.scrollIntoView({behavior:'smooth',block:'start'});form.elements.namedItem('display_name').focus({preventScroll:true});
  };
  for(const person of persons) list.append(personRow(person,canManage,edit,async(p,note)=>{
    try{await verifyPerson(scope,p,note);if(version===generation){await refresh();message('Проверката е записана. Тя не предоставя собственост или достъп на акаунт.');}}
    catch(error){message(authError(error),true);}
  }));
  if(!canManage)return;
  editor.innerHTML=personForm();editor.hidden=false;
  editor.querySelector('#person-cancel').addEventListener('click',()=>{editing=null;editor.querySelector('form').reset();editor.querySelector('#person-editor-title').textContent='Добави лице';});
  bindForm('#person-save',async(data,form)=>{
    const fields=Object.fromEntries(['person_kind','display_name','contact_email','contact_phone','status'].map(name=>[name,String(data.get(name)||'').trim()]));
    await savePerson(scope,editing,fields,readProvenance(data));
    form.reset();
    if(version===generation){await refresh();message('Лицето е записано и очаква отделна проверка. Няма създаден собственически достъп.');}
  });
}
