-- DB-B: physical records, durable management scope, periods and current authorization.
create table public.buildings (
 id uuid primary key default gen_random_uuid(), address text not null check(length(btrim(address)) between 1 and 300),
 cadastral_id text, label text, created_by_organization_id uuid not null references public.organizations, archived_at timestamptz
);
create table public.entrances (
 id uuid primary key default gen_random_uuid(), building_id uuid not null references public.buildings,
 code text not null check(length(btrim(code)) between 1 and 40), archived_at timestamptz,
 unique(building_id,code), unique(building_id,id)
);
create table public.management_units (
 id uuid primary key default gen_random_uuid(), building_id uuid not null references public.buildings, entrance_id uuid,
 mode text not null check(mode in ('building','entrance')), label text not null check(length(btrim(label)) between 1 and 160),
 official_registration_code text, status text not null default 'active' check(status in ('active','inactive')),
 foreign key(building_id,entrance_id) references public.entrances(building_id,id),
 check((mode='building' and entrance_id is null) or (mode='entrance' and entrance_id is not null))
);
create table public.management_assignments (
 id uuid primary key default gen_random_uuid(), scope_id uuid not null references public.management_units,
 organization_id uuid not null references public.organizations,
 valid_from date not null, valid_to date, status text not null default 'active' check(status in ('active','inactive')),
 check(valid_to is null or valid_to>valid_from),
 exclude using gist(scope_id with =, daterange(valid_from,valid_to,'[)') with &&) where(status='active')
);
create index assignments_org_idx on public.management_assignments(organization_id,scope_id);
create table public.units (
 id uuid primary key default gen_random_uuid(), building_id uuid not null references public.buildings, entrance_id uuid,
 unit_type text not null check(unit_type in ('apartment','shop','office','garage','other')),
 unit_number text not null check(length(btrim(unit_number)) between 1 and 40), floor text,
 area numeric(12,4) check(area>0), archived_at timestamptz,
 foreign key(building_id,entrance_id) references public.entrances(building_id,id),
 unique nulls not distinct(building_id,entrance_id,unit_type,unit_number)
);
create table public.unit_scope_periods (
 id uuid primary key default gen_random_uuid(), scope_id uuid not null references public.management_units,
 unit_id uuid not null references public.units, valid_from date not null, valid_to date,
 check(valid_to is null or valid_to>valid_from), unique(scope_id,id),
 exclude using gist(unit_id with =, daterange(valid_from,valid_to,'[)') with &&)
);
create index unit_scope_scope_idx on public.unit_scope_periods(scope_id,unit_id);
alter table public.user_roles drop constraint db_a_scope_closed;
alter table public.user_roles add foreign key(scope_id) references public.management_units;
alter table public.audit_events drop constraint db_a_audit_scope_closed;
alter table public.audit_events add foreign key(scope_id) references public.management_units;
create index roles_scope_idx on public.user_roles(scope_id);
-- Structural links have no client UPDATE grants; these guards also protect trusted imports.
create function private.validate_unit_scope() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.units u join public.management_units s on s.id=new.scope_id
   where u.id=new.unit_id and u.building_id=s.building_id and (s.mode='building' or u.entrance_id=s.entrance_id)) then
   raise exception 'Unit and scope mismatch' using errcode='23514';
 end if;
 return new;
end $$;
create trigger validate_unit_scope before insert or update on public.unit_scope_periods for each row execute function private.validate_unit_scope();

create function private.has_scope_permission(scope uuid, permission text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_roles r
 join public.profiles p on p.id=r.profile_id
 join public.organization_memberships m on m.id=r.membership_id
 join public.organizations o on o.id=m.organization_id
 join public.management_assignments a on a.organization_id=o.id and a.scope_id=r.scope_id
 join public.management_units s on s.id=a.scope_id
 where r.profile_id=private.actor() and p.status='active' and r.scope_id=scope and permission=any(r.permissions)
 and o.status='active' and m.status='active' and a.status='active' and s.status='active'
 and r.valid_from<=now() and (r.valid_to is null or now()<r.valid_to)
 and m.valid_from<=now() and (m.valid_to is null or now()<m.valid_to)
 and a.valid_from<=current_date and (a.valid_to is null or current_date<a.valid_to))
