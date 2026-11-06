-- DB-D/1: document/draft foundation only. No activation, charges or money operations.
insert into public.role_permissions(role_code,permission_code) values
 ('manager','prepare_rules'),('cashier','prepare_rules'),
 ('manager','read_rules'),('cashier','read_rules'),('controller','read_rules');

create table public.financial_categories (
 id uuid primary key default gen_random_uuid(), code text not null check(code ~ '^[a-z][a-z_]{1,49}$'),
 version integer not null check(version>0), label_bg text not null check(length(btrim(label_bg)) between 1 and 160),
 direction text not null check(direction='repair'), method text not null check(method='ideal_shares'), mode text not null check(mode='POOL'),
 legal_source text not null check(legal_source like 'https://www.mrrb.bg/%'), legal_reference text not null,
 legal_version text not null, checked_on date not null, legal_status text not null check(legal_status='text_checked'),
 published_at timestamptz not null default now(), change_note text not null check(length(btrim(change_note)) between 1 and 1000),
 supersedes_id uuid references public.financial_categories, unique(code,version)
);
create function private.immutable_financial_catalog() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Published catalog versions are immutable; append a reviewed version' using errcode='42501'; end $$;
create trigger immutable_financial_catalog before update or delete on public.financial_categories
 for each row execute function private.immutable_financial_catalog();
create function private.validate_financial_catalog_version() returns trigger language plpgsql set search_path='' as $$
begin
 if new.version=1 and new.supersedes_id is null then return new; end if;
 if not exists(select 1 from public.financial_categories c where c.id=new.supersedes_id and c.code=new.code and c.version=new.version-1)
 then raise exception 'Catalog correction requires the preceding version of the same code' using errcode='23514'; end if;
 return new;
end $$;
create trigger validate_financial_catalog_version before insert on public.financial_categories
 for each row execute function private.validate_financial_catalog_version();
create function private.audit_financial_catalog_version() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_events(action,target_kind,target_id,reason,safe_delta)
 values('publish_financial_catalog','financial_category',new.id,new.change_note,jsonb_build_object('after',to_jsonb(new),'operator_role',session_user));
 return new;
end $$;
create trigger audit_financial_catalog_version after insert on public.financial_categories
 for each row execute function private.audit_financial_catalog_version();
insert into public.financial_categories(id,code,version,label_bg,direction,method,mode,legal_source,legal_reference,legal_version,checked_on,legal_status,change_note)
 values('f0100000-0000-4000-8000-000000000001','common_repair',1,'Ремонт на общи части','repair','ideal_shares','POOL',
 'https://www.mrrb.bg/bg/jilistna-politika/etajna-sobstvenost/zakon-za-upravlenie-na-etajnata-sobstvenost/',
 'ЗУЕС, чл. 48, ал. 1 и 3','ДВ 49/17.06.2025',date '2026-11-02','text_checked',
 'Operator-reviewed initial version. Official text checked; actual resolution/applicability remains unverified. No execution.');

