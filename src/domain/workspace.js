// Presentation only. Server feeds and guards remain authoritative for every operation.
export function workspaceModel(account,admin,feeds,now=Date.now()){
  if(!account)return {signedIn:false,platform:false,organizations:[],contexts:[],name:''};
  const current=r=>Date.parse(r.valid_from)<=now&&(!r.valid_to||now<Date.parse(r.valid_to));
  const roles=account.profile.status==='active'?account.roles.filter(current).filter(r=>r.role_code==='platform_admin'||admin?.memberships?.some(m=>m.id===r.membership_id&&m.status==='active'&&current(m))):[];
  const contexts=new Map();
  function add(id,label,mode,capability,organization=''){
    const key=`${mode}:${id}`,c=contexts.get(key)||{key,id,label,mode,organization,registry:false,finance:false,tickets:false};
    c[capability]=true;if(organization)c.organization=organization;contexts.set(key,c);
  }
  for(const c of account.contexts)if(roles.some(r=>r.scope_id===c.scope_id&&r.permissions.includes('read_registry')))
    add(c.scope_id,c.scope_label,'staff','registry',c.organization_name);
  for(const feed of [feeds.drafts,feeds.preview,feeds.charges,feeds.payments,feeds.accounts,feeds.funds,feeds.expenses])for(const s of feed?.scopes||[]){
    const c=account.contexts.find(c=>c.scope_id===s.id),r=roles.find(r=>r.scope_id===s.id),membership=admin?.memberships?.find(m=>m.id===r?.membership_id),organization=account.organizations.find(o=>o.id===membership?.organization_id);
    add(s.id,s.label,'staff','finance',c?.organization_name||organization?.name);
  }
  for(const s of feeds.expenses?.scopes||[])add(s.id,s.label,'staff','expenses');
  for(const u of feeds.owned||[])add(u.scope_id,u.scope_label,'owner','tickets');
  // Fresh guarded discovery is authoritative even when there are no tickets or registry rights.
  for(const s of feeds.ticketContexts||[])add(s.scope_id,s.scope_label,'staff','tickets');
  return {signedIn:true,platform:Boolean(admin?.platform),ownerFinance:feeds.ownerFinance===true,organizations:admin?.adminOrganizations||[],name:account.profile.display_name,profileId:account.profile.id,contexts:[...contexts.values()]};
}
