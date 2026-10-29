-- DB-A: application-owned objects only. No triggers/DDL in auth or storage.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
create extension if not exists btree_gist with schema extensions;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  display_name text not null default 'Потребител' check (length(btrim(display_name)) between 1 and 100),
  locale text not null default 'bg' check (locale = 'bg'),
  theme text not null default 'light' check (theme in ('light','dark')),
  status text not null default 'pending' check (status in ('pending','active','disabled')),
  created_at timestamptz not null default now()
);
create table public.organizations (
  id uuid primary key default gen_random_uuid(), name text not null check (length(btrim(name)) between 1 and 160),
  registration_code text, organization_kind text not null check (organization_kind in ('professional_manager','self_managed')),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);
create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations,
  profile_id uuid not null references public.profiles,
  valid_from timestamptz not null default now(), valid_to timestamptz,
  status text not null default 'active' check (status in ('active','inactive')),
  unique(id, profile_id), check (valid_to is null or valid_to > valid_from),
  exclude using gist (organization_id with =, profile_id with =, tstzrange(valid_from,valid_to,'[)') with &&) where (status='active')
);
create index memberships_profile_idx on public.organization_memberships(profile_id, organization_id);
create table public.role_permissions (
  role_code text not null, permission_code text not null, primary key(role_code,permission_code)
);
insert into public.role_permissions values
 ('platform_admin','manage_platform'), ('org_admin','manage_members'),
 ('manager','read_registry'), ('manager','manage_registry'), ('controller','read_registry');
-- Financial and owner permissions are not active in DB-A/B.
create table public.user_roles (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles,
  membership_id uuid, scope_id uuid,
  role_code text not null check (role_code in ('platform_admin','org_admin','manager','controller','cashier')),
  permissions text[] not null default '{}', valid_from timestamptz not null default now(), valid_to timestamptz,
  foreign key(membership_id,profile_id) references public.organization_memberships(id,profile_id),
  check (valid_to is null or valid_to > valid_from),
  check ((role_code='platform_admin' and membership_id is null and scope_id is null)
    or (role_code='org_admin' and membership_id is not null and scope_id is null)
    or (role_code in ('manager','controller','cashier') and membership_id is not null and scope_id is not null)),
  -- DB-B adds the scope FK. Until then scoped grants cannot be created.
  constraint db_a_scope_closed check(scope_id is null)
);
create index roles_profile_idx on public.user_roles(profile_id, membership_id, scope_id);
create unique index roles_current_unique on public.user_roles(profile_id,role_code,coalesce(membership_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(scope_id,'00000000-0000-0000-0000-000000000000'::uuid)) where valid_to is null;
create table public.audit_events (
  id uuid primary key default gen_random_uuid(), scope_id uuid, organization_id uuid references public.organizations,
  actor_profile_id uuid references public.profiles, action text not null, target_kind text not null,
  target_id uuid not null, happened_at timestamptz not null default now(), reason text,
  safe_delta jsonb not null default '{}', constraint db_a_audit_scope_closed check(scope_id is null)
);
-- Only organization onboarding is enabled now; staff invitations/owner links stay closed until their full lifecycle exists.
create table public.access_requests (
  id uuid primary key default gen_random_uuid(), request_kind text not null check(request_kind='organization_onboarding'),
  requester_profile_id uuid not null references public.profiles, organization_id uuid references public.organizations,
  status text not null default 'pending' check(status in ('pending','fulfilled','rejected')),
  request_payload jsonb not null check(jsonb_typeof(request_payload)='object' and request_payload ? 'name' and request_payload ? 'organization_kind'
    and request_payload - 'name' - 'organization_kind' = '{}'::jsonb
    and jsonb_typeof(request_payload->'name')='string' and length(btrim(request_payload->>'name')) between 1 and 160
    and request_payload->>'organization_kind' in ('professional_manager','self_managed')),
  reviewed_by uuid references public.profiles, reviewed_at timestamptz,
  revision integer not null default 1 check(revision>0), created_at timestamptz not null default now(),
  check ((status='pending' and reviewed_by is null and reviewed_at is null and organization_id is null)
    or (status='rejected' and reviewed_by is not null and reviewed_at is not null and organization_id is null)
    or (status='fulfilled' and reviewed_by is not null and reviewed_at is not null and organization_id is not null))
);
create unique index access_request_pending_unique on public.access_requests(requester_profile_id) where status='pending';
create table private.bootstrap_state (
  singleton boolean primary key default true check(singleton), auth_user_id uuid not null, profile_id uuid not null references public.profiles,
  initialized_at timestamptz not null default now()
);
alter table private.bootstrap_state enable row level security;
revoke all on private.bootstrap_state from public,anon,authenticated;

create function private.actor() returns uuid language sql stable security definer set search_path='' as $$
 select p.id from public.profiles p join auth.users u on u.id=p.auth_user_id
 where p.auth_user_id=(select auth.uid()) and p.status<>'disabled' and u.email_confirmed_at is not null
   and coalesce((u.raw_app_meta_data->>'provider')='anonymous',false)=false
$$;
create function private.is_platform_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_roles r join public.profiles p on p.id=r.profile_id
 where r.profile_id=private.actor() and p.status='active' and r.role_code='platform_admin'
 and r.valid_from<=now() and (r.valid_to is null or now()<r.valid_to))
