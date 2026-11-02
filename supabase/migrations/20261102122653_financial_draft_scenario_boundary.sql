-- Narrow draft-only scenario after explicit FND-F05 product decision. No activation.
-- Version1 and legacy records remain immutable/readable; no backfill or reinterpretation.
insert into public.financial_categories(id,code,version,label_bg,direction,method,mode,legal_source,legal_reference,legal_version,checked_on,legal_status,change_note,supersedes_id)
select 'f0100000-0000-4000-8000-000000000002',code,2,'FND-F05: целево набиране за недостиг при планиран ремонт',direction,method,mode,legal_source,
 'ЗУЕС, чл. 48, ал. 1 и 3; чл. 11, 15–17 и 50 се проверяват за конкретното основание',legal_version,date '2026-11-02','text_checked',
 'Narrow to planned-repair targeted shortfall only. Funding choice is not legal validation; four distinct funding figures, work classification, approval and records need verification.',id
from public.financial_categories where id='f0100000-0000-4000-8000-000000000001';
alter table public.resolutions drop constraint resolutions_resolution_type_check;
alter table public.resolutions add constraint resolutions_resolution_type_check check(resolution_type in('general_assembly_repair','planned_repair_shortfall')),
 add constraint fnd05_basis_document_check check(resolution_type<>'planned_repair_shortfall' or source_kind='document');
alter table public.allocation_rule_versions drop constraint allocation_rule_versions_config_check;
alter table public.allocation_rule_versions add constraint allocation_rule_versions_config_check check(
 (category_id='f0100000-0000-4000-8000-000000000001' and config='{"currency":"EUR","denominator":"building_common_parts","participants":"all_building_units"}'::jsonb)
 or(category_id='f0100000-0000-4000-8000-000000000002' and config='{"currency":"EUR","denominator":"building_common_parts","participants":"all_building_units","scenario":"FND-F05","funding_source":"targeted_shortfall"}'::jsonb and valid_to is not null));
create or replace function private.save_financial_resolution(scope uuid,target uuid,expected_revision integer,payload jsonb,note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare old public.resolutions; fresh public.resolutions; data jsonb; result uuid;
begin
 if not private.has_scope_permission(scope,'prepare_rules') then raise exception 'Financial preparation forbidden' using errcode='42501'; end if;

 if not exists(select 1 from public.management_units s where s.id=scope and s.mode='building') then raise exception 'FND-F05 requires a whole-building scope' using errcode='23514'; end if;
 perform private.validate_financial_payload(payload,array['title','reference','meeting_date','effective_from','effective_to','source_kind','source_reference','known_from'],note);
 if exists(select 1 from unnest(array['title','reference','meeting_date','effective_from','source_kind','source_reference','known_from']) k where jsonb_typeof(payload->k) is distinct from 'string')
 or (payload->'effective_to' is not null and payload->'effective_to'<>'null'::jsonb and jsonb_typeof(payload->'effective_to')<>'string')
 then raise exception 'Draft values must be explicit text/dates' using errcode='23514'; end if;
 if target is null then
  if expected_revision is distinct from 0 then raise exception 'Resolution changed; reload' using errcode='PT409'; end if;
 else
  select * into old from public.resolutions r where r.scope_id=scope and r.id=target for update;
  if not found then raise exception 'Resolution unavailable' using errcode='42501'; end if;
  if old.revision is distinct from expected_revision then raise exception 'Resolution changed; reload' using errcode='PT409'; end if;
 end if;
 if payload->>'source_kind' is distinct from 'document' then raise exception 'FND-F05 requires a document reference; it still needs verification' using errcode='23514'; end if;
 if target is not null and old.resolution_type<>'planned_repair_shortfall' then raise exception 'Legacy basis is historical; create a separate FND-F05 basis' using errcode='23514'; end if;
 if payload->>'meeting_date' !~ '^\d{4}-\d{2}-\d{2}$' or payload->>'effective_from' !~ '^\d{4}-\d{2}-\d{2}$'
 or payload->>'known_from' !~ '^\d{4}-\d{2}-\d{2}$' or (payload->>'effective_to' is not null and payload->>'effective_to' !~ '^\d{4}-\d{2}-\d{2}$')
 or (payload->>'known_from')::date>current_date or (payload->>'meeting_date')::date>current_date
 then raise exception 'Invalid resolution dates' using errcode='23514'; end if;
 result:=coalesce(target,gen_random_uuid());
 insert into public.resolutions(id,scope_id,resolution_type,title,reference,meeting_date,effective_from,effective_to,source_kind,source_reference,known_from,recorded_by,modified_by)
 values(result,scope,'planned_repair_shortfall',btrim(payload->>'title'),btrim(payload->>'reference'),(payload->>'meeting_date')::date,(payload->>'effective_from')::date,(payload->>'effective_to')::date,
 payload->>'source_kind',btrim(payload->>'source_reference'),(payload->>'known_from')::date,private.actor(),private.actor())
 on conflict(id) do update set title=excluded.title,reference=excluded.reference,meeting_date=excluded.meeting_date,effective_from=excluded.effective_from,
 effective_to=excluded.effective_to,source_kind=excluded.source_kind,source_reference=excluded.source_reference,known_from=excluded.known_from,
 revision=resolutions.revision+1,modified_by=private.actor(),modified_at=clock_timestamp() returning * into fresh;
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta)
 values(scope,private.actor(),'save_financial_resolution','resolution',result,btrim(note),jsonb_build_object('before',case when target is null then null else to_jsonb(old) end,'after',to_jsonb(fresh)));
 return result;
