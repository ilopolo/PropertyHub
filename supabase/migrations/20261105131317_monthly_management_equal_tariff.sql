-- CALC-04, first restricted monthly owner/occupant case. No backfill or hosted clock override.
-- Typed adapters feed the existing immutable preview and whole-batch publication engine.
do $$declare t text;c text;expr text;begin
 foreach t in array array['financial_categories','allocation_rule_versions'] loop
  foreach c in array array['method','mode'] loop
   execute format('alter table public.%I drop constraint %I',t,t||'_'||c||'_check');
   execute format('alter table public.%I add constraint %I check(%I in (%L,%L))',t,t||'_'||c||'_check',c,
    case when c='method' then 'ideal_shares' else 'POOL' end,case when c='method' then 'equal_units' else 'TARIFF' end);
  end loop;
 end loop;
 alter table public.financial_categories drop constraint financial_categories_direction_check;
 alter table public.financial_categories add check(direction in('repair','management'));
 alter table public.financial_categories add check(
  (code='monthly_management_equal' and direction='management' and method='equal_units' and mode='TARIFF')
  or(code<>'monthly_management_equal' and direction='repair' and method='ideal_shares' and mode='POOL'));
 select pg_get_expr(conbin,conrelid) into expr from pg_constraint where conrelid='public.allocation_rule_versions'::regclass and conname='allocation_rule_versions_config_check';
 alter table public.allocation_rule_versions drop constraint allocation_rule_versions_config_check;
 execute 'alter table public.allocation_rule_versions add constraint allocation_rule_versions_config_check check(('||expr||') or '
  ||'(category_id=''f0100000-0000-4000-8000-000000000003'' and config ?& array[''currency'',''scenario'',''tariff'',''policy'',''participants''] '
  ||'and config-array[''currency'',''scenario'',''tariff'',''policy'',''participants'']=''{}''::jsonb '
  ||'and config->>''currency''=''EUR'' and config->>''scenario''=''CALC-04'' '
  ||'and config->>''participants''=''all_building_units'' and config->>''policy''=''equal-unit-cent-tariff-v1'' '
  ||'and config->>''tariff'' ~ ''^(0|[1-9][0-9]{0,11})[.][0-9]{2}$'' and (config->>''tariff'')::numeric>0 and valid_to is not null))';
 alter table public.allocation_rule_versions add check(
  (category_id='f0100000-0000-4000-8000-000000000003' and method='equal_units' and mode='TARIFF')
  or(category_id<>'f0100000-0000-4000-8000-000000000003' and method='ideal_shares' and mode='POOL'));
 alter table public.resolutions drop constraint resolutions_resolution_type_check;
 alter table public.resolutions add check(resolution_type in('general_assembly_repair','planned_repair_shortfall','monthly_management_equal'));
 alter table public.financial_previews alter column share_version_id drop not null;
 alter table public.financial_previews drop constraint financial_previews_policy_check;
 alter table public.financial_previews add check(
  (policy='largest-remainder-unit-id-v1' and share_version_id is not null)
  or(policy='equal-unit-cent-tariff-v1' and share_version_id is null));
 alter table public.charge_batches drop constraint charge_batches_publication_model_check;
 alter table public.charge_batches add check(publication_model in('sole-owner-v1','ordinary-coowner-v1','monthly-owner-occupant-v1'));
end$$;
insert into public.financial_categories(id,code,version,label_bg,direction,method,mode,legal_source,legal_reference,legal_version,checked_on,legal_status,change_note)
values('f0100000-0000-4000-8000-000000000003','monthly_management_equal',1,'Месечно управление — поравно на обект','management','equal_units','TARIFF',
 'https://www.mrrb.bg/bg/jilistna-politika/etajna-sobstvenost/zakon-za-upravlenie-na-etajnata-sobstvenost/',
 'ЗУЕС чл. 51, ал. 9, т. 3; чл. 17, ал. 2, т. 8; конкретното решение и лична отговорност се проверяват отделно',
 'ДВ 49/17.06.2025',date '2026-11-05','text_checked','CALC-04 whole-month positive cent tariff; restricted complete sole owner/occupant case. Not legal certification.');

