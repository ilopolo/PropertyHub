-- Additive owner identity verification; existing live RPC signatures/default grants are unchanged.
insert into public.role_permissions(role_code,permission_code) values('manager','verify_owner_access');

create function private.guard_owner_verifier_grant() returns trigger language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
 if 'verify_owner_access'=any(new.permissions) then
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
create trigger guard_owner_verifier_grant before insert or update on public.user_roles for each row execute function private.guard_owner_verifier_grant();

create function private.set_owner_verifier(role_id uuid,enabled boolean,note text) returns void language plpgsql security definer set search_path='' as $$
declare r public.user_roles; org uuid;
begin
 if enabled is null or note is null or length(btrim(note)) not between 1 and 300 then raise exception 'Delegation reason required' using errcode='23514'; end if;
 select * into r from public.user_roles where id=role_id for update;
 select organization_id into org from public.organization_memberships where id=r.membership_id;
 if r.id is null or r.role_code<>'manager' or not private.is_org_admin(org) or r.profile_id=private.actor()
  or not 'read_registry'=any(r.permissions) or r.valid_from>now() or (r.valid_to is not null and now()>=r.valid_to)
  or not exists(select 1 from public.organization_memberships m where m.id=r.membership_id and m.status='active' and m.valid_from<=now() and (m.valid_to is null or now()<m.valid_to))
  or not exists(select 1 from public.profiles p join auth.users u on u.id=p.auth_user_id where p.id=r.profile_id and p.status='active' and u.email_confirmed_at is not null and not u.is_anonymous)
  or not exists(select 1 from public.management_assignments a join public.management_units s on s.id=a.scope_id where a.scope_id=r.scope_id and a.organization_id=org and a.status='active' and s.status='active' and a.valid_from<=current_date and (a.valid_to is null or current_date<a.valid_to))
 then raise exception 'Verifier delegation forbidden' using errcode='42501'; end if;
 if enabled=('verify_owner_access'=any(r.permissions)) then return; end if;
 update public.user_roles set permissions=case when enabled then array_append(r.permissions,'verify_owner_access') else array_remove(r.permissions,'verify_owner_access') end where id=r.id;
 insert into public.audit_events(scope_id,organization_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta)
 values(r.scope_id,org,private.actor(),case when enabled then 'grant_owner_verifier' else 'revoke_owner_verifier' end,'user_role',r.id,btrim(note),jsonb_build_object('permission','verify_owner_access'));
end $$;
create function public.set_owner_verifier(role_id uuid,enabled boolean,note text) returns void language sql security invoker set search_path='' as $$ select private.set_owner_verifier(role_id,enabled,note) $$;