create table public.resolutions (
 id uuid primary key default gen_random_uuid(), scope_id uuid not null references public.management_units,
 title text not null check(length(btrim(title)) between 1 and 160), reference text not null check(length(btrim(reference)) between 1 and 300),
 resolution_type text not null default 'general_assembly_repair' check(resolution_type='general_assembly_repair'),
 meeting_date date not null, effective_from date not null, effective_to date,
 source_kind text not null check(source_kind in ('document','statement')), source_reference text not null check(length(btrim(source_reference)) between 1 and 300), known_from date not null,
 status text not null default 'recorded_draft' check(status='recorded_draft'), verification_status text not null default 'needs_review' check(verification_status='needs_review'),
 revision integer not null default 1 check(revision>0), recorded_by uuid not null references public.profiles, recorded_at timestamptz not null default now(),
 modified_by uuid not null references public.profiles, modified_at timestamptz not null default now(),
 check(effective_from>=meeting_date and known_from>=meeting_date and(effective_to is null or effective_to>effective_from)), unique(scope_id,id)
);
create index resolutions_scope_idx on public.resolutions(scope_id,id);
create table public.allocation_rule_versions (
 id uuid primary key default gen_random_uuid(), scope_id uuid not null references public.management_units,
 category_id uuid not null references public.financial_categories, resolution_id uuid not null,
 resolution_snapshot jsonb not null check(jsonb_typeof(resolution_snapshot)='object'),
 method text not null check(method='ideal_shares'), mode text not null check(mode='POOL'),
 config jsonb not null check(config='{"currency":"EUR","denominator":"building_common_parts","participants":"all_building_units"}'::jsonb),
 denominator_building_id uuid not null references public.buildings,
 valid_from date not null, valid_to date, status text not null default 'draft' check(status='draft'),
 verification_status text not null default 'needs_review' check(verification_status='needs_review'),
 revision integer not null default 1 check(revision>0), recorded_by uuid not null references public.profiles, recorded_at timestamptz not null default now(),
 modified_by uuid not null references public.profiles, modified_at timestamptz not null default now(),
 foreign key(scope_id,resolution_id) references public.resolutions(scope_id,id), check(valid_to is null or valid_to>valid_from), unique(scope_id,id)
);
create index financial_rules_scope_idx on public.allocation_rule_versions(scope_id,id);
create index financial_rules_category_idx on public.allocation_rule_versions(category_id);
create index financial_rules_resolution_idx on public.allocation_rule_versions(scope_id,resolution_id);
create index financial_rules_building_idx on public.allocation_rule_versions(denominator_building_id);

