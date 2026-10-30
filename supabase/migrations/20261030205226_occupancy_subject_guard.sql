-- Enforce physical resident identity and require fresh evidence after a linked person revision changes.
-- Existing physical/current-revision fingerprints remain identical; old facts/reviews are retained.
create or replace function private.guard_occupancy_facts() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Occupancy history cannot be deleted' using errcode='42501'; end if;
 if tg_op='UPDATE' then
  if (to_jsonb(new)-array['verification_status','verified_by','verified_at','verification_note','record_state','retired_by','retired_at','retirement_note','retirement_evidence'])
   is distinct from (to_jsonb(old)-array['verification_status','verified_by','verified_at','verification_note','record_state','retired_by','retired_at','retirement_note','retirement_evidence'])
   or old.record_state<>'current' then raise exception 'Occupancy facts are immutable' using errcode='23514'; end if;
 else
  if new.count_mode='individual' and not exists(select 1 from public.persons subject where subject.scope_id=new.scope_id and subject.id=new.person_id and subject.person_kind='physical' and subject.revision=new.person_revision) then
   raise exception 'Physical person with current evidence required' using errcode='23514'; end if;
  perform 1 from public.units u where u.id=new.unit_id for update;
  if new.record_state='current' and exists(select 1 from public.occupancy_periods p where p.scope_id=new.scope_id and p.unit_id=new.unit_id
   and p.record_state='current' and p.count_mode<>new.count_mode and daterange(p.valid_from,p.valid_to,'[)') && daterange(new.valid_from,new.valid_to,'[)')) then
   raise exception 'Aggregate and individual occupancy overlap' using errcode='23514'; end if;
  if not exists(select 1 from public.unit_scope_periods p where p.id=new.unit_scope_period_id and p.scope_id=new.scope_id
   and p.unit_id=new.unit_id and daterange(p.valid_from,p.valid_to,'[)') @> daterange(new.valid_from,new.valid_to,'[)')) then
   raise exception 'Occupancy period outside recorded unit scope' using errcode='23514'; end if;
 end if;
 return new;
end $$;

create or replace function private.occupancy_fingerprint(scope uuid,unit uuid,as_of date) returns text language sql stable set search_path='' as $$
 select md5(coalesce(jsonb_agg(jsonb_build_array(p.id,case when (p.count_mode='aggregate' or exists(select 1 from public.persons subject where subject.scope_id=p.scope_id and subject.id=p.person_id and subject.person_kind='physical' and subject.revision=p.person_revision)) then p.verification_status else 'subject_conflict' end,p.verified_at) order by p.id)::text,'[]'))
 from public.occupancy_periods p where p.scope_id=scope and p.unit_id=unit and p.record_state='current' and daterange(p.valid_from,p.valid_to,'[)') @> as_of
$$;