create table public.monthly_context_reviews(
 id uuid primary key default gen_random_uuid(),scope_id uuid not null references public.management_units,
 month_start date not null,source_token text not null,snapshot jsonb not null,
 completeness_reference text not null check(length(btrim(completeness_reference)) between 1 and 1000),
 reviewed_by uuid not null references public.profiles,reviewed_at timestamptz not null default clock_timestamp(),
 note text not null check(length(btrim(note)) between 1 and 1000)
);
create index monthly_context_scope on public.monthly_context_reviews(scope_id,month_start,reviewed_at desc,id);
create table private.monthly_operations(
 actor_id uuid not null references public.profiles,request_key uuid not null,input jsonb not null,result_id uuid not null,
 recorded_at timestamptz not null,primary key(actor_id,request_key)
);
alter table private.monthly_operations enable row level security;
revoke all on private.monthly_operations from public,anon,authenticated;
create trigger monthly_context_immutable before update or delete on public.monthly_context_reviews for each row execute function private.immutable_financial_preview();
alter table public.monthly_context_reviews enable row level security;
revoke all on public.monthly_context_reviews from public,anon,authenticated;
grant select on public.monthly_context_reviews to authenticated;
create function private.can_read_monthly(scope uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.can_read_financial_drafts(scope) or private.can_read_charge_batches(scope) or private.has_scope_permission(scope,'publish_rules') $$;
create policy monthly_context_read on public.monthly_context_reviews for select to authenticated using(private.can_read_monthly(scope_id) or private.has_scope_permission(scope_id,'manage_registry'));

-- Explicit interval completeness review is separate from a point-in-time record or absence of rows.
create function private.monthly_context(scope uuid,month_start date) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.management_units;u public.units;o public.ownership_periods;oc public.occupancy_periods;p public.persons;
 ends date;rows jsonb:='[]';gaps text[]:='{}';n integer;sp jsonb;oreview jsonb;creview jsonb;
begin
 if not(private.can_read_monthly(scope) or private.has_scope_permission(scope,'manage_registry')) then raise exception 'monthly_context_forbidden' using errcode='42501';end if;
 if month_start is null or month_start<>date_trunc('month',month_start)::date then raise exception 'monthly_calendar_month_required' using errcode='23514';end if;
 ends:=(month_start+interval '1 month')::date;
 if ends>private.charge_publication_day() then raise exception 'monthly_period_not_completed' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(scope::text||':monthly-context',0));
 if not(private.can_read_monthly(scope) or private.has_scope_permission(scope,'manage_registry')) then raise exception 'monthly_context_revoked' using errcode='42501';end if;
 begin
  lock table public.units,public.unit_scope_periods,public.ownership_periods,public.ownership_set_reviews,
   public.occupancy_periods,public.occupancy_set_reviews,public.persons,public.management_units,public.monthly_context_reviews in share mode nowait;
 exception when lock_not_available then raise exception 'monthly_context_busy' using errcode='PT409';end;
 select * into s from public.management_units where id=scope;
 if s.id is null or s.mode<>'building' then raise exception 'monthly_whole_building_required' using errcode='23514';end if;
 select count(*) into n from public.units where building_id=s.building_id;
 if n<4 then gaps:=array_append(gaps,'ordinary_building_at_least_four_units');end if;
 for u in select * from public.units where building_id=s.building_id order by id loop
  o:=null;oc:=null;p:=null;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into sp from public.unit_scope_periods x
   where x.unit_id=u.id and daterange(x.valid_from,x.valid_to,'[)')&&daterange(month_start,ends,'[)');
  if u.unit_type<>'apartment' or jsonb_array_length(sp)<>1 or not exists(select 1 from public.unit_scope_periods x where x.unit_id=u.id and x.scope_id=scope and daterange(x.valid_from,x.valid_to,'[)') @> daterange(month_start,ends,'[)'))
  then gaps:=array_append(gaps,'unit_scope_or_ordinary_housing:'||u.id);end if;
  select count(*) into n from public.ownership_periods x where x.scope_id=scope and x.unit_id=u.id and x.record_state='current' and daterange(x.valid_from,x.valid_to,'[)')&&daterange(month_start,ends,'[)');
  if n=1 then select * into o from public.ownership_periods x where x.scope_id=scope and x.unit_id=u.id and x.record_state='current' and daterange(x.valid_from,x.valid_to,'[)')&&daterange(month_start,ends,'[)');end if;
  select * into p from public.persons where id=o.person_id and scope_id=scope;
  if o.id is null or o.ownership_fraction is distinct from 1::numeric or o.verification_status is distinct from 'verified'
   or not(daterange(o.valid_from,o.valid_to,'[)') @> daterange(month_start,ends,'[)'))
   or p.id is null or p.status is distinct from 'active' or p.person_kind is distinct from 'physical' or p.verification_status is distinct from 'verified' or p.revision is distinct from o.person_revision
  then gaps:=array_append(gaps,'single_verified_owner_whole_month:'||u.id);end if;
  select count(*) into n from public.occupancy_periods x where x.scope_id=scope and x.unit_id=u.id and x.record_state='current' and daterange(x.valid_from,x.valid_to,'[)')&&daterange(month_start,ends,'[)');
  if n=1 then select * into oc from public.occupancy_periods x where x.scope_id=scope and x.unit_id=u.id and x.record_state='current' and daterange(x.valid_from,x.valid_to,'[)')&&daterange(month_start,ends,'[)');end if;
  if oc.id is null or oc.count_mode is distinct from 'individual' or oc.occupant_kind is distinct from 'owner_resident' or oc.person_id is distinct from o.person_id
   or oc.person_revision is distinct from p.revision or oc.verification_status is distinct from 'verified' or oc.household_units is distinct from 1::numeric
   or not(daterange(oc.valid_from,oc.valid_to,'[)') @> daterange(month_start,ends,'[)'))
  then gaps:=array_append(gaps,'single_same_verified_occupant_whole_month:'||u.id);end if;
  -- Immutable fact IDs/reviews/current revisions are fingerprinted. Financial projection
  -- deliberately excludes contact details and the arbitrary registry evidence envelope.
  select coalesce(jsonb_agg(to_jsonb(x) order by x.as_of,x.reviewed_at,x.id),'[]') into oreview from public.ownership_set_reviews x where x.scope_id=scope and x.unit_id=u.id and x.as_of>=month_start and x.as_of<ends;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.as_of,x.reviewed_at,x.id),'[]') into creview from public.occupancy_set_reviews x where x.scope_id=scope and x.unit_id=u.id and x.as_of>=month_start and x.as_of<ends;
  rows:=rows||jsonb_build_array(jsonb_build_object('unit_id',u.id,'unit_number',u.unit_number,'unit',to_jsonb(u),'scope_periods',sp,
   'ownership',to_jsonb(o)-array['field_evidence','history_note','verification_note','retirement_evidence','retirement_note'],
   'occupancy',to_jsonb(oc)-array['field_evidence','history_note','verification_note','retirement_evidence','retirement_note'],
   'person',case when p.id is null then null else jsonb_build_object('id',p.id,'display_name',p.display_name,'revision',p.revision,'person_kind',p.person_kind,'status',p.status,'verification_status',p.verification_status,'verified_by',p.verified_by,'verified_at',p.verified_at) end,
   'ownership_reviews',oreview,'occupancy_reviews',creview));
 end loop;
 return jsonb_build_object('schema_version','calc04-monthly-context-v1','scope_id',scope,'month_start',month_start,'month_end',ends,'scope',to_jsonb(s),'units',rows,'gaps',to_jsonb(gaps));
