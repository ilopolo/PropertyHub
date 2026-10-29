-- A pending appointment is administrative intent, not a physical registry record or an effective grant.
create table public.scope_setup_requests (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations,
 issuer_profile_id uuid not null references public.profiles, target_profile_id uuid not null references public.profiles,
 label text not null check(length(btrim(label)) between 1 and 160),
 permissions text[] not null default array['read_registry','manage_registry']
   check(permissions=array['read_registry','manage_registry']::text[]),
 status text not null default 'pending' check(status in ('pending','fulfilled','revoked')),
 expires_at timestamptz not null default now()+interval '48 hours', created_at timestamptz not null default now(),
 scope_id uuid unique references public.management_units, revision integer not null default 1 check(revision>0),
 check((status='fulfilled' and scope_id is not null) or (status<>'fulfilled' and scope_id is null))
);
create index setup_org_idx on public.scope_setup_requests(organization_id);
create index setup_target_idx on public.scope_setup_requests(target_profile_id);
create index setup_issuer_idx on public.scope_setup_requests(issuer_profile_id);
alter table public.scope_setup_requests enable row level security;
revoke all on public.scope_setup_requests from public,anon,authenticated;
grant select on public.scope_setup_requests to authenticated;
create policy setup_read on public.scope_setup_requests for select to authenticated
 using(target_profile_id=(select private.actor()) or private.is_org_admin(organization_id));

-- Also used to recheck the issuer when a pending initial appointment is accepted.
create function private.org_admin_profile(org uuid, profile uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_roles r join public.organization_memberships m on m.id=r.membership_id
 join public.organizations o on o.id=m.organization_id join public.profiles p on p.id=r.profile_id
 join auth.users u on u.id=p.auth_user_id
 where p.id=profile and p.status='active' and u.email_confirmed_at is not null and not u.is_anonymous
 and r.role_code='org_admin' and 'manage_members'=any(r.permissions) and o.id=org and o.status='active' and m.status='active'
 and r.valid_from<=now() and (r.valid_to is null or now()<r.valid_to)
 and m.valid_from<=now() and (m.valid_to is null or now()<m.valid_to))
$$;
create function private.request_scope_setup(org uuid, target_auth_user_id uuid, label text) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid; result uuid;
begin
 if not private.is_org_admin(org) then raise exception 'Forbidden' using errcode='42501'; end if;
 select p.id into target from public.profiles p join auth.users u on u.id=p.auth_user_id
 where u.id=target_auth_user_id and u.email_confirmed_at is not null and not u.is_anonymous and p.status<>'disabled';
 if target is null then raise exception 'Recipient unavailable' using errcode='42501'; end if;
 insert into public.scope_setup_requests(organization_id,issuer_profile_id,target_profile_id,label)
 values(org,private.actor(),target,btrim(label)) returning id into result;
 insert into public.audit_events(organization_id,actor_profile_id,action,target_kind,target_id)
 values(org,private.actor(),'request_scope_setup','scope_setup_request',result);
 return result;
end $$;
create function public.request_scope_setup(org uuid,target_auth_user_id uuid,label text) returns uuid language sql security invoker set search_path='' as $$select private.request_scope_setup(org,target_auth_user_id,label)$$;

