-- Generic staff packages cannot introduce verification without a recorded delegation reason.
create or replace function private.guard_owner_verifier_grant() returns trigger language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
 if 'verify_owner_access'=any(new.permissions) then
  if tg_op='INSERT' then raise exception 'Use explicit verifier delegation with a recorded reason' using errcode='42501'; end if;
  if new.role_code<>'manager' or not 'read_registry'=any(new.permissions) then raise exception 'Verifier requires scoped registry read' using errcode='23514'; end if;
  if tg_op='INSERT' or (to_jsonb(new)-array['valid_to']) is distinct from (to_jsonb(old)-array['valid_to']) then
   select m.organization_id into org from public.organization_memberships m where m.id=new.membership_id and m.profile_id=new.profile_id;
   if private.actor() is null or new.profile_id=private.actor() or not private.is_org_admin(org)
    or not exists(select 1 from public.management_assignments a where a.scope_id=new.scope_id and a.organization_id=org and a.status='active' and a.valid_from<=current_date and (a.valid_to is null or current_date<a.valid_to))
   then raise exception 'Verifier delegation forbidden' using errcode='42501'; end if;
  end if;
 end if;
 return new;
end $$;