create function private.can_verify_owner(scope uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_scope_permission(scope,'verify_owner_access') and private.has_scope_permission(scope,'read_registry')
$$;

create table public.account_person_links (
 id uuid primary key default gen_random_uuid(),scope_id uuid not null references public.management_units,
 person_id uuid not null,profile_id uuid not null references public.profiles,person_revision integer not null check(person_revision>0),
 verified_by uuid not null references public.profiles,verified_at timestamptz not null default now(),
 evidence_reference text not null check(length(btrim(evidence_reference)) between 1 and 200),
 verification_note text not null check(length(btrim(verification_note)) between 1 and 300),
 request_key uuid not null,revoked_by uuid references public.profiles,revoked_at timestamptz,revocation_note text,revocation_evidence text,
 foreign key(scope_id,person_id) references public.persons(scope_id,id), unique(scope_id,request_key),
 check(profile_id<>verified_by),
 check((revoked_at is null and revoked_by is null and revocation_note is null and revocation_evidence is null)
  or (revoked_at is not null and revoked_by is not null and length(btrim(revocation_note)) between 1 and 300 and length(btrim(revocation_evidence)) between 1 and 200))
);
create unique index person_active_profile_unique on public.account_person_links(scope_id,person_id) where revoked_at is null;
create index owner_link_profile_idx on public.account_person_links(profile_id,scope_id) where revoked_at is null;
create index owner_link_person_idx on public.account_person_links(scope_id,person_id);
create index owner_link_verifier_idx on public.account_person_links(verified_by);
create index owner_link_revoker_idx on public.account_person_links(revoked_by);
alter table public.account_person_links enable row level security;
revoke all on public.account_person_links from public,anon,authenticated;
grant select on public.account_person_links to authenticated;
create policy owner_link_staff_read on public.account_person_links for select to authenticated using(private.can_verify_owner(scope_id));

create function private.guard_owner_link_history() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or old.revoked_at is not null then raise exception 'Owner link history is immutable' using errcode='42501'; end if;
 if (to_jsonb(new)-array['revoked_by','revoked_at','revocation_note','revocation_evidence']) is distinct from (to_jsonb(old)-array['revoked_by','revoked_at','revocation_note','revocation_evidence']) or new.revoked_at is null
 then raise exception 'Only recorded revocation is allowed' using errcode='23514'; end if;
 return new;
end $$;
create trigger guard_owner_link_history before update or delete on public.account_person_links for each row execute function private.guard_owner_link_history();

create function private.confirm_owner_link(scope uuid,target_auth_user_id uuid,person uuid,expected_person_revision integer,evidence text,note text,request_key uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid; p public.persons; saved public.account_person_links; result uuid; actor uuid;
begin
 actor:=private.actor();
 if not coalesce(private.can_verify_owner(scope),false) then raise exception 'Owner verification forbidden' using errcode='42501'; end if;
 if request_key is null or evidence is null or length(btrim(evidence)) not between 1 and 200 or note is null or length(btrim(note)) not between 1 and 300 then raise exception 'Verification evidence required' using errcode='23514'; end if;
 select pr.id into target from public.profiles pr join auth.users u on u.id=pr.auth_user_id where u.id=target_auth_user_id and u.email_confirmed_at is not null and not u.is_anonymous and pr.status<>'disabled' for update of pr;
 if target is null or target=actor then raise exception 'Recipient unavailable or self verification' using errcode='42501'; end if;
 select * into p from public.persons where id=person and scope_id=scope for update;
 if not found then raise exception 'Scoped person unavailable' using errcode='42501'; end if;
 select * into saved from public.account_person_links l where l.scope_id=scope and l.request_key=confirm_owner_link.request_key;
 if saved.id is not null then
  if saved.profile_id<>target or saved.person_id<>person or saved.person_revision is distinct from expected_person_revision or saved.verified_by<>actor or saved.evidence_reference<>btrim(evidence) or saved.verification_note<>btrim(note) then raise exception 'Request key payload differs' using errcode='23514'; end if;
  return saved.id; -- Replaying a retired request never reactivates access.
 end if;
 if p.status<>'active' or p.verification_status<>'verified' or p.revision is distinct from expected_person_revision then raise exception 'Current verified person required' using errcode='23514'; end if;
 if exists(select 1 from public.account_person_links l where l.scope_id=scope and l.person_id=person and l.profile_id=actor and l.revoked_at is null) then raise exception 'Own linked identity cannot be reassigned' using errcode='42501'; end if;
 if not exists(select 1 from public.ownership_periods o join public.unit_scope_periods up on up.id=o.unit_scope_period_id and up.scope_id=o.scope_id and up.unit_id=o.unit_id
  where o.scope_id=scope and o.person_id=person and o.record_state='current' and o.verification_status='verified'
   and daterange(o.valid_from,o.valid_to,'[)') @> (now() at time zone 'Europe/Sofia')::date
   and daterange(up.valid_from,up.valid_to,'[)') @> (now() at time zone 'Europe/Sofia')::date)
 then raise exception 'Verified current ownership required' using errcode='23514'; end if;
 insert into public.account_person_links(scope_id,person_id,profile_id,person_revision,verified_by,evidence_reference,verification_note,request_key)
 values(scope,person,target,p.revision,actor,btrim(evidence),btrim(note),request_key) returning id into result;
 update public.profiles set status='active' where id=target and status='pending';
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason) values(scope,actor,'confirm_owner_link','account_person_link',result,btrim(note));
 return result;
end $$;
create function public.confirm_owner_link(scope uuid,target_auth_user_id uuid,person uuid,expected_person_revision integer,evidence text,note text,request_key uuid) returns uuid language sql security invoker set search_path='' as $$ select private.confirm_owner_link(scope,target_auth_user_id,person,expected_person_revision,evidence,note,request_key) $$;

create function private.revoke_owner_link(scope uuid,link_id uuid,evidence text,note text) returns void language plpgsql security definer set search_path='' as $$
declare l public.account_person_links;
begin
 if not coalesce(private.can_verify_owner(scope),false) then raise exception 'Owner revocation forbidden' using errcode='42501'; end if;
 if evidence is null or length(btrim(evidence)) not between 1 and 200 or note is null or length(btrim(note)) not between 1 and 300 then raise exception 'Revocation evidence required' using errcode='23514'; end if;
 select * into l from public.account_person_links where id=link_id and scope_id=scope for update;
 if not found or l.profile_id=private.actor() then raise exception 'Link unavailable or self action' using errcode='42501'; end if;
 if l.revoked_at is not null then return; end if;
 update public.account_person_links set revoked_by=private.actor(),revoked_at=clock_timestamp(),revocation_note=btrim(note),revocation_evidence=btrim(evidence) where id=l.id;
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason) values(scope,private.actor(),'revoke_owner_link','account_person_link',l.id,btrim(note));
end $$;
create function public.revoke_owner_link(scope uuid,link_id uuid,evidence text,note text) returns void language sql security invoker set search_path='' as $$ select private.revoke_owner_link(scope,link_id,evidence,note) $$;