create function private.can_read_financial_drafts(scope uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_scope_permission(scope,'read_rules') or private.has_scope_permission(scope,'prepare_rules') $$;
create function private.validate_financial_payload(payload jsonb,keys text[],note text) returns void language plpgsql set search_path='' as $$
begin
 if payload is null or jsonb_typeof(payload)<>'object' or payload-keys<>'{}'::jsonb
 or note is null or length(btrim(note)) not between 1 and 1000 then raise exception 'Invalid draft fields or reason' using errcode='23514'; end if;
end $$;
create function private.save_financial_resolution(scope uuid,target uuid,expected_revision integer,payload jsonb,note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare old public.resolutions; fresh public.resolutions; data jsonb; result uuid;
begin
 if not private.has_scope_permission(scope,'prepare_rules') then raise exception 'Financial preparation forbidden' using errcode='42501'; end if;
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
 if payload->>'meeting_date' !~ '^\d{4}-\d{2}-\d{2}$' or payload->>'effective_from' !~ '^\d{4}-\d{2}-\d{2}$'
 or payload->>'known_from' !~ '^\d{4}-\d{2}-\d{2}$' or (payload->>'effective_to' is not null and payload->>'effective_to' !~ '^\d{4}-\d{2}-\d{2}$')
 or (payload->>'known_from')::date>current_date or (payload->>'meeting_date')::date>current_date
 then raise exception 'Invalid resolution dates' using errcode='23514'; end if;
 result:=coalesce(target,gen_random_uuid());
 insert into public.resolutions(id,scope_id,title,reference,meeting_date,effective_from,effective_to,source_kind,source_reference,known_from,recorded_by,modified_by)
 values(result,scope,btrim(payload->>'title'),btrim(payload->>'reference'),(payload->>'meeting_date')::date,(payload->>'effective_from')::date,(payload->>'effective_to')::date,
 payload->>'source_kind',btrim(payload->>'source_reference'),(payload->>'known_from')::date,private.actor(),private.actor())
 on conflict(id) do update set title=excluded.title,reference=excluded.reference,meeting_date=excluded.meeting_date,effective_from=excluded.effective_from,
 effective_to=excluded.effective_to,source_kind=excluded.source_kind,source_reference=excluded.source_reference,known_from=excluded.known_from,
 revision=resolutions.revision+1,modified_by=private.actor(),modified_at=clock_timestamp() returning * into fresh;
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta)
 values(scope,private.actor(),'save_financial_resolution','resolution',result,btrim(note),jsonb_build_object('before',case when target is null then null else to_jsonb(old) end,'after',to_jsonb(fresh)));
 return result;
end $$;
create function public.save_financial_resolution(scope uuid,target uuid,expected_revision integer,payload jsonb,note text)
returns uuid language sql security invoker set search_path='' as $$select private.save_financial_resolution(scope,target,expected_revision,payload,note)$$;

create function private.save_financial_rule(scope uuid,target uuid,expected_revision integer,payload jsonb,note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare old public.allocation_rule_versions; fresh public.allocation_rule_versions; basis public.resolutions; cat public.financial_categories;
 result uuid; starts date; ends date; building uuid;
begin
 if not private.has_scope_permission(scope,'prepare_rules') then raise exception 'Financial preparation forbidden' using errcode='42501'; end if;
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
 if not found or payload->>'method' is distinct from cat.method or payload->>'mode' is distinct from cat.mode
 or payload->'config' is distinct from '{"currency":"EUR","denominator":"building_common_parts","participants":"all_building_units"}'::jsonb
 then raise exception 'Unsupported category/method/parameters' using errcode='23514'; end if;
 select * into basis from public.resolutions r where r.scope_id=scope and r.id=(payload->>'resolution_id')::uuid for share;
 if not found then raise exception 'Scoped resolution required' using errcode='42501'; end if;
 if payload->>'valid_from' !~ '^\d{4}-\d{2}-\d{2}$' or(payload->>'valid_to' is not null and payload->>'valid_to' !~ '^\d{4}-\d{2}-\d{2}$') then raise exception 'Invalid rule dates' using errcode='23514'; end if;
 starts:=(payload->>'valid_from')::date; ends:=(payload->>'valid_to')::date;
 if starts<basis.effective_from or(ends is not null and ends<=starts) or(basis.effective_to is not null and(ends is null or ends>basis.effective_to))
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
create function public.save_financial_rule(scope uuid,target uuid,expected_revision integer,payload jsonb,note text)
returns uuid language sql security invoker set search_path='' as $$select private.save_financial_rule(scope,target,expected_revision,payload,note)$$;

create function private.financial_draft_feed() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'scopes',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'label',s.label,'mode',s.mode,'can_prepare',private.has_scope_permission(s.id,'prepare_rules')) order by s.label),'[]') from public.management_units s where private.can_read_financial_drafts(s.id)),
 'catalog',(select coalesce(jsonb_agg(to_jsonb(c) order by c.code,c.version),'[]') from public.financial_categories c where exists(select 1 from public.management_units s where private.can_read_financial_drafts(s.id))),
 'resolutions',(select coalesce(jsonb_agg(to_jsonb(r) order by r.recorded_at,r.id),'[]') from public.resolutions r where private.can_read_financial_drafts(r.scope_id)),
 'rules',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('basis_changed',r.resolution_snapshot->>'revision' is distinct from b.revision::text) order by r.recorded_at,r.id),'[]') from public.allocation_rule_versions r join public.resolutions b on b.scope_id=r.scope_id and b.id=r.resolution_id where private.can_read_financial_drafts(r.scope_id)),
 'history',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'target_id',a.target_id,'action',a.action,'actor_profile_id',a.actor_profile_id,'at',a.happened_at,'reason',a.reason,'change',a.safe_delta) order by a.happened_at,a.id),'[]') from public.audit_events a where a.action in('save_financial_resolution','save_financial_rule') and private.can_read_financial_drafts(a.scope_id)))
$$;
create function public.financial_draft_feed() returns jsonb language sql stable security invoker set search_path='' as $$select private.financial_draft_feed()$$;

alter table public.financial_categories enable row level security;
alter table public.resolutions enable row level security;
alter table public.allocation_rule_versions enable row level security;
revoke all on public.financial_categories,public.resolutions,public.allocation_rule_versions from public,anon,authenticated;
grant select on public.financial_categories,public.resolutions,public.allocation_rule_versions to authenticated;
create policy financial_catalog_read on public.financial_categories for select to authenticated using(exists(select 1 from public.user_roles r where r.profile_id=private.actor() and private.can_read_financial_drafts(r.scope_id)));
create policy financial_resolution_read on public.resolutions for select to authenticated using(private.can_read_financial_drafts(scope_id));
create policy financial_rule_read on public.allocation_rule_versions for select to authenticated using(private.can_read_financial_drafts(scope_id));
revoke all on function private.immutable_financial_catalog(),private.validate_financial_catalog_version(),private.audit_financial_catalog_version(),private.can_read_financial_drafts(uuid),private.validate_financial_payload(jsonb,text[],text),
 private.save_financial_resolution(uuid,uuid,integer,jsonb,text),public.save_financial_resolution(uuid,uuid,integer,jsonb,text),private.save_financial_rule(uuid,uuid,integer,jsonb,text),public.save_financial_rule(uuid,uuid,integer,jsonb,text),private.financial_draft_feed(),public.financial_draft_feed() from public,anon,authenticated;