end$$;
create function private.review_monthly_context(scope uuid,month_start date,expected_token text,completeness_reference text,note text,request_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare x jsonb;input jsonb;receipt private.monthly_operations;result uuid;
begin
 if not private.has_scope_permission(scope,'manage_registry') then raise exception 'monthly_registry_review_forbidden' using errcode='42501';end if;
 perform private.validate_financial_payload('{}',array[]::text[],note);
 if completeness_reference is null or length(btrim(completeness_reference)) not between 1 and 1000 or request_key is null then raise exception 'monthly_completeness_evidence_required' using errcode='23514';end if;
 input:=jsonb_build_object('action','monthly_context','scope',scope,'month',month_start,'token',expected_token,'reference',btrim(completeness_reference),'note',btrim(note));
 perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||':charge:'||request_key::text,0));
 if not private.has_scope_permission(scope,'manage_registry') then raise exception 'monthly_registry_review_revoked' using errcode='42501';end if;
 select * into receipt from private.monthly_operations where actor_id=private.actor() and monthly_operations.request_key=review_monthly_context.request_key;
 if found then if receipt.input<>input then raise exception 'monthly_request_changed' using errcode='PT409';end if;return receipt.result_id;end if;
 x:=private.monthly_context(scope,month_start);
 if md5(x::text) is distinct from expected_token then raise exception 'monthly_context_changed' using errcode='PT409';end if;
 if jsonb_array_length(x->'gaps')<>0 then raise exception 'monthly_context_gaps' using errcode='23514',detail=(x->'gaps')::text;end if;
 insert into public.monthly_context_reviews(scope_id,month_start,source_token,snapshot,completeness_reference,reviewed_by,note)
 values(scope,month_start,expected_token,x,btrim(completeness_reference),private.actor(),btrim(note)) returning id into result;
 insert into private.monthly_operations values(private.actor(),request_key,input,result,clock_timestamp());
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta) values(scope,private.actor(),'review_monthly_context','monthly_context_review',result,btrim(note),jsonb_build_object('source_token',expected_token,'month',month_start,'completeness_reference',btrim(completeness_reference)));
 return result;
end$$;

-- This typed preparation creates a monthly source instance referencing an actual resolution.
-- It does not assert a new assembly is needed for each month or infer a method by default.
create function private.save_monthly_management_rule(scope uuid,target uuid,expected_revision integer,request_key uuid,payload jsonb,note text) returns uuid language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare old public.allocation_rule_versions;b public.resolutions;r public.allocation_rule_versions;id uuid;bid uuid;building uuid;
 starts date;ends date;meeting date;due date;known date;q numeric;input jsonb;receipt private.monthly_operations;key text;