create function private.owner_access_records(scope uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(private.can_verify_owner(scope),false) then raise exception 'Owner verification forbidden' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('person_label',p.display_name) order by l.verified_at,l.id),'[]') from public.account_person_links l join public.persons p on p.id=l.person_id and p.scope_id=l.scope_id where l.scope_id=scope);
end $$;
create function public.owner_access_records(scope uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.owner_access_records(scope) $$;

create function private.my_owned_units() returns table(unit_id uuid,unit_number text,unit_type text,scope_id uuid,scope_label text,building_label text,entrance_code text) language sql stable security definer set search_path='' as $$
 select distinct u.id,u.unit_number,u.unit_type,s.id,s.label,coalesce(b.label,b.address),e.code
 from public.account_person_links l join public.persons p on p.id=l.person_id and p.scope_id=l.scope_id and p.revision=l.person_revision and p.status='active' and p.verification_status='verified'
 join public.ownership_periods o on o.person_id=p.id and o.scope_id=p.scope_id and o.record_state='current' and o.verification_status='verified'
 join public.units u on u.id=o.unit_id and u.archived_at is null
 join public.unit_scope_periods up on up.id=o.unit_scope_period_id and up.unit_id=u.id and up.scope_id=o.scope_id
 join public.management_units s on s.id=l.scope_id and s.status='active'
 join public.buildings b on b.id=u.building_id and b.archived_at is null
 left join public.entrances e on e.id=u.entrance_id and e.building_id=u.building_id
 where l.profile_id=private.actor() and l.revoked_at is null
 and daterange(o.valid_from,o.valid_to,'[)') @> (now() at time zone 'Europe/Sofia')::date
 and daterange(up.valid_from,up.valid_to,'[)') @> (now() at time zone 'Europe/Sofia')::date
 and exists(select 1 from public.profiles pr where pr.id=l.profile_id and pr.status='active')
 and exists(select 1 from public.management_assignments a join public.organizations org on org.id=a.organization_id and org.status='active' where a.scope_id=s.id and a.status='active' and a.valid_from<=(now() at time zone 'Europe/Sofia')::date and (a.valid_to is null or (now() at time zone 'Europe/Sofia')::date<a.valid_to))
 order by s.id,u.unit_number,u.id
$$;
create function public.my_owned_units() returns table(unit_id uuid,unit_number text,unit_type text,scope_id uuid,scope_label text,building_label text,entrance_code text) language sql stable security invoker set search_path='' as $$ select * from private.my_owned_units() $$;

revoke all on function private.guard_owner_verifier_grant(),private.guard_owner_link_history() from public,anon,authenticated;
revoke all on function private.can_verify_owner(uuid),private.set_owner_verifier(uuid,boolean,text),public.set_owner_verifier(uuid,boolean,text),
 private.confirm_owner_link(uuid,uuid,uuid,integer,text,text,uuid),public.confirm_owner_link(uuid,uuid,uuid,integer,text,text,uuid),
 private.revoke_owner_link(uuid,uuid,text,text),public.revoke_owner_link(uuid,uuid,text,text),private.owner_access_records(uuid),public.owner_access_records(uuid),private.my_owned_units(),public.my_owned_units() from public,anon,authenticated;
grant execute on function private.can_verify_owner(uuid),private.set_owner_verifier(uuid,boolean,text),public.set_owner_verifier(uuid,boolean,text),
 private.confirm_owner_link(uuid,uuid,uuid,integer,text,text,uuid),public.confirm_owner_link(uuid,uuid,uuid,integer,text,text,uuid),
 private.revoke_owner_link(uuid,uuid,text,text),public.revoke_owner_link(uuid,uuid,text,text),private.owner_access_records(uuid),public.owner_access_records(uuid),private.my_owned_units(),public.my_owned_units() to authenticated;