$$;
create function private.is_org_admin(org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_roles r join public.organization_memberships m on m.id=r.membership_id
 join public.organizations o on o.id=m.organization_id join public.profiles p on p.id=r.profile_id
 where r.profile_id=private.actor() and p.status='active' and r.role_code='org_admin' and 'manage_members'=any(r.permissions)
 and m.organization_id=org and m.status='active' and o.status='active'
 and r.valid_from<=now() and (r.valid_to is null or now()<r.valid_to)
 and m.valid_from<=now() and (m.valid_to is null or now()<m.valid_to))
$$;
create function private.is_member(org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id
 where m.profile_id=private.actor() and m.organization_id=org and o.status='active' and m.status='active'
 and m.valid_from<=now() and (m.valid_to is null or now()<m.valid_to))
$$;
create function private.validate_role() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from unnest(new.permissions) x where x is null or not exists(select 1 from public.role_permissions rp where rp.role_code=new.role_code and rp.permission_code=x)) then
   raise exception 'Invalid permission subset' using errcode='23514';
 end if;
 return new;
end $$;
create trigger validate_role before insert or update on public.user_roles for each row execute function private.validate_role();

create function private.ensure_profile(display_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null and not is_anonymous) then
   raise exception 'Confirmed account required' using errcode='42501';
 end if;
 insert into public.profiles(auth_user_id,display_name) values(auth.uid(),btrim(display_name)) on conflict(auth_user_id) do nothing;
 select id into result from public.profiles where auth_user_id=auth.uid();
 if private.actor() is null then raise exception 'Account disabled' using errcode='42501'; end if;
 return result;
end $$;
create function public.ensure_profile(display_name text default 'Потребител') returns uuid language sql security invoker set search_path='' as $$ select private.ensure_profile(display_name) $$;

