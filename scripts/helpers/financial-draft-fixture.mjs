import{unitFileFixture}from'./unit-file-fixture.mjs';
export const financialCategoryId='f0100000-0000-4000-8000-000000000001';
export const resolutionPayload=()=>({title:'Синтетично решение за ремонт',reference:'QA протокол / точка 1',meeting_date:'2026-10-01',effective_from:'2026-10-01',effective_to:'2027-01-01',source_kind:'document',source_reference:'Synthetic protocol reference',known_from:'2026-10-02'});
export const rulePayload=basis=>({category_id:financialCategoryId,resolution_id:basis,method:'ideal_shares',mode:'POOL',config:{currency:'EUR',denominator:'building_common_parts',participants:'all_building_units'},valid_from:'2026-11-01',valid_to:'2026-12-01'});
export async function financialDraftFixture(){const f=await unitFileFixture();try{
 for(const who of['A','B']){const old=(await f.as(who,"select id from public.user_roles where scope_id=$1 and role_code='manager' and valid_to is null",[f.scope[who]])).rows[0].id;await f.as('org'+who,'select public.revoke_staff_role($1)',[old]);await f.as('org'+who,"select public.assign_staff_role($1,$2,$3,'manager',array['prepare_rules'])",[f.org[who],f.auth[who],f.scope[who]]);}
 f.readerRole=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'controller',array['read_rules']) id",[f.org.A,f.auth.owner,f.scope.A])).rows[0].id;
 f.cashierRole=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'cashier',array['prepare_rules']) id",[f.org.A,f.auth.doc,f.scope.A])).rows[0].id;
 return f;}catch(e){await f.db.close();throw e;}}
