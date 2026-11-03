// A preference only; intersect it with the fresh options from each server feed.
let scope=null;
export const getWorkspaceScope=()=>scope;
export function setWorkspaceScope(id){scope=id;window.dispatchEvent(new CustomEvent('workspace-scope',{detail:id}));}
export function bindWorkspaceScope(select,render){
  const apply=id=>{
    if(!id)return;
    const matches=[...select.options].some(o=>o.value===id);
    if(!matches&&!select.querySelector('[data-unavailable]')){
      const option=document.createElement('option');option.value='';option.textContent='Няма достъп тук за избрания контекст';option.dataset.unavailable='true';select.prepend(option);
    }
    select.value=matches?id:'';render();
  };
  if(scope)apply(scope);else render();
  const handler=e=>{if(select.isConnected)apply(e.detail);else window.removeEventListener('workspace-scope',handler);};
  window.addEventListener('workspace-scope',handler);
  select.addEventListener('change',()=>{if(select.value)setWorkspaceScope(select.value);else render();});
}