begin
 if not private.has_scope_permission(scope,'prepare_rules') then raise exception 'monthly_prepare_forbidden' using errcode='42501';end if;
 perform private.validate_financial_payload(payload,array['month_start','tariff','meeting_date','due_on','known_from','title','reference','source_reference','source_hash','method_reference','applicability_reason','quorum_reference','representation_reference','votes_all_common_parts','unchanged_reference','ordinary_housing_confirmed','supersedes_id'],note);
 if payload->>'supersedes_id' is not null then perform (payload->>'supersedes_id')::uuid;end if;
 foreach key in array array['title','reference','source_reference','source_hash','method_reference','applicability_reason','quorum_reference','representation_reference','unchanged_reference'] loop
  if jsonb_typeof(payload->key) is distinct from 'string' or length(btrim(payload->>key)) not between 1 and (case when key='title' then 160 when key in('reference','source_reference') then 300 else 1000 end) then raise exception 'monthly_source_evidence_required' using errcode='23514';end if;
 end loop;
 if payload->>'source_hash' !~ '^[a-f0-9]{64}$' then raise exception 'monthly_source_sha256_required' using errcode='23514';end if;
 if payload->'ordinary_housing_confirmed' is distinct from 'true'::jsonb or payload->>'tariff' is null or payload->>'tariff' !~ '^(0|[1-9][0-9]{0,11})[.][0-9]{2}$'
  or jsonb_typeof(payload->'tariff') is distinct from 'string' or payload->>'votes_all_common_parts' is null or payload->>'votes_all_common_parts' !~ '^(0|[1-9][0-9]{0,2})([.][0-9]{1,8})?$'
  or jsonb_typeof(payload->'votes_all_common_parts') is distinct from 'string'
 then raise exception 'monthly_explicit_tariff_method_and_applicability_required' using errcode='23514';end if;
 q:=(payload->>'tariff')::numeric;
 if q<=0 or (payload->>'votes_all_common_parts')::numeric<51 or (payload->>'votes_all_common_parts')::numeric>100 then raise exception 'monthly_tariff_or_all_common_parts_vote_invalid' using errcode='23514';end if;
 starts:=private.share_date(payload->>'month_start');ends:=(starts+interval '1 month')::date;
 meeting:=private.share_date(payload->>'meeting_date');due:=private.share_date(payload->>'due_on');known:=private.share_date(payload->>'known_from');
 if starts<>date_trunc('month',starts)::date or meeting<date '2023-09-29' or meeting>starts or meeting>private.charge_publication_day() or known<meeting or known>private.charge_publication_day() or due<meeting
 then raise exception 'monthly_source_dates_invalid' using errcode='23514';end if;
 if request_key is null then raise exception 'monthly_request_required' using errcode='23514';end if;
 input:=jsonb_build_object('action','monthly_save','scope',scope,'target',target,'revision',expected_revision,'payload',payload,'note',btrim(note));
 perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||':charge:'||request_key::text,0));
 perform pg_advisory_xact_lock(hashtextextended(scope::text||':monthly-management',0));
 if not private.has_scope_permission(scope,'prepare_rules') then raise exception 'monthly_prepare_revoked' using errcode='42501';end if;
 select * into receipt from private.monthly_operations where actor_id=private.actor() and monthly_operations.request_key=save_monthly_management_rule.request_key;
 if found then if receipt.input<>input then raise exception 'monthly_request_changed' using errcode='PT409';end if;return receipt.result_id;end if;
 select building_id into building from public.management_units s where s.id=scope and s.mode='building';
 if building is null then raise exception 'monthly_whole_building_required' using errcode='23514';end if;
 if target is null then if expected_revision is distinct from 0 then raise exception 'monthly_revision_changed' using errcode='PT409';end if;id:=gen_random_uuid();bid:=gen_random_uuid();
 else
  select * into old from public.allocation_rule_versions where scope_id=scope and allocation_rule_versions.id=target for update;
  if old.id is null or old.category_id<>'f0100000-0000-4000-8000-000000000003' then raise exception 'monthly_rule_unavailable' using errcode='42501';end if;
  if old.status<>'draft' or old.revision is distinct from expected_revision then raise exception 'monthly_revision_changed' using errcode='PT409';end if;
  id:=old.id;bid:=old.resolution_id;
 end if;
 insert into public.resolutions(id,scope_id,title,reference,resolution_type,meeting_date,effective_from,effective_to,source_kind,source_reference,known_from,evidence,applicability,recorded_by,modified_by)
 values(bid,scope,btrim(payload->>'title'),btrim(payload->>'reference'),'monthly_management_equal',meeting,starts,ends,'document',btrim(payload->>'source_reference'),known,
  payload,jsonb_build_object('schema_version','calc04-equal-unit-v1','legal_method','51_9_3','majority','17_2_8','ordinary_housing',true),private.actor(),private.actor())
 on conflict(id) do update set title=excluded.title,reference=excluded.reference,meeting_date=excluded.meeting_date,effective_from=excluded.effective_from,effective_to=excluded.effective_to,
  source_reference=excluded.source_reference,known_from=excluded.known_from,evidence=excluded.evidence,applicability=excluded.applicability,revision=resolutions.revision+1,modified_by=private.actor(),modified_at=clock_timestamp() returning * into b;
 insert into public.allocation_rule_versions(id,scope_id,category_id,resolution_id,resolution_snapshot,method,mode,config,denominator_building_id,valid_from,valid_to,recorded_by,modified_by)
 values(id,scope,'f0100000-0000-4000-8000-000000000003',bid,to_jsonb(b),'equal_units','TARIFF',
  jsonb_build_object('currency','EUR','scenario','CALC-04','policy','equal-unit-cent-tariff-v1','participants','all_building_units','tariff',payload->>'tariff'),building,starts,ends,private.actor(),private.actor())
 on conflict(id) do update set resolution_snapshot=excluded.resolution_snapshot,config=excluded.config,valid_from=excluded.valid_from,valid_to=excluded.valid_to,revision=allocation_rule_versions.revision+1,modified_by=private.actor(),modified_at=clock_timestamp() returning * into r;
 insert into private.monthly_operations values(private.actor(),request_key,input,id,clock_timestamp());
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta) values(scope,private.actor(),'save_monthly_management','allocation_rule_version',id,btrim(note),jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(r),'basis',to_jsonb(b)));
 return id;
end$$;