create function private.revoke_scope_setup(request_id uuid, expected_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare req public.scope_setup_requests;
begin
 select * into req from public.scope_setup_requests where id=request_id for update;
 if not found or not coalesce(private.is_org_admin(req.organization_id) or req.target_profile_id=private.actor(),false) then raise exception 'Forbidden' using errcode='42501'; end if;
 if req.revision<>expected_revision or req.status<>'pending' then raise exception 'Request changed' using errcode='23514'; end if;
 update public.scope_setup_requests set status='revoked',revision=revision+1 where id=request_id;
 insert into public.audit_events(organization_id,actor_profile_id,action,target_kind,target_id)
 values(req.organization_id,private.actor(),'revoke_scope_setup','scope_setup_request',request_id);
end $$;
create function public.revoke_scope_setup(request_id uuid,expected_revision integer) returns void language sql security invoker set search_path='' as $$select private.revoke_scope_setup(request_id,expected_revision)$$;

-- Internal only. The provenance migration exposes a checked atomic wrapper with required source inputs.
create function private.complete_scope_setup(request_id uuid, address text, entrance_code text) returns uuid language plpgsql security definer set search_path='' as $$
declare req public.scope_setup_requests; building uuid; entrance uuid; scope uuid; member uuid;
begin
 select * into req from public.scope_setup_requests where id=request_id for update;
 if not found or req.target_profile_id is distinct from private.actor() then raise exception 'Forbidden' using errcode='42501'; end if;
 if req.status='fulfilled' then return req.scope_id; end if;
 if req.status<>'pending' or req.expires_at<=now() or not private.org_admin_profile(req.organization_id,req.issuer_profile_id) then raise exception 'Appointment unavailable' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(req.organization_id::text,0));
 -- The explicit manager package is accepted by its exact recipient in the same transaction as the first scope.
 insert into public.buildings(address,label,created_by_organization_id) values(btrim(address),req.label,req.organization_id) returning id into building;
 if nullif(btrim(entrance_code),'') is not null then insert into public.entrances(building_id,code) values(building,btrim(entrance_code)) returning id into entrance; end if;
 insert into public.management_units(building_id,entrance_id,mode,label) values(building,entrance,case when entrance is null then 'building' else 'entrance' end,req.label) returning id into scope;
 insert into public.management_assignments(scope_id,organization_id,valid_from) values(scope,req.organization_id,current_date);
 select id into member from public.organization_memberships where organization_id=req.organization_id and profile_id=req.target_profile_id and status='active'
 and valid_from<=now() and (valid_to is null or now()<valid_to);
 if member is null then insert into public.organization_memberships(organization_id,profile_id) values(req.organization_id,req.target_profile_id) returning id into member; end if;
 update public.profiles set status='active' where id=req.target_profile_id;
 insert into public.user_roles(profile_id,membership_id,scope_id,role_code,permissions) values(req.target_profile_id,member,scope,'manager',req.permissions);
 if not private.has_scope_permission(scope,'manage_registry') then raise exception 'Appointment invalid' using errcode='42501'; end if;
 update public.scope_setup_requests set status='fulfilled',scope_id=scope,revision=revision+1 where id=request_id;
 insert into public.audit_events(scope_id,organization_id,actor_profile_id,action,target_kind,target_id,safe_delta)
 values(scope,req.organization_id,private.actor(),'complete_scope_setup','scope',scope,jsonb_build_object('appointment_request',request_id,'issuer',req.issuer_profile_id));
 return scope;
end $$;

-- Close the old org-admin-only physical write path, including direct calls to its private implementation.
revoke all on function public.create_management_context(uuid,text,text,text),private.create_management_context(uuid,text,text,text) from public,anon,authenticated;

create function private.organization_staff(org uuid) returns table(role_id uuid,profile_id uuid,display_name text,role_code text,scope_id uuid,permissions text[],valid_from timestamptz,valid_to timestamptz) language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_org_admin(org) then raise exception 'Forbidden' using errcode='42501'; end if;
 return query select r.id,p.id,p.display_name,r.role_code,r.scope_id,r.permissions,r.valid_from,r.valid_to
 from public.user_roles r join public.organization_memberships m on m.id=r.membership_id join public.profiles p on p.id=r.profile_id
 where m.organization_id=org order by r.valid_from desc;
end $$;
create function public.organization_staff(org uuid) returns table(role_id uuid,profile_id uuid,display_name text,role_code text,scope_id uuid,permissions text[],valid_from timestamptz,valid_to timestamptz) language sql stable security invoker set search_path='' as $$select * from private.organization_staff(org)$$;

revoke all on function private.org_admin_profile(uuid,uuid),private.request_scope_setup(uuid,uuid,text),private.revoke_scope_setup(uuid,integer),private.complete_scope_setup(uuid,text,text),private.organization_staff(uuid) from public,anon,authenticated;
grant execute on function private.request_scope_setup(uuid,uuid,text),private.revoke_scope_setup(uuid,integer),private.organization_staff(uuid) to authenticated;
revoke all on function public.request_scope_setup(uuid,uuid,text),public.revoke_scope_setup(uuid,integer),public.organization_staff(uuid) from public,anon,authenticated;
grant execute on function public.request_scope_setup(uuid,uuid,text),public.revoke_scope_setup(uuid,integer),public.organization_staff(uuid) to authenticated;