create or replace function private.review_occupancy(scope uuid,unit uuid,target uuid,as_of date,note text) returns void language plpgsql security definer set search_path='' as $$
declare ids uuid[]; unknowns integer; pending integer; quantity numeric;
begin
 if not private.has_scope_permission(scope,'manage_registry') then raise exception 'Forbidden' using errcode='42501'; end if;
 if note is null or length(btrim(note)) not between 1 and 300 then raise exception 'Review reason required' using errcode='23514'; end if;
 if not exists(select 1 from public.unit_scope_periods p where p.scope_id=scope and p.unit_id=unit) then raise exception 'Unit unavailable' using errcode='42501'; end if;
 perform 1 from public.units u where u.id=unit for update;
 if target is not null then
  select p.household_units into quantity from public.occupancy_periods p where p.id=target and p.scope_id=scope and p.unit_id=unit and p.record_state='current';
  if not found then raise exception 'Occupancy target unavailable or stale' using errcode='42501'; end if;
  if quantity is null then raise exception 'Unknown count cannot be verified' using errcode='23514'; end if;
  if exists(select 1 from public.occupancy_periods p where p.id=target and p.scope_id=scope and p.unit_id=unit and not (p.count_mode='aggregate' or exists(select 1 from public.persons subject where subject.scope_id=p.scope_id and subject.id=p.person_id and subject.person_kind='physical' and subject.revision=p.person_revision))) then
   raise exception 'Subject evidence changed; replace occupancy first' using errcode='23514'; end if;
  update public.occupancy_periods p set verification_status='verified',verified_by=private.actor(),verified_at=now(),verification_note=btrim(note)
   where p.id=target and p.scope_id=scope and p.unit_id=unit and p.record_state='current';
  if not found then raise exception 'Occupancy target unavailable or stale' using errcode='42501'; end if;
 else
  select array_agg(p.id order by p.id),count(*) filter(where p.household_units is null),count(*) filter(where p.verification_status<>'verified' or not (p.count_mode='aggregate' or exists(select 1 from public.persons subject where subject.scope_id=p.scope_id and subject.id=p.person_id and subject.person_kind='physical' and subject.revision=p.person_revision))) into ids,unknowns,pending
  from public.occupancy_periods p where p.scope_id=scope and p.unit_id=unit and p.record_state='current' and daterange(p.valid_from,p.valid_to,'[)') @> as_of;
  if coalesce(array_length(ids,1),0)=0 or unknowns<>0 or pending<>0 then raise exception 'Known count and reviewed complete set required' using errcode='23514'; end if;
  insert into public.occupancy_set_reviews(scope_id,unit_id,as_of,fingerprint,record_ids,reviewed_by,note)
   values(scope,unit,as_of,private.occupancy_fingerprint(scope,unit,as_of),ids,private.actor(),btrim(note));
 end if;
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id)
 values(scope,private.actor(),case when target is null then 'review_occupancy_set' else 'review_occupancy_row' end,'unit',unit);
end $$;

create or replace function private.read_occupancy(scope uuid,unit uuid,as_of date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; total numeric; pending integer; unknowns integer; applicable integer; conflicts integer; review public.occupancy_set_reviews;
begin
 if not private.has_scope_permission(scope,'read_registry') or not exists(select 1 from public.unit_scope_periods p where p.scope_id=scope and p.unit_id=unit)
 then raise exception 'Forbidden' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('household_units',p.household_units::text,'subject_eligible',(p.count_mode='aggregate' or exists(select 1 from public.persons subject where subject.scope_id=p.scope_id and subject.id=p.person_id and subject.person_kind='physical' and subject.revision=p.person_revision))) order by p.valid_from,p.recorded_at,p.id),'[]') into rows
  from public.occupancy_periods p where p.scope_id=scope and p.unit_id=unit;
 select coalesce(sum(p.household_units),0),count(*) filter(where p.verification_status<>'verified' or not (p.count_mode='aggregate' or exists(select 1 from public.persons subject where subject.scope_id=p.scope_id and subject.id=p.person_id and subject.person_kind='physical' and subject.revision=p.person_revision))),count(*) filter(where p.household_units is null),count(*),count(*) filter(where not (p.count_mode='aggregate' or exists(select 1 from public.persons subject where subject.scope_id=p.scope_id and subject.id=p.person_id and subject.person_kind='physical' and subject.revision=p.person_revision))) into total,pending,unknowns,applicable,conflicts
  from public.occupancy_periods p where p.scope_id=scope and p.unit_id=unit and p.record_state='current' and daterange(p.valid_from,p.valid_to,'[)') @> as_of;
 select * into review from public.occupancy_set_reviews r where r.scope_id=scope and r.unit_id=unit and r.as_of=read_occupancy.as_of
  and r.fingerprint=private.occupancy_fingerprint(scope,unit,read_occupancy.as_of) order by r.reviewed_at desc,r.id desc limit 1;
 return jsonb_build_object('records',rows,'known_units',total::text,'count_value',case when unknowns>0 or applicable=0 then null else total::text end,'unknown_count',unknowns,'applicable_count',applicable,'subject_conflict_count',conflicts,'unreviewed_count',pending,'set_reviewed',review.id is not null,
  'reviewed_at',review.reviewed_at,'review_note',review.note,'as_of',as_of);
end $$;
