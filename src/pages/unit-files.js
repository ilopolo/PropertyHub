import {unitDocuments,uploadUnitFile,downloadUnitFile,removeUnitFile} from '../services/unit-files.js';
import {fileSection,uploadForm,fileRow} from '../ui/unit-files.js';
import {unitFilesBg as bg} from '../i18n/unit-files-bg.js';
import {message} from '../ui/forms.js';
import {authError} from '../i18n/auth-bg.js';
import {UnitFileError} from '../domain/unit-file.js';
const fileError=error=>error instanceof UnitFileError?error.message:authError(error);
export function canManageFiles(account,scope) {
 const now=Date.now();
 return account.roles.some(r=>r.scope_id===scope && r.role_code==='manager' && r.permissions.includes('manage_documents') && r.permissions.includes('read_registry') && Date.parse(r.valid_from)<=now && (!r.valid_to||now<Date.parse(r.valid_to)));
}
export async function showUnitFiles(parent,scope,unit,canManage=false) {
 const root=fileSection(); root.dataset.unitFiles=unit; parent.append(root); let revision=0;
 const content=document.createElement('div'); root.append(content);
 async function refresh() {
  const current=++revision; content.replaceChildren(); root.dataset.ready='false';
  try {
   const rows=await unitDocuments(scope,unit); if(current!==revision||!root.isConnected)return;
   const active=rows.some(d=>d.status!=='removed');
   if(canManage&&!active) {
    const form=uploadForm(unit); content.append(form);
    form.addEventListener('submit',async event=>{event.preventDefault(); if(!form.reportValidity())return; const button=form.querySelector('button'); button.disabled=true;
     try{await uploadUnitFile(scope,unit,form.elements.file.files[0],form.elements.audience.value); message(bg.uploaded);}
     catch(error){message(fileError(error),true);} finally{button.disabled=false; await refresh();}
    });
   }
   for(const d of rows.filter(d=>!d.bytes_deleted_at)) content.append(fileRow(d,canManage, async button=>{
    button.disabled=true;
    try{const blob=await downloadUnitFile(d); if(!root.isConnected)return; const url=URL.createObjectURL(blob),a=document.createElement('a'); a.href=url; a.download=d.original_filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);}
    catch(error){message(fileError(error),true); await refresh();} finally{button.disabled=false;}
   },async(note,button)=>{button.disabled=true;try{await removeUnitFile(d,note);message(bg.deleted);}catch(error){message(fileError(error),true);}finally{button.disabled=false;await refresh();}}));
   if(!rows.some(d=>!d.bytes_deleted_at)) {const p=document.createElement('p');p.textContent=bg.empty;content.append(p);}
   root.dataset.ready='true';
  } catch(error) {if(current===revision){root.dataset.ready='error'; const p=document.createElement('p');p.textContent='Файловете не са заредени. Обнови прегледа, за да провериш текущия достъп.';content.append(p);message(authError(error),true);}}
 }
 await refresh();
}
