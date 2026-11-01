import {unitFilesBg as bg} from '../i18n/unit-files-bg.js';
export function fileSection() {
 const root = document.createElement('section'); root.className='border rounded p-3 mt-3 text-break';
 const title=document.createElement('h3'); title.className='h5'; title.textContent=bg.title;
 const info=document.createElement('p'); info.className='small'; info.textContent=bg.limits;
 root.append(title,info); return root;
}
export function uploadForm(id) {
 const form=document.createElement('form'); form.className='mb-3';
 form.innerHTML=`<label class="form-label" for="file-${id}">PDF файл · до 5 MiB</label><input id="file-${id}" name="file" type="file" accept="application/pdf,.pdf" required class="form-control mb-3"><label class="form-label" for="audience-${id}">Достъп до този файл</label><select id="audience-${id}" name="audience" class="form-select mb-3"><option value="staff">Само упълномощени служители</option><option value="owners">И текущи проверени собственици на този имот</option></select><p class="small">Не качвай излишни лични данни. Няма антивирусна проверка или визуализация на PDF.</p><button class="btn btn-success">Качи private файл</button>`;
 return form;
}
export function fileRow(file, canManage, onDownload, onRemove) {
 const root=document.createElement('article'); root.className='border-top py-3'; root.dataset.documentId=file.id;
 const label=document.createElement('p'); label.textContent=`${file.original_filename} · ${Number(file.size_bytes).toLocaleString('bg-BG')} bytes · ${bg.states[file.status]} · ${file.visibility==='owners'?'Разрешен и за текущи собственици':'Само служители'}`; root.append(label);
 if(file.status==='ready') {const button=document.createElement('button'); button.className='btn btn-outline-primary mb-2'; button.textContent='Свали PDF'; button.addEventListener('click',()=>onDownload(button)); root.append(button);}
 if(canManage && !file.bytes_deleted_at) {
  const note=document.createElement('p'); note.className='small'; note.textContent=file.status==='pending'?bg.pending:file.status==='removed'?bg.removed:'Премахването спира достъпа веднага. Историята остава.';
  const form=document.createElement('form');
  const input=document.createElement('input'); input.name='note'; input.id=`remove-${file.id}`; input.required=true; input.maxLength=300; input.className='form-control mb-2';
  const text=document.createElement('label'); text.className='form-label'; text.htmlFor=input.id; text.textContent='Основание за премахване / довършване';
  const button=document.createElement('button'); button.className='btn btn-outline-danger'; button.textContent=file.status==='removed'?'Довърши изтриването':'Премахни / отмени';
  form.append(text,input,button); form.addEventListener('submit',event=>{event.preventDefault(); if(form.reportValidity())onRemove(input.value.trim(),button);}); root.append(note,form);
 }
 return root;
}