end $$;
create or replace function private.save_financial_rule(scope uuid,target uuid,expected_revision integer,payload jsonb,note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare old public.allocation_rule_versions; fresh public.allocation_rule_versions; basis public.resolutions; cat public.financial_categories;
 result uuid; starts date; ends date; building uuid;
begin
 if not private.has_scope_permission(scope,'prepare_rules') then raise exception 'Financial preparation forbidden' using errcode='42501'; end if;

 if not exists(select 1 from public.management_units s where s.id=scope and s.mode='building') then raise exception 'FND-F05 requires a whole-building scope' using errcode='23514'; end if;
 perform private.validate_financial_payload(payload,array['category_id','resolution_id','method','mode','config','valid_from','valid_to'],note);
 if exists(select 1 from unnest(array['category_id','resolution_id','method','mode','valid_from']) k where jsonb_typeof(payload->k) is distinct from 'string')
 or (payload->'valid_to' is not null and payload->'valid_to'<>'null'::jsonb and jsonb_typeof(payload->'valid_to')<>'string')
 then raise exception 'Invalid rule values' using errcode='23514'; end if;
 if target is null then
  if expected_revision is distinct from 0 then raise exception 'Rule changed; reload' using errcode='PT409'; end if;
 else
  select * into old from public.allocation_rule_versions r where r.scope_id=scope and r.id=target for update;
  if not found then raise exception 'Rule unavailable' using errcode='42501'; end if;
  if old.revision is distinct from expected_revision then raise exception 'Rule changed; reload' using errcode='PT409'; end if;
 end if;
 select * into cat from public.financial_categories where id=(payload->>'category_id')::uuid;
 if not found or cat.id<>'f0100000-0000-4000-8000-000000000002'::uuid or payload->>'method' is distinct from cat.method or payload->>'mode' is distinct from cat.mode
 or payload->'config' is distinct from '{"currency":"EUR","denominator":"building_common_parts","participants":"all_building_units","scenario":"FND-F05","funding_source":"targeted_shortfall"}'::jsonb
 then raise exception 'Unsupported category/method/parameters' using errcode='23514'; end if;
 select * into basis from public.resolutions r where r.scope_id=scope and r.id=(payload->>'resolution_id')::uuid for share;
 if not found or basis.resolution_type<>'planned_repair_shortfall' then raise exception 'Scoped FND-F05 resolution required' using errcode='42501'; end if;
 if payload->>'valid_from' !~ '^\d{4}-\d{2}-\d{2}$' or(payload->>'valid_to' is not null and payload->>'valid_to' !~ '^\d{4}-\d{2}-\d{2}$') then raise exception 'Invalid rule dates' using errcode='23514'; end if;
 starts:=(payload->>'valid_from')::date; ends:=(payload->>'valid_to')::date;
 if ends is null or starts<basis.effective_from or(ends is not null and ends<=starts) or(basis.effective_to is not null and(ends is null or ends>basis.effective_to))
 then raise exception 'Rule period must fit the recorded resolution' using errcode='23514'; end if;
 select s.building_id into building from public.management_units s where s.id=scope;
 result:=coalesce(target,gen_random_uuid());
 insert into public.allocation_rule_versions(id,scope_id,category_id,resolution_id,resolution_snapshot,method,mode,config,denominator_building_id,valid_from,valid_to,recorded_by,modified_by)
 values(result,scope,cat.id,basis.id,to_jsonb(basis),cat.method,cat.mode,payload->'config',building,starts,ends,private.actor(),private.actor())
 on conflict(id) do update set category_id=excluded.category_id,resolution_id=excluded.resolution_id,resolution_snapshot=excluded.resolution_snapshot,
 method=excluded.method,mode=excluded.mode,config=excluded.config,denominator_building_id=excluded.denominator_building_id,valid_from=excluded.valid_from,valid_to=excluded.valid_to,
 revision=allocation_rule_versions.revision+1,modified_by=private.actor(),modified_at=clock_timestamp() returning * into fresh;
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta)
 values(scope,private.actor(),'save_financial_rule','allocation_rule_version',result,btrim(note),jsonb_build_object('before',case when target is null then null else to_jsonb(old) end,'after',to_jsonb(fresh)));
 return result;
end $$;
create or replace function private.financial_draft_feed() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'scopes',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'label',s.label,'mode',s.mode,'can_prepare',(private.has_scope_permission(s.id,'prepare_rules') and s.mode='building')) order by s.label),'[]') from public.management_units s where private.can_read_financial_drafts(s.id)),
 'catalog',(select coalesce(jsonb_agg(to_jsonb(c) order by c.code,c.version),'[]') from public.financial_categories c where exists(select 1 from public.management_units s where private.can_read_financial_drafts(s.id))),
 'resolutions',(select coalesce(jsonb_agg(to_jsonb(r) order by r.recorded_at,r.id),'[]') from public.resolutions r where private.can_read_financial_drafts(r.scope_id)),
 'rules',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('basis_changed',r.resolution_snapshot->>'revision' is distinct from b.revision::text) order by r.recorded_at,r.id),'[]') from public.allocation_rule_versions r join public.resolutions b on b.scope_id=r.scope_id and b.id=r.resolution_id where private.can_read_financial_drafts(r.scope_id)),
 'history',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'target_id',a.target_id,'action',a.action,'actor_profile_id',a.actor_profile_id,'at',a.happened_at,'reason',a.reason,'change',a.safe_delta) order by a.happened_at,a.id),'[]') from public.audit_events a where a.action in('save_financial_resolution','save_financial_rule') and private.can_read_financial_drafts(a.scope_id)))
$$;