create function private.monthly_management_inputs(scope uuid,rule_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.allocation_rule_versions;b public.resolutions;x jsonb;cr public.monthly_context_reviews;
begin
 if not private.can_read_monthly(scope) then raise exception 'monthly_read_forbidden' using errcode='42501';end if;
 begin lock table public.resolutions,public.allocation_rule_versions in share mode nowait;
 exception when lock_not_available then raise exception 'monthly_source_busy' using errcode='PT409';end;
 select * into r from public.allocation_rule_versions where scope_id=scope and id=rule_id;
 if r.id is null or r.category_id<>'f0100000-0000-4000-8000-000000000003' then raise exception 'monthly_rule_unavailable' using errcode='42501';end if;
 select * into b from public.resolutions where id=r.resolution_id and scope_id=scope;
 if b.resolution_type is distinct from 'monthly_management_equal' or to_jsonb(b) is distinct from r.resolution_snapshot
  or b.evidence->>'tariff' is distinct from r.config->>'tariff' or b.effective_from<>r.valid_from or b.effective_to is distinct from r.valid_to
  or r.valid_from<>date_trunc('month',r.valid_from)::date or r.valid_to is distinct from (r.valid_from+interval '1 month')::date
 then raise exception 'monthly_basis_changed' using errcode='PT409';end if;
 x:=private.monthly_context(scope,r.valid_from);
 select * into cr from public.monthly_context_reviews c where c.scope_id=scope and c.month_start=r.valid_from order by reviewed_at desc,id desc limit 1;
 if cr.id is null or cr.source_token is distinct from md5(x::text) then raise exception 'monthly_fresh_interval_completeness_review_required' using errcode='PT409';end if;
 if jsonb_array_length(x->'gaps')<>0 then raise exception 'monthly_context_gaps' using errcode='23514',detail=(x->'gaps')::text;end if;
 if r.status='active' and (b.verification_status<>'reviewed' or b.reviewed_revision<>b.revision or r.activation_snapshot->'context' is distinct from to_jsonb(cr))
 then raise exception 'monthly_active_source_changed' using errcode='PT409';end if;
 return jsonb_build_object('schema_version','calc04-inputs-v1','scope_id',scope,'rule',to_jsonb(r),'basis',to_jsonb(b),'context',to_jsonb(cr),
  'units',x->'units','collection_amount',((r.config->>'tariff')::numeric*jsonb_array_length(x->'units'))::numeric(18,2)::text,
  'tariff',r.config->>'tariff','period_start',r.valid_from,'period_end',r.valid_to,'liability_date',r.valid_to-1,'due_date',b.evidence->>'due_on');
end$$;

create function private.activate_monthly_management_rule(scope uuid,target uuid,expected_revision integer,request_key uuid,expected_token text,note text) returns uuid language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare r public.allocation_rule_versions;b public.resolutions;x jsonb;input jsonb;receipt private.monthly_operations;id uuid;stamp timestamptz;prior uuid;
begin
 if not private.has_scope_permission(scope,'publish_rules') then raise exception 'monthly_activation_forbidden' using errcode='42501';end if;
 perform private.validate_financial_payload('{}',array[]::text[],note);
 if request_key is null then raise exception 'monthly_request_required' using errcode='23514';end if;
 input:=jsonb_build_object('action','monthly_activate','scope',scope,'target',target,'revision',expected_revision,'token',expected_token,'note',btrim(note));
 perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||':charge:'||request_key::text,0));
 perform pg_advisory_xact_lock(hashtextextended(scope::text||':monthly-management',0));
 if not private.has_scope_permission(scope,'publish_rules') then raise exception 'monthly_activation_revoked' using errcode='42501';end if;
 select * into receipt from private.monthly_operations where actor_id=private.actor() and monthly_operations.request_key=activate_monthly_management_rule.request_key;
 if found then if receipt.input<>input then raise exception 'monthly_request_changed' using errcode='PT409';end if;return receipt.result_id;end if;
 select * into r from public.allocation_rule_versions where id=target and scope_id=scope for update;
 if r.id is null then raise exception 'monthly_rule_unavailable' using errcode='42501';end if;
 if r.status<>'draft' or r.revision is distinct from expected_revision then raise exception 'monthly_revision_changed' using errcode='PT409';end if;
 x:=private.monthly_management_inputs(scope,target);
 if md5(x::text) is distinct from expected_token then raise exception 'monthly_inputs_changed' using errcode='PT409';end if;
 prior:=nullif(x->'basis'->'evidence'->>'supersedes_id','')::uuid;
 if prior is not null and not exists(select 1 from public.allocation_rule_versions a where a.id=prior and a.scope_id=scope and a.status='active'
  and a.category_id=r.category_id and a.resolution_id=r.resolution_id and a.source_draft_id=r.id and a.valid_from=r.valid_from and a.valid_to=r.valid_to
  and not exists(select 1 from public.allocation_rule_versions newer where newer.supersedes_id=a.id))
 then raise exception 'monthly_explicit_current_variant_required' using errcode='PT409';end if;
 -- One current reviewed management method; supersession is an explicit same-source/period correction.
 if exists(select 1 from public.allocation_rule_versions a join public.financial_categories c on c.id=a.category_id
  where a.scope_id=scope and a.status='active' and c.direction='management' and a.id is distinct from prior
  and not exists(select 1 from public.allocation_rule_versions newer where newer.supersedes_id=a.id)
  and daterange(a.valid_from,a.valid_to,'[)')&&daterange(r.valid_from,r.valid_to,'[)'))
 then raise exception 'monthly_management_method_overlap' using errcode='PT409';end if;
 update public.resolutions set verification_status='reviewed',revision=revision+1,reviewed_revision=revision+1,reviewed_by=private.actor(),reviewed_at=clock_timestamp(),review_note=btrim(note)
  where id=r.resolution_id returning * into b;
 stamp:=clock_timestamp();id:=gen_random_uuid();
 insert into public.allocation_rule_versions(id,scope_id,category_id,resolution_id,resolution_snapshot,method,mode,config,denominator_building_id,valid_from,valid_to,status,verification_status,recorded_by,modified_by,
  source_draft_id,source_draft_revision,activation_snapshot,activation_input,activation_request_key,activated_by,activated_at,supersedes_id)
 values(id,scope,r.category_id,r.resolution_id,to_jsonb(b),r.method,r.mode,r.config,r.denominator_building_id,r.valid_from,r.valid_to,'active','reviewed',private.actor(),private.actor(),
  r.id,r.revision,jsonb_build_object('schema_version','calc04-activation-v1','basis',to_jsonb(b),'context',x->'context','draft',to_jsonb(r),'source',x,'review_note',btrim(note)),input,request_key,private.actor(),stamp,prior);
 insert into private.monthly_operations values(private.actor(),request_key,input,id,clock_timestamp());
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta) values(scope,private.actor(),'activate_monthly_management','allocation_rule_version',id,btrim(note),jsonb_build_object('basis',to_jsonb(b),'source',x,'active_id',id));
 return id;
