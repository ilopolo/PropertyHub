import {ticketFilesBg as t} from '../i18n/ticket-files-bg.js';
const el=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=text||'';if(cls)e.className=cls;return e;};
export function renderTicketFiles(root,data,actions){
 root.replaceChildren();root.append(el('h3',t.title,'h5'),el('p',t.hint,'small'));
 if(!data){root.append(el('p',t.unavailable,'text-danger'));return;}
 const status=el('p','','small');status.setAttribute('role','status');root.append(status);
 const run=async(button,action)=>{button.disabled=true;try{await action();}catch(e){const current=root.querySelector('[role=status]');if(current)current.textContent=e?.name==='TicketFileError'?e.message:t.failed;}finally{button.disabled=false;}};
 if(data.can_upload){
  const form=el('form','','mt-2'),label=el('label','Файл','form-label'),input=el('input','','form-control mb-2'),button=el('button',t.upload,'btn btn-secondary');
  input.type='file';input.accept='.png,.jpg,.jpeg,.pdf';input.required=true;input.id=`attachment-${root.dataset.item}`;label.htmlFor=input.id;
  form.append(label,input,button);form.addEventListener('submit',event=>{event.preventDefault();if(form.reportValidity())run(button,()=>actions.upload(input.files[0]));});root.append(form);
 }
 for(const d of data.files){
  const row=el('div','','border rounded p-3 mt-3 text-break');row.dataset.attachment=d.id;
  row.append(el('p',d.original_filename,'fw-bold'),el('p',t[d.status],'small'));
  if(d.status==='removed')row.append(el('p',`Причина: ${d.removal_note}`,'small'));
  if(d.status==='ready'){const button=el('button',t.download,'btn btn-secondary me-2 mb-2');button.type='button';button.addEventListener('click',()=>run(button,()=>actions.download(d)));row.append(button);}
  if(d.can_remove&&!d.bytes_deleted_at){
   const form=el('form','','mt-2'),label=el('label',t.reason,'form-label'),note=el('input','','form-control mb-2'),button=el('button',d.status==='pending'?t.cancel:d.status==='removed'?t.retry:t.remove,'btn btn-outline-danger');
   note.id=`attachment-reason-${d.id}`;label.htmlFor=note.id;note.required=true;note.maxLength=300;form.append(label,note,button);
   form.addEventListener('submit',event=>{event.preventDefault();if(form.reportValidity())run(button,()=>actions.remove(d,note.value.trim()));});row.append(form);
  }
  root.append(row);
 }
 const refresh=el('button',t.refresh,'btn btn-link px-0 mt-2');refresh.type='button';refresh.addEventListener('click',()=>run(refresh,actions.refresh));root.append(refresh);
}
