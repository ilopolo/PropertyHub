// UI-only synthetic transport. Not PostgreSQL, RLS, legal or hosted acceptance evidence.
export const demoIds={profile:'d0000000-0000-4000-8000-000000000001',scope:'d0000000-0000-4000-8000-000000000002',other:'d0000000-0000-4000-8000-000000000003',org:'d0000000-0000-4000-8000-000000000004',member:'d0000000-0000-4000-8000-000000000005',unit:'d0000000-0000-4000-8000-000000000006',rule:'d0000000-0000-4000-8000-000000000007',shares:'d0000000-0000-4000-8000-000000000008'};
export function demoUiFixture(role){
 const d=demoIds,permissions=role==='platform'?['manage_platform']:role==='org-admin'?['manage_members']:role==='staff'?['read_registry','manage_registry','manage_tickets','read_rules','prepare_rules','publish_rules','prepare_charges','publish_charges']:role==='cashier'?['read_rules','prepare_rules','prepare_charges','publish_charges']:[];
 const financial=['staff','cashier'].includes(role),labels=['Демо сграда — вход А','Демо сграда — вход Б'];
 const scopes=financial?[d.scope,d.other].map((id,i)=>({id,label:labels[i],can_prepare:true,can_review:role==='staff',can_publish:true,can_correct:false})):[];
 const roles=permissions.length?[{id:d.profile,role_code:role==='platform'?'platform_admin':role==='org-admin'?'org_admin':role==='cashier'?'cashier':'manager',membership_id:role==='platform'?null:d.member,scope_id:['platform','org-admin'].includes(role)?null:d.scope,permissions,valid_from:'2020-01-01T00:00:00Z',valid_to:null}]:[];
 if(role==='staff')roles.push({...roles[0],scope_id:d.other});
 const contexts=role==='staff'?[d.scope,d.other].map((scope_id,i)=>({organization_id:d.org,organization_name:'Демо общност',scope_id,scope_label:labels[i],can_manage_members:false,can_manage_registry:true})):[];
 const profile={id:d.profile,display_name:'Синтетичен преглед',status:'active',theme:'light'};
 const owned=role==='owner'?[{scope_id:d.scope,scope_label:labels[0],unit_id:d.unit,unit_number:'1'}]:[];
 const members=financial||role==='org-admin'?[{id:d.member,organization_id:d.org,status:'active',valid_from:'2020-01-01T00:00:00Z',valid_to:null}]:[];
 const organizations=financial||role==='org-admin'?[{id:d.org,name:'Демо общност',status:'active',organization_kind:'self_managed'}]:[];
 const drafts={scopes,catalog:[{id:'f0100000-0000-4000-8000-000000000002',label_bg:'Целево набиране за ремонт',version:1}],resolutions:[],rules:[],history:[]};
 const preview={scopes,rules:financial?[{id:d.rule,scope_id:d.scope,label:'Ремонт на демо вход',valid_from:'2026-01-01',valid_to:null}]:[],shares:financial?[{id:d.shares,scope_id:d.scope,revision:1,label:'Общи части на демо сградата'}]:[],previews:[]};
 const charges={scopes,previews:[],batches:[],charges:[],parties:[],history:[]};
 return {role,profile,roles,contexts,owned,members,organizations,drafts,preview,charges,requests:[],fail:null,delay:false,revoked:false};
}
