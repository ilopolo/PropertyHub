-- Recheck live Auth identity; neither metadata nor a deleted recipient can activate access.
create or replace function private.actor() returns uuid language sql stable security definer set search_path='' as $$
 select p.id from public.profiles p join auth.users u on u.id=p.auth_user_id
 where p.auth_user_id=(select auth.uid()) and p.status<>'disabled'
 and u.email_confirmed_at is not null and not u.is_anonymous
$$;
create or replace function private.is_platform_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_roles r join public.profiles p on p.id=r.profile_id
 where r.profile_id=private.actor() and p.status='active' and r.role_code='platform_admin'
 and 'manage_platform'=any(r.permissions) and r.valid_from<=now() and (r.valid_to is null or now()<r.valid_to))
$$;
create or replace function private.activate_organization(request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare req public.access_requests; org uuid; member uuid;
begin
 if not private.is_platform_admin() then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into req from public.access_requests where id=request_id for update;
 if not found then raise exception 'Request unavailable' using errcode='42501'; end if;
 if req.status='fulfilled' then return req.organization_id; end if;
 if req.status<>'pending' or not exists(select 1 from public.profiles p join auth.users u on u.id=p.auth_user_id
   where p.id=req.requester_profile_id and p.status<>'disabled' and u.email_confirmed_at is not null and not u.is_anonymous) then
   raise exception 'Request unavailable' using errcode='42501';
 end if;
 insert into public.organizations(name,organization_kind) values(req.request_payload->>'name',req.request_payload->>'organization_kind') returning id into org;
 insert into public.organization_memberships(organization_id,profile_id) values(org,req.requester_profile_id) returning id into member;
 insert into public.user_roles(profile_id,membership_id,role_code,permissions) values(req.requester_profile_id,member,'org_admin',array['manage_members']);
 update public.profiles set status='active' where id=req.requester_profile_id;
 update public.access_requests set status='fulfilled',organization_id=org,reviewed_by=private.actor(),reviewed_at=now(),revision=revision+1 where id=request_id;
 insert into public.audit_events(organization_id,actor_profile_id,action,target_kind,target_id) values(org,private.actor(),'activate_organization','organization',org);
 return org;
end $$;
revoke all on function private.actor(),private.is_platform_admin(),private.activate_organization(uuid) from public,anon,authenticated;
grant execute on function private.actor(),private.is_platform_admin(),private.activate_organization(uuid) to authenticated;