end$$;

-- Exact counterpart of the tiny domain tariff calculation: multiplication, no allocator or normalization.
create function private.create_monthly_management_preview(scope uuid,rule_id uuid,expected_token text,request_key uuid,note text) returns uuid language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare x jsonb;input jsonb;r public.allocation_rule_versions;old public.financial_previews;rows jsonb;total numeric;id uuid;
begin
 if not private.has_scope_permission(scope,'prepare_charges') then raise exception 'monthly_preview_forbidden' using errcode='42501';end if;
 perform private.validate_financial_payload('{}',array[]::text[],note);
 if request_key is null then raise exception 'monthly_request_required' using errcode='23514';end if;
 input:=jsonb_build_object('schema_version','calc04-preview-request-v1','scope',scope,'rule_id',rule_id,'token',expected_token,'note',btrim(note));
 perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||':monthly-preview:'||request_key::text,0));
 if not private.has_scope_permission(scope,'prepare_charges') then raise exception 'monthly_preview_revoked' using errcode='42501';end if;
 select * into old from public.financial_previews where recorded_by=private.actor() and financial_previews.request_key=create_monthly_management_preview.request_key;
 if found then if old.request_input<>input then raise exception 'monthly_request_changed' using errcode='PT409';end if;return old.id;end if;
 x:=private.monthly_management_inputs(scope,rule_id);
 if md5(x::text) is distinct from expected_token then raise exception 'monthly_inputs_changed' using errcode='PT409';end if;
 select * into r from public.allocation_rule_versions where id=rule_id;
 if r.status<>'active' then raise exception 'monthly_active_rule_required' using errcode='23514';end if;
 total:=(x->>'collection_amount')::numeric*100;
 select jsonb_agg(jsonb_build_object('unit_id',u->'unit_id','amount',x->>'tariff','amount_cents',trunc((x->>'tariff')::numeric*100)::text) order by(u->>'unit_id')::uuid) into rows from jsonb_array_elements(x->'units') u;
 insert into public.financial_previews(scope_id,rule_id,share_version_id,reference_date,input_token,inputs,result,policy,request_key,request_input,recorded_by,note)
 values(scope,rule_id,null,(x->>'liability_date')::date,expected_token,x,jsonb_build_object('policy','equal-unit-cent-tariff-v1','currency','EUR','total_cents',trunc(total)::text,'rows',rows),
  'equal-unit-cent-tariff-v1',request_key,input,private.actor(),btrim(note)) returning financial_previews.id into id;
 return id;
end$$;