grant execute on function private.can_read_financial_drafts(uuid),private.save_financial_resolution(uuid,uuid,integer,jsonb,text),public.save_financial_resolution(uuid,uuid,integer,jsonb,text),
 private.save_financial_rule(uuid,uuid,integer,jsonb,text),public.save_financial_rule(uuid,uuid,integer,jsonb,text),private.financial_draft_feed(),public.financial_draft_feed() to authenticated;

-- Existing guarded grant lifecycle, now also accepts explicit cashier subsets.
create or replace function private.assign_staff_role(org uuid, target_auth_user_id uuid, scope uuid, role text, permissions text[]) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid; member uuid; result uuid;
begin
 if not private.is_org_admin(org) or role not in ('manager','controller','cashier') then raise exception 'Forbidden' using errcode='42501'; end if;
 -- Serialize membership/grant creation and reject unknown, disabled or unconfirmed recipients generically.
 perform pg_advisory_xact_lock(hashtextextended(org::text,0));
 if not exists(select 1 from public.management_assignments where scope_id=scope and organization_id=org and status='active'
   and valid_from<=current_date and (valid_to is null or current_date<valid_to)) then raise exception 'Forbidden' using errcode='42501'; end if;
 select p.id into target from public.profiles p join auth.users u on u.id=p.auth_user_id
 where u.id=target_auth_user_id and u.email_confirmed_at is not null and not u.is_anonymous and p.status<>'disabled';
 if target is null then raise exception 'Recipient unavailable' using errcode='42501'; end if;
 if permissions is null or cardinality(permissions)=0 or exists(select 1 from unnest(permissions) x where x is null or not exists(select 1 from public.role_permissions rp where rp.role_code=role and rp.permission_code=x)) then raise exception 'Invalid permission subset' using errcode='23514'; end if;
 if 'manage_registry'=any(permissions) and not 'read_registry'=any(permissions) then raise exception 'Read permission required' using errcode='23514'; end if;
 select id into member from public.organization_memberships where organization_id=org and profile_id=target and status='active'
 and valid_from<=now() and (valid_to is null or now()<valid_to);
 if member is null then insert into public.organization_memberships(organization_id,profile_id) values(org,target) returning id into member; end if;
 select id into result from public.user_roles where membership_id=member and scope_id=scope and role_code=role and valid_to is null for update;
 if result is not null then
   if (select r.permissions from public.user_roles r where r.id=result)<>permissions then raise exception 'Existing grant differs; revoke first' using errcode='23514'; end if;
   return result;
 end if;
 update public.profiles set status='active' where id=target;
 insert into public.user_roles(profile_id,membership_id,scope_id,role_code,permissions) values(target,member,scope,role,permissions) returning id into result;
 insert into public.audit_events(scope_id,organization_id,actor_profile_id,action,target_kind,target_id) values(scope,org,private.actor(),'assign_staff_role','user_role',result);
 return result;
end $$;

-- Existing guarded grant lifecycle, now also accepts explicit cashier subsets.
create or replace function private.revoke_staff_role(role_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.user_roles; org uuid;
begin
 select * into r from public.user_roles where id=role_id for update;
 select organization_id into org from public.organization_memberships where id=r.membership_id;
 if r.id is null or r.role_code not in ('manager','controller','cashier') or not private.is_org_admin(org) then raise exception 'Forbidden' using errcode='42501'; end if;
 if r.valid_to is not null then return; end if;
 update public.user_roles set valid_to=greatest(clock_timestamp(),valid_from+interval '1 microsecond') where id=role_id;
 insert into public.audit_events(scope_id,organization_id,actor_profile_id,action,target_kind,target_id) values(r.scope_id,org,private.actor(),'revoke_staff_role','user_role',role_id);
end $$;
