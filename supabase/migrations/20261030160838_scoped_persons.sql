-- DB-C/1: staff-scoped persons, never accounts/owners or a global identity directory.
create table public.persons (
 id uuid primary key default gen_random_uuid(),
 scope_id uuid not null references public.management_units,
 person_kind text not null check(person_kind in ('physical','legal')),
 display_name text not null check(length(btrim(display_name)) between 1 and 160),
 contact_email text check(length(contact_email)<=254 and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 contact_phone text check(length(btrim(contact_phone)) between 1 and 40),
 status text not null check(status in ('active','inactive')),
 revision integer not null default 1 check(revision>0),
 source_kind text not null check(source_kind in ('declaration','document')),
 source_reference text not null check(length(btrim(source_reference)) between 1 and 200),
 known_from date not null,
 recorded_by uuid not null references public.profiles,
 recorded_at timestamptz not null default now(),
 field_evidence jsonb not null check(jsonb_typeof(field_evidence)='object'),
 verification_status text not null default 'needs_review' check(verification_status in ('needs_review','verified')),
 verified_by uuid references public.profiles,
 verified_at timestamptz,
 verification_note text check(length(btrim(verification_note)) between 1 and 300),
 unique(scope_id,id),
 constraint person_review check(
  (verification_status='needs_review' and verified_by is null and verified_at is null and verification_note is null)
  or (verification_status='verified' and verified_by is not null and verified_at is not null and verification_note is not null))
);
create index persons_scope_name_idx on public.persons(scope_id,display_name,id);
create index persons_recorder_idx on public.persons(recorded_by);
create index persons_verifier_idx on public.persons(verified_by);

-- Append-only full revisions: private, not an exposed PII/audit endpoint.
-- Each non-null field has explicit evidence; a replacement reasserts ALL fields from one packet.
create table private.person_revisions (
 person_id uuid not null references public.persons,
 revision integer not null,
 snapshot jsonb not null,
 captured_at timestamptz not null default now(),
 primary key(person_id,revision)
);
alter table public.persons enable row level security;
alter table private.person_revisions enable row level security;
revoke all on public.persons,private.person_revisions from public,anon,authenticated;
grant select on public.persons to authenticated;
create policy person_scope_read on public.persons for select to authenticated
 using(private.has_scope_permission(scope_id,'read_registry'));

create function private.save_scoped_person(scope uuid,target uuid,expected_revision integer,
 person_kind text,display_name text,contact_email text,contact_phone text,status text,
 source_kind text,source_reference text,known_from date) returns uuid
language plpgsql security definer set search_path='' as $$
declare old public.persons; result public.persons; fields jsonb; evidence jsonb; actor uuid;
begin
 if not private.has_scope_permission(scope,'manage_registry') then raise exception 'Forbidden' using errcode='42501'; end if;
 actor:=private.actor();
 perform private.check_provenance(source_kind,source_reference,known_from);
 if target is null then
  if expected_revision is distinct from 0 then raise exception 'Invalid initial revision' using errcode='23514'; end if;
 else
  select * into old from public.persons p where p.id=target and p.scope_id=scope for update;
  if not found then raise exception 'Person unavailable' using errcode='42501'; end if;
  if expected_revision is distinct from old.revision then raise exception 'Stale person revision' using errcode='23514'; end if;
 end if;
 fields:=jsonb_strip_nulls(jsonb_build_object('person_kind',person_kind,'display_name',btrim(display_name),
  'contact_email',nullif(btrim(contact_email),''),'contact_phone',nullif(btrim(contact_phone),''),'status',status));
 select jsonb_object_agg(k,jsonb_build_object('source_kind',source_kind,'source_reference',btrim(source_reference),
  'known_from',known_from,'recorded_by',actor,'recorded_at',now())) into evidence from jsonb_object_keys(fields) as k;
 if target is null then
  insert into public.persons(scope_id,person_kind,display_name,contact_email,contact_phone,status,
   source_kind,source_reference,known_from,recorded_by,field_evidence)
  values(scope,person_kind,btrim(display_name),nullif(btrim(contact_email),''),nullif(btrim(contact_phone),''),status,
   source_kind,btrim(source_reference),known_from,actor,evidence) returning * into result;
 else
  -- Snapshot before replacement includes any verified state. It cannot be rewritten by clients.
  insert into private.person_revisions(person_id,revision,snapshot) values(old.id,old.revision,to_jsonb(old));
  update public.persons p set person_kind=fields->>'person_kind',display_name=fields->>'display_name',
   contact_email=fields->>'contact_email',contact_phone=fields->>'contact_phone',status=fields->>'status',
   revision=p.revision+1,source_kind=save_scoped_person.source_kind,source_reference=btrim(save_scoped_person.source_reference),
   known_from=save_scoped_person.known_from,recorded_by=actor,recorded_at=now(),field_evidence=evidence,
   verification_status='needs_review',verified_by=null,verified_at=null,verification_note=null
  where p.id=target and p.scope_id=scope returning * into result;
 end if;
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,safe_delta)
 values(scope,actor,case when target is null then 'create_person' else 'replace_person' end,'person',result.id,
  jsonb_build_object('revision',result.revision));
 return result.id;
end $$;
create function public.save_scoped_person(scope uuid,target uuid,expected_revision integer,
 person_kind text,display_name text,contact_email text,contact_phone text,status text,
 source_kind text,source_reference text,known_from date) returns uuid
language sql security invoker set search_path='' as $$
 select private.save_scoped_person(scope,target,expected_revision,person_kind,display_name,contact_email,contact_phone,status,source_kind,source_reference,known_from)
$$;
create function private.verify_scoped_person(scope uuid,target uuid,expected_revision integer,note text) returns void
language plpgsql security definer set search_path='' as $$
declare p public.persons;
begin
 if not private.has_scope_permission(scope,'manage_registry') then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into p from public.persons where id=target and scope_id=scope for update;
 if not found then raise exception 'Person unavailable' using errcode='42501'; end if;
 if expected_revision is distinct from p.revision or note is null or length(btrim(note)) not between 1 and 300 then
  raise exception 'Revision and review reason required' using errcode='23514'; end if;
 update public.persons set verification_status='verified',verified_by=private.actor(),verified_at=now(),verification_note=btrim(note)
 where id=target;
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,safe_delta)
 values(scope,private.actor(),'verify_person','person',target,jsonb_build_object('revision',p.revision));
end $$;
create function public.verify_scoped_person(scope uuid,target uuid,expected_revision integer,note text) returns void
language sql security invoker set search_path='' as $$select private.verify_scoped_person(scope,target,expected_revision,note)$$;
revoke all on function private.save_scoped_person(uuid,uuid,integer,text,text,text,text,text,text,text,date),
 public.save_scoped_person(uuid,uuid,integer,text,text,text,text,text,text,text,date),
 private.verify_scoped_person(uuid,uuid,integer,text),public.verify_scoped_person(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function private.save_scoped_person(uuid,uuid,integer,text,text,text,text,text,text,text,date),
 public.save_scoped_person(uuid,uuid,integer,text,text,text,text,text,text,text,date),
 private.verify_scoped_person(uuid,uuid,integer,text),public.verify_scoped_person(uuid,uuid,integer,text) to authenticated;