create function private.monthly_publication_inputs(scope uuid,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb:=private.charge_claim(p);pv public.financial_previews;x jsonb;parties jsonb:='[]';gaps text[]:='{}';u jsonb;row jsonb;key text;today date:=private.charge_publication_day();
begin
 if not private.can_read_charge_batches(scope) then raise exception 'charge_read_forbidden' using errcode='42501';end if;
 select * into pv from public.financial_previews where id=(c->>'preview_id')::uuid and scope_id=scope;
 if pv.id is null or pv.policy<>'equal-unit-cent-tariff-v1' then raise exception 'monthly_preview_unavailable' using errcode='42501';end if;
 x:=private.monthly_management_inputs(scope,pv.rule_id);
 if md5(x::text)<>pv.input_token then raise exception 'monthly_preview_inputs_changed' using errcode='PT409';end if;
 if c->>'liability_date' is distinct from x->>'liability_date' then gaps:=array_append(gaps,'monthly_liability_date_last_day_required');end if;
 foreach key in array array['liability_event','legal_reference','evidence_reference','creditor_reference'] loop
  if c->>key is null then gaps:=array_append(gaps,key||'_required');end if;
 end loop;
 if pv.reference_date is distinct from (x->>'liability_date')::date or pv.result->>'policy'<>'equal-unit-cent-tariff-v1'
  or pv.result->>'currency'<>'EUR' or jsonb_array_length(pv.result->'rows')<>jsonb_array_length(x->'units')
  or (pv.result->>'total_cents')::numeric<>(x->>'collection_amount')::numeric*100
 then raise exception 'monthly_fixed_preview_invalid' using errcode='23514';end if;
 for u in select value from jsonb_array_elements(x->'units') loop
  select value into row from jsonb_array_elements(pv.result->'rows') where value->>'unit_id'=u->>'unit_id';
  if row is null or row->>'amount' is distinct from x->>'tariff' or (row->>'amount_cents')::numeric<>(x->>'tariff')::numeric*100 then raise exception 'monthly_fixed_row_invalid' using errcode='23514';end if;
  parties:=parties||jsonb_build_array(jsonb_build_object('unit_id',u->'unit_id','unit_number',u->'unit_number','person_id',u->'person'->'id',
   'person_revision',u->'person'->'revision','person_kind',u->'person'->'person_kind','label',u->'person'->'display_name',
   'ownership_id',u->'ownership'->'id','fraction','1','valid_from',u->'ownership'->'valid_from','valid_to',u->'ownership'->'valid_to',
   'occupancy_id',u->'occupancy'->'id','occupancy_period',u->'occupancy','amount',row->'amount','amount_cents',row->'amount_cents'));
 end loop;
 return jsonb_build_object('schema_version','calc04-monthly-publication-inputs-v1','scope_id',scope,'claim',c,'publication_day',today,
  'liability_date',x->'liability_date','due_date',x->'due_date','preview',to_jsonb(pv),'basis',x->'basis','parties',parties,'gaps',to_jsonb(gaps));
end$$;

-- Guarded small extensions preserve the existing engine, its payment lock and its unpaid allocation-history prohibition.
do $$declare def text;old text;fresh text;begin
 def:=replace(pg_get_functiondef('private.validate_financial_evidence(public.resolutions,jsonb)'::regprocedure),chr(13),'');
 old:='begin'||chr(10)||' if p is null';
 if position(old in def)=0 then raise exception 'CALC04 dependency: evidence guard';end if;
 def:=replace(def,old,'begin'||chr(10)||' if b.resolution_type=''monthly_management_equal'' then if p is distinct from b.evidence then raise exception ''monthly_use_typed_source_editor'' using errcode=''23514'';end if;return;end if;'||chr(10)||' if p is null');execute def;
 def:=replace(pg_get_functiondef('private.charge_claim(jsonb)'::regprocedure),chr(13),'');
 old:='if p->>''publication_model'' is distinct from ''ordinary-coowner-v1'' and p->>''publication_model'' is distinct from ''sole-owner-v1''';
 fresh:=old||' and p->>''publication_model'' is distinct from ''monthly-owner-occupant-v1''';
 if position(old in def)=0 then raise exception 'CALC04 dependency: charge claim';end if;def:=replace(def,old,fresh);
 def:=replace(def,'if p->>''publication_model''=''ordinary-coowner-v1'' then result:=result||jsonb_build_object(''publication_model'',''ordinary-coowner-v1'');end if;',
  'if p->>''publication_model'' in(''ordinary-coowner-v1'',''monthly-owner-occupant-v1'') then result:=result||jsonb_build_object(''publication_model'',p->>''publication_model'');end if;');execute def;
 def:=replace(pg_get_functiondef('private.charge_publication_inputs(uuid,jsonb)'::regprocedure),chr(13),'');
 old:='begin'||chr(10)||' if not private.can_read_charge_batches(scope)';
 if position(old in def)=0 then raise exception 'CALC04 dependency: publication inputs';end if;
 def:=replace(def,old,'begin'||chr(10)||' if c->>''publication_model''=''monthly-owner-occupant-v1'' then return private.monthly_publication_inputs(scope,c);end if;'||chr(10)||' if not private.can_read_charge_batches(scope)');execute def;
 def:=replace(pg_get_functiondef('private.publish_charge_batch(uuid,uuid,integer,uuid,text)'::regprocedure),chr(13),'');
 if position('charge_allocated_correction_forbidden' in def)=0 then raise exception 'CALC04 dependency: current payment-safe publisher';end if;
 def:=replace(def,'''schema_version'',''fnd05-published-charge-v1''','''schema_version'',case when b.publication_model=''monthly-owner-occupant-v1'' then ''calc04-published-charge-v1'' else ''fnd05-published-charge-v1'' end');
 def:=replace(def,'''schema_version'',''fnd05-unpaid-reversal-v1''','''schema_version'',case when b.publication_model=''monthly-owner-occupant-v1'' then ''calc04-unpaid-reversal-v1'' else ''fnd05-unpaid-reversal-v1'' end');
 def:=replace(def,'b.publication_model=''sole-owner-v1'' and','b.publication_model in(''sole-owner-v1'',''monthly-owner-occupant-v1'') and');execute def;
 def:=pg_get_functiondef('private.guard_charge_party_insert()'::regprocedure);
 if position('model=''sole-owner-v1''' in def)=0 then raise exception 'CALC04 dependency: single party guard';end if;
 execute replace(def,'model=''sole-owner-v1''','model in(''sole-owner-v1'',''monthly-owner-occupant-v1'')');
 def:=pg_get_functiondef('private.charge_batch_feed()'::regprocedure);
 if position('''amount'',inputs->>''collection_amount''' in def)=0 then raise exception 'CALC04 dependency: preview feed';end if;
 execute replace(def,'''amount'',inputs->>''collection_amount''','''amount'',inputs->>''collection_amount'',''policy'',policy');
 def:=pg_get_functiondef('private.financial_preview_feed()'::regprocedure);
 if position('''label'',r.resolution_snapshot->>''reference''' in def)=0 then raise exception 'CALC04 dependency: typed rule feed';end if;
 def:=replace(def,'''label'',r.resolution_snapshot->>''reference''','''label'',r.resolution_snapshot->>''reference'',''method'',r.method,''category_id'',r.category_id');
 def:=replace(def,'where private.can_read_financial_preview(r.scope_id)','where r.method=''ideal_shares'' and private.can_read_financial_preview(r.scope_id)');
 def:=replace(def,'where private.can_read_financial_preview(p.scope_id)','where p.policy=''largest-remainder-unit-id-v1'' and private.can_read_financial_preview(p.scope_id)');execute def;
 def:=pg_get_functiondef('private.financial_draft_feed()'::regprocedure);
 def:=replace(def,'from public.financial_categories c where','from public.financial_categories c where c.code<>''monthly_management_equal'' and');
 def:=replace(def,'from public.resolutions r where','from public.resolutions r where r.resolution_type<>''monthly_management_equal'' and');
 def:=replace(def,'where private.can_read_financial_drafts(r.scope_id)','where r.method=''ideal_shares'' and private.can_read_financial_drafts(r.scope_id)');execute def;
 def:=pg_get_functiondef('public.charge_batch_feed()'::regprocedure);
 if position('''parties'',coalesce' in def)=0 then raise exception 'CALC04 dependency: legacy feed';end if;
 execute replace(def,'''parties'',coalesce','''previews'',coalesce((select jsonb_agg(p) from jsonb_array_elements(x->''previews'') p where p->>''policy''<>''equal-unit-cent-tariff-v1''),''[]''),''parties'',coalesce');
 -- Legacy clients cannot accidentally treat a monthly record as FND-F05; v2 signatures stay unchanged.
 for old in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in('load_charge_batch_inputs','save_charge_batch','review_charge_batch','publish_charge_batch') loop
  def:=pg_get_functiondef(old::regprocedure);
  execute replace(def,'=''ordinary-coowner-v1''',' in(''ordinary-coowner-v1'',''monthly-owner-occupant-v1'')');
 end loop;
end$$;

create function private.monthly_management_feed() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('scopes',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'label',s.label,
  'can_prepare',private.has_scope_permission(s.id,'prepare_rules'),'can_activate',private.has_scope_permission(s.id,'publish_rules'),
  'can_preview',private.has_scope_permission(s.id,'prepare_charges'),'can_publish',private.has_scope_permission(s.id,'publish_charges'),
  'can_correct',private.has_scope_permission(s.id,'correct_finance'),'can_review_context',private.has_scope_permission(s.id,'manage_registry')) order by s.label),'[]')
  from public.management_units s where private.can_read_monthly(s.id) or private.has_scope_permission(s.id,'manage_registry')),
 'rules',(select coalesce(jsonb_agg(to_jsonb(r) order by r.recorded_at,r.id),'[]') from public.allocation_rule_versions r where r.category_id='f0100000-0000-4000-8000-000000000003' and private.can_read_monthly(r.scope_id)),
 'previews',(select coalesce(jsonb_agg(to_jsonb(p) order by p.recorded_at,p.id),'[]') from public.financial_previews p where p.policy='equal-unit-cent-tariff-v1' and private.can_read_monthly(p.scope_id))) $$;

