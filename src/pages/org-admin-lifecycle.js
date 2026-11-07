import {orgAdminDirectory,changeOrgAdmin} from '../services/org-admin.js';
import {renderOrgAdmins,orgAdminState} from '../ui/org-admin.js';
import {orgAdminError} from '../i18n/org-admin-bg.js';
import {sessionRevision,sameSession} from '../services/supabase.js';
let generation=0;
export async function refreshOrgAdmins(org){
 const root=document.querySelector('#org-admin-lifecycle');if(!root)return;
 const version=sessionRevision(),request=++generation,current=()=>sameSession(version)&&generation===request;
 orgAdminState(root,'loading','Зареждане на текущите администраторски назначения…');
 try{
  const data=await orgAdminDirectory(org);if(!current())return;let pending;
  renderOrgAdmins(root,data,{reload:()=>refreshOrgAdmins(org),submit:async(values,form,status,configure)=>{
   const signature=JSON.stringify(values);if(!pending||pending.signature!==signature)pending={signature,key:crypto.randomUUID()};
   const input={...values,org,revision:data.revision,key:pending.key};let accessLost=false;const buttons=[...form.querySelectorAll('button,input,select,textarea')];buttons.forEach(n=>n.disabled=true);root.querySelector('#org-admin-refresh').disabled=true;status.textContent='Записва се…';
   try{const result=await changeOrgAdmin(input);if(!current())return;pending=null;
    const selfEnd=data.grants.some(g=>g.id===result.ended_role_id&&g.self);
    if(selfEnd){root.replaceChildren();location.replace(import.meta.env.BASE_URL+'pages/account.html');return;}
    await refreshOrgAdmins(org);const notice=root.querySelector('#org-admin-result');if(notice)notice.textContent='Промяната е потвърдена. Историята е запазена.';
   }catch(e){if(!current()||e.code==='SESSION_CHANGED')return;accessLost=e.code==='42501';status.textContent=orgAdminError(e)+' При прекъсната връзка обнови назначенията и провери историята преди нова промяна.';root.dataset.state=accessLost?'no-access':'error';
   }finally{if(form.isConnected&&current()){root.querySelector('#org-admin-refresh').disabled=false;if(!accessLost){buttons.forEach(n=>n.disabled=false);configure();}}}
  }});
 }catch(e){if(!current()||e.code==='SESSION_CHANGED')return;orgAdminState(root,e.code==='42501'?'no-access':'error',orgAdminError(e));const retry=document.createElement('button');retry.type='button';retry.className='btn btn-outline-secondary';retry.textContent='Провери отново';retry.onclick=()=>refreshOrgAdmins(org);root.append(retry);}
}