$$;
create function private.can_read_building(building uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.management_units s where s.building_id=building and private.has_scope_permission(s.id,'read_registry'))
$$;
create function private.can_manage_building(building uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.management_units s where s.building_id=building and private.has_scope_permission(s.id,'manage_registry'))
$$;
create function private.can_read_unit(unit uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.unit_scope_periods p where p.unit_id=unit and p.valid_from<=current_date
 and (p.valid_to is null or current_date<p.valid_to) and private.has_scope_permission(p.scope_id,'read_registry'))
$$;

-- Organization administration can establish a NEW physical context only, never claim an existing address/scope.
create function private.create_management_context(org uuid, address text, label text, entrance_code text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare building uuid; entrance uuid; scope uuid;
begin
 if not private.is_org_admin(org) then raise exception 'Forbidden' using errcode='42501'; end if;
 insert into public.buildings(address,label,created_by_organization_id) values(btrim(address),btrim(label),org) returning id into building;
 if entrance_code is not null then insert into public.entrances(building_id,code) values(building,btrim(entrance_code)) returning id into entrance; end if;
 insert into public.management_units(building_id,entrance_id,mode,label) values(building,entrance,case when entrance is null then 'building' else 'entrance' end,btrim(label)) returning id into scope;
 insert into public.management_assignments(scope_id,organization_id,valid_from) values(scope,org,current_date);
 insert into public.audit_events(scope_id,organization_id,actor_profile_id,action,target_kind,target_id) values(scope,org,private.actor(),'create_management_context','scope',scope);
 return scope;
end $$;
create function public.create_management_context(org uuid, address text, label text, entrance_code text default null) returns uuid language sql security invoker set search_path='' as $$ select private.create_management_context(org,address,label,entrance_code) $$;

create function private.assign_staff_role(org uuid, target_auth_user_id uuid, scope uuid, role text, permissions text[]) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid; member uuid; result uuid;
begin
 if not private.is_org_admin(org) or role not in ('manager','controller') then raise exception 'Forbidden' using errcode='42501'; end if;
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
create function public.assign_staff_role(org uuid, target_auth_user_id uuid, scope uuid, role text, permissions text[]) returns uuid language sql security invoker set search_path='' as $$ select private.assign_staff_role(org,target_auth_user_id,scope,role,permissions) $$;

create function private.revoke_staff_role(role_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.user_roles; org uuid;
begin
 select * into r from public.user_roles where id=role_id for update;
 select organization_id into org from public.organization_memberships where id=r.membership_id;
 if r.id is null or r.role_code not in ('manager','controller') or not private.is_org_admin(org) then raise exception 'Forbidden' using errcode='42501'; end if;
 if r.valid_to is not null then return; end if;
 update public.user_roles set valid_to=greatest(clock_timestamp(),valid_from+interval '1 microsecond') where id=role_id;
 insert into public.audit_events(scope_id,organization_id,actor_profile_id,action,target_kind,target_id) values(r.scope_id,org,private.actor(),'revoke_staff_role','user_role',role_id);
end $$;
create function public.revoke_staff_role(role_id uuid) returns void language sql security invoker set search_path='' as $$ select private.revoke_staff_role(role_id) $$;

create function private.create_unit(scope uuid, unit_number text, unit_type text, floor text default null, area numeric default null) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.management_units; result uuid;
begin
 if not private.has_scope_permission(scope,'manage_registry') then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into strict s from public.management_units where id=scope for update;
 insert into public.units(building_id,entrance_id,unit_number,unit_type,floor,area) values(s.building_id,s.entrance_id,btrim(unit_number),unit_type,floor,area) returning id into result;
 insert into public.unit_scope_periods(scope_id,unit_id,valid_from) values(scope,result,current_date);
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id) values(scope,private.actor(),'create_unit','unit',result);
 return result;
end $$;
create function public.create_unit(scope uuid, unit_number text, unit_type text, floor text default null, area numeric default null) returns uuid language sql security invoker set search_path='' as $$ select private.create_unit(scope,unit_number,unit_type,floor,area) $$;

-- Safe current context projection: org administration can see context IDs without inheriting registry/finance rights.
create function private.my_contexts() returns table(organization_id uuid, organization_name text, scope_id uuid, scope_label text, can_manage_members boolean, can_manage_registry boolean) language sql stable security definer set search_path='' as $$
 select distinct o.id,o.name,s.id,s.label,private.is_org_admin(o.id),private.has_scope_permission(s.id,'manage_registry')
 from public.organizations o join public.management_assignments a on a.organization_id=o.id join public.management_units s on s.id=a.scope_id
 where a.status='active' and a.valid_from<=current_date and (a.valid_to is null or current_date<a.valid_to)
 and o.status='active' and s.status='active' and (private.is_org_admin(o.id) or private.has_scope_permission(s.id,'read_registry'))
$$;
create function public.my_contexts() returns table(organization_id uuid, organization_name text, scope_id uuid, scope_label text, can_manage_members boolean, can_manage_registry boolean) language sql stable security invoker set search_path='' as $$ select * from private.my_contexts() $$;

do $$ declare t text; begin
 foreach t in array array['buildings','entrances','management_units','management_assignments','units','unit_scope_periods'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;
grant select on public.buildings,public.entrances,public.management_units,public.management_assignments,public.units,public.unit_scope_periods to authenticated;
-- Registry creation uses atomic RPCs; archive/update workflows follow in DEV-03.
create policy building_read on public.buildings for select to authenticated using(private.can_read_building(id));
create policy entrance_read on public.entrances for select to authenticated using(exists(select 1 from public.management_units s where s.building_id=entrances.building_id and (s.mode='building' or s.entrance_id=entrances.id) and private.has_scope_permission(s.id,'read_registry')));
create policy scope_read on public.management_units for select to authenticated using(private.has_scope_permission(id,'read_registry'));
create policy assignment_read on public.management_assignments for select to authenticated using(private.is_org_admin(organization_id) or private.has_scope_permission(scope_id,'read_registry'));
create policy unit_read on public.units for select to authenticated using(private.can_read_unit(id));
create policy unit_scope_read on public.unit_scope_periods for select to authenticated using(private.has_scope_permission(scope_id,'read_registry') and valid_from<=current_date and (valid_to is null or current_date<valid_to));

revoke all on function private.validate_unit_scope(),private.has_scope_permission(uuid,text),private.can_read_building(uuid),private.can_manage_building(uuid),private.can_read_unit(uuid),private.create_management_context(uuid,text,text,text),private.assign_staff_role(uuid,uuid,uuid,text,text[]),private.revoke_staff_role(uuid),private.create_unit(uuid,text,text,text,numeric),private.my_contexts() from public,anon,authenticated;
grant execute on function private.has_scope_permission(uuid,text),private.can_read_building(uuid),private.can_read_unit(uuid),private.create_management_context(uuid,text,text,text),private.assign_staff_role(uuid,uuid,uuid,text,text[]),private.revoke_staff_role(uuid),private.create_unit(uuid,text,text,text,numeric),private.my_contexts() to authenticated;
revoke all on function public.create_management_context(uuid,text,text,text),public.assign_staff_role(uuid,uuid,uuid,text,text[]),public.revoke_staff_role(uuid),public.create_unit(uuid,text,text,text,numeric),public.my_contexts() from public,anon,authenticated;
grant execute on function public.create_management_context(uuid,text,text,text),public.assign_staff_role(uuid,uuid,uuid,text,text[]),public.revoke_staff_role(uuid),public.create_unit(uuid,text,text,text,numeric),public.my_contexts() to authenticated;