create function public.monthly_management_feed() returns jsonb language sql stable security invoker set search_path='' as $$select private.monthly_management_feed()$$;
create function public.load_monthly_context(scope uuid,month_start date) returns jsonb language plpgsql security invoker set search_path='' as $$declare x jsonb;begin x:=private.monthly_context(scope,month_start);return jsonb_build_object('inputs',x,'input_token',md5(x::text));end$$;
create function public.review_monthly_context(scope uuid,month_start date,expected_token text,completeness_reference text,note text,request_key uuid) returns uuid language sql security invoker set search_path='' as $$select private.review_monthly_context(scope,month_start,expected_token,completeness_reference,note,request_key)$$;
create function public.save_monthly_management_rule(scope uuid,target uuid,expected_revision integer,request_key uuid,payload jsonb,note text) returns uuid language sql security invoker set search_path='' as $$select private.save_monthly_management_rule(scope,target,expected_revision,request_key,payload,note)$$;
create function public.load_monthly_management_inputs(scope uuid,rule_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$declare x jsonb;begin x:=private.monthly_management_inputs(scope,rule_id);return jsonb_build_object('inputs',x,'input_token',md5(x::text));end$$;
create function public.activate_monthly_management_rule(scope uuid,target uuid,expected_revision integer,request_key uuid,expected_token text,note text) returns uuid language sql security invoker set search_path='' as $$select private.activate_monthly_management_rule(scope,target,expected_revision,request_key,expected_token,note)$$;
create function public.create_monthly_management_preview(scope uuid,rule_id uuid,expected_token text,request_key uuid,note text) returns uuid language sql security invoker set search_path='' as $$select private.create_monthly_management_preview(scope,rule_id,expected_token,request_key,note)$$;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname in(
  'can_read_monthly','monthly_context','review_monthly_context','save_monthly_management_rule','monthly_management_inputs','activate_monthly_management_rule','create_monthly_management_preview','monthly_publication_inputs','monthly_management_feed','load_monthly_context','load_monthly_management_inputs') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  if f.nspname='public' or f.signature::text not like '%monthly_publication_inputs(%' then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end$$;