-- Operator-only: no public wrapper, no browser/API EXECUTE grant. Exact confirmed UUID, one target forever.
create function private.bootstrap_platform_admin(target_auth_user_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid; existing uuid;
begin
 perform pg_advisory_xact_lock(73599101);
 select auth_user_id into existing from private.bootstrap_state where singleton;
 if existing is not null then
   if existing<>target_auth_user_id then raise exception 'Bootstrap already completed' using errcode='42501'; end if;
   return (select profile_id from private.bootstrap_state where singleton);
 end if;
 if not exists(select 1 from auth.users where id=target_auth_user_id and email_confirmed_at is not null and not is_anonymous) then raise exception 'Confirmed target required' using errcode='23514'; end if;
 insert into public.profiles(auth_user_id) values(target_auth_user_id) on conflict(auth_user_id) do nothing;
 select id into target from public.profiles where auth_user_id=target_auth_user_id and status<>'disabled' for update;
 if target is null then raise exception 'Target disabled'; end if;
 update public.profiles set status='active' where id=target;
 insert into public.user_roles(profile_id,role_code,permissions) values(target,'platform_admin',array['manage_platform']);
 insert into private.bootstrap_state(auth_user_id,profile_id) values(target_auth_user_id,target);
 insert into public.audit_events(actor_profile_id,action,target_kind,target_id) values(target,'bootstrap_platform_admin','profile',target);
 return target;
end $$;

create function private.activate_organization(request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare req public.access_requests; org uuid; member uuid;
begin
 if not private.is_platform_admin() then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into req from public.access_requests where id=request_id for update;
 if not found then raise exception 'Request unavailable' using errcode='42501'; end if;
 if req.status='fulfilled' then return req.organization_id; end if;
 if req.status<>'pending' or not exists(select 1 from public.profiles where id=req.requester_profile_id and status<>'disabled') then raise exception 'Request unavailable' using errcode='42501'; end if;
 insert into public.organizations(name,organization_kind) values(req.request_payload->>'name',req.request_payload->>'organization_kind') returning id into org;
 insert into public.organization_memberships(organization_id,profile_id) values(org,req.requester_profile_id) returning id into member;
 insert into public.user_roles(profile_id,membership_id,role_code,permissions) values(req.requester_profile_id,member,'org_admin',array['manage_members']);
 update public.profiles set status='active' where id=req.requester_profile_id;
 update public.access_requests set status='fulfilled',organization_id=org,reviewed_by=private.actor(),reviewed_at=now(),revision=revision+1 where id=request_id;
 insert into public.audit_events(organization_id,actor_profile_id,action,target_kind,target_id) values(org,private.actor(),'activate_organization','organization',org);
 return org;
end $$;
create function public.activate_organization(request_id uuid) returns uuid language sql security invoker set search_path='' as $$ select private.activate_organization(request_id) $$;

-- All exposed tables start closed; grant only the operations actually used below.
do $$ declare t text; begin
 foreach t in array array['profiles','organizations','organization_memberships','role_permissions','user_roles','audit_events','access_requests'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;
grant select on public.profiles,public.organizations,public.organization_memberships,public.user_roles,public.role_permissions to authenticated;
grant update(display_name,locale,theme) on public.profiles to authenticated;
grant select(id,request_kind,requester_profile_id,organization_id,status,request_payload,revision,created_at) on public.access_requests to authenticated;
grant insert(request_kind,requester_profile_id,request_payload) on public.access_requests to authenticated;
create policy profile_self_read on public.profiles for select to authenticated using(id=(select private.actor()));
create policy profile_self_update on public.profiles for update to authenticated using(id=(select private.actor())) with check(id=(select private.actor()));
create policy organization_read on public.organizations for select to authenticated using(private.is_platform_admin() or private.is_member(id));
create policy membership_read on public.organization_memberships for select to authenticated using(profile_id=(select private.actor()) or private.is_org_admin(organization_id));
create policy role_self_read on public.user_roles for select to authenticated using(profile_id=(select private.actor()));
create policy catalog_read on public.role_permissions for select to authenticated using((select private.actor()) is not null);
create policy request_read on public.access_requests for select to authenticated using(requester_profile_id=(select private.actor()) or private.is_platform_admin());
create policy request_create on public.access_requests for insert to authenticated with check(requester_profile_id=(select private.actor()) and status='pending');

revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.actor(),private.is_platform_admin(),private.is_org_admin(uuid),private.is_member(uuid),private.ensure_profile(text),private.activate_organization(uuid) to authenticated;
revoke all on function public.ensure_profile(text),public.activate_organization(uuid) from public,anon,authenticated;
grant execute on function public.ensure_profile(text),public.activate_organization(uuid) to authenticated;
-- Stop accidental EXECUTE on future application routines owned by this migration role.
alter default privileges in schema private revoke execute on functions from public;
