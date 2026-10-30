-- DB-C/2: staff registry facts only. No account links, financial parties or debt transfer.
create table public.ownership_periods (
 id uuid primary key default gen_random_uuid(), scope_id uuid not null references public.management_units,
 unit_id uuid not null references public.units, unit_scope_period_id uuid not null,
 person_id uuid not null, person_label text not null, person_revision integer not null,
 ownership_fraction numeric(12,10) not null check(ownership_fraction>0 and ownership_fraction<=1),
 valid_from date not null check(valid_from between date '0001-01-01' and date '9999-12-31'),
 valid_to date check(valid_to between date '0001-01-01' and date '9999-12-31' and valid_to>valid_from),
 source_kind text not null check(source_kind in ('declaration','document')),
 source_reference text not null check(length(btrim(source_reference)) between 1 and 200), known_from date not null,
 history_note text not null check(length(btrim(history_note)) between 1 and 300), field_evidence jsonb not null,
 recorded_by uuid not null references public.profiles, recorded_at timestamptz not null default now(),
 verification_status text not null default 'needs_review' check(verification_status in ('needs_review','verified')),
 verified_by uuid references public.profiles, verified_at timestamptz, verification_note text,
 record_state text not null default 'current' check(record_state in ('current','superseded','voided')),
 retired_by uuid references public.profiles, retired_at timestamptz, retirement_note text,retirement_evidence jsonb,
 replaces_id uuid, unique(scope_id,id), unique(replaces_id),
 foreign key(scope_id,person_id) references public.persons(scope_id,id),
 foreign key(scope_id,unit_scope_period_id) references public.unit_scope_periods(scope_id,id),
 foreign key(scope_id,replaces_id) references public.ownership_periods(scope_id,id),
 check(replaces_id is null or replaces_id<>id),
 check((verification_status='needs_review' and verified_by is null and verified_at is null and verification_note is null)
  or (verification_status='verified' and verified_by is not null and verified_at is not null and length(btrim(verification_note)) between 1 and 300)),
 check((record_state='current' and retired_by is null and retired_at is null and retirement_note is null and retirement_evidence is null)
  or (record_state<>'current' and retired_by is not null and retired_at is not null and length(btrim(retirement_note)) between 1 and 300 and retirement_evidence is not null)),
 exclude using gist(scope_id with =,unit_id with =,person_id with =,daterange(valid_from,valid_to,'[)') with &&) where(record_state='current')
);
create index ownership_unit_idx on public.ownership_periods(scope_id,unit_id,valid_from);
create index ownership_person_idx on public.ownership_periods(scope_id,person_id);
create index ownership_parent_idx on public.ownership_periods(scope_id,unit_scope_period_id);
create index ownership_recorder_idx on public.ownership_periods(recorded_by);
create index ownership_verifier_idx on public.ownership_periods(verified_by);
create index ownership_retirer_idx on public.ownership_periods(retired_by);
create table public.ownership_set_reviews (
 id uuid primary key default gen_random_uuid(),scope_id uuid not null references public.management_units,
 unit_id uuid not null references public.units,as_of date not null, fingerprint text not null,
 record_ids uuid[] not null,reviewed_by uuid not null references public.profiles,
 reviewed_at timestamptz not null default now(),note text not null check(length(btrim(note)) between 1 and 300)
);
create index ownership_reviews_unit_idx on public.ownership_set_reviews(scope_id,unit_id,as_of,reviewed_at desc);
create index ownership_reviews_actor_idx on public.ownership_set_reviews(reviewed_by);
create table private.ownership_batches (
 scope_id uuid not null references public.management_units,request_key uuid not null,unit_id uuid not null references public.units,
 actor_id uuid not null references public.profiles,payload jsonb not null,result_ids uuid[] not null,
 recorded_at timestamptz not null default now(),primary key(scope_id,request_key)
);
create index ownership_batches_unit_idx on private.ownership_batches(unit_id);
create index ownership_batches_actor_idx on private.ownership_batches(actor_id);
alter table public.ownership_periods enable row level security;
alter table public.ownership_set_reviews enable row level security;
alter table private.ownership_batches enable row level security;
revoke all on public.ownership_periods,public.ownership_set_reviews,private.ownership_batches from public,anon,authenticated;
grant select on public.ownership_periods,public.ownership_set_reviews to authenticated;
create policy ownership_read on public.ownership_periods for select to authenticated using(private.has_scope_permission(scope_id,'read_registry'));
create policy ownership_review_read on public.ownership_set_reviews for select to authenticated using(private.has_scope_permission(scope_id,'read_registry'));

create function private.guard_ownership_facts() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Ownership history cannot be deleted' using errcode='42501'; end if;
 if tg_op='UPDATE' then
  if (to_jsonb(new)-array['verification_status','verified_by','verified_at','verification_note','record_state','retired_by','retired_at','retirement_note','retirement_evidence'])
   is distinct from (to_jsonb(old)-array['verification_status','verified_by','verified_at','verification_note','record_state','retired_by','retired_at','retirement_note','retirement_evidence'])
   or old.record_state<>'current' then raise exception 'Ownership facts are immutable' using errcode='23514'; end if;
 else
  if not exists(select 1 from public.unit_scope_periods p where p.id=new.unit_scope_period_id and p.scope_id=new.scope_id
   and p.unit_id=new.unit_id and daterange(p.valid_from,p.valid_to,'[)') @> daterange(new.valid_from,new.valid_to,'[)')) then
   raise exception 'Ownership period outside recorded unit scope' using errcode='23514'; end if;
 end if;
 return new;
end $$;
create trigger guard_ownership before insert or update or delete on public.ownership_periods for each row execute function private.guard_ownership_facts();

create function private.apply_ownership_changes(scope uuid,unit uuid,request_key uuid,changes jsonb,
 reason text,source_kind text,source_reference text,known_from date,history_note text) returns uuid[]
language plpgsql security definer set search_path='' as $$
declare actor uuid; saved private.ownership_batches; packet jsonb; item jsonb; old public.ownership_periods;
 person public.persons; fraction numeric; starts date; ends date; parent uuid; result uuid[]:='{}'; created uuid; target uuid;
begin
 if not private.has_scope_permission(scope,'manage_registry') then raise exception 'Forbidden' using errcode='42501'; end if;
 actor:=private.actor();
 if not exists(select 1 from public.unit_scope_periods p where p.scope_id=scope and p.unit_id=unit) then raise exception 'Unit unavailable' using errcode='42501'; end if;
 perform 1 from public.units u where u.id=unit for update;
 packet:=jsonb_build_object('changes',changes,'reason',reason,'source_kind',source_kind,'source_reference',source_reference,'known_from',known_from,'history_note',history_note);
 select * into saved from private.ownership_batches b where b.scope_id=scope and b.request_key=apply_ownership_changes.request_key;
 if found then
  if saved.unit_id<>unit or saved.actor_id<>actor or saved.payload<>packet then raise exception 'Request key payload differs' using errcode='23514'; end if;
  return saved.result_ids;
 end if;
 perform private.check_provenance(source_kind,source_reference,known_from);
 if request_key is null or reason is null or length(btrim(reason)) not between 1 and 300
 or history_note is null or length(btrim(history_note)) not between 1 and 300
 or jsonb_typeof(changes) is distinct from 'array' then raise exception 'Invalid ownership packet' using errcode='23514'; end if;
 if jsonb_array_length(changes) not between 1 and 20 then raise exception 'Batch must contain 1..20 changes' using errcode='23514'; end if;
 if (select count(*) from jsonb_array_elements(changes) x where nullif(x->>'target','') is not null)
  <> (select count(distinct x->>'target') from jsonb_array_elements(changes) x where nullif(x->>'target','') is not null) then
  raise exception 'Repeated correction target' using errcode='23514'; end if;
 -- Retire all corrected facts first. A later failure rolls back the entire batch.
 for item in select value from jsonb_array_elements(changes) loop
  if jsonb_typeof(item)<>'object' or item-array['target','person_id','fraction','valid_from','valid_to','void']<>'{}'::jsonb
   or (item ? 'void' and jsonb_typeof(item->'void')<>'boolean') then raise exception 'Invalid change fields' using errcode='23514'; end if;
  target:=nullif(item->>'target','')::uuid;
  if target is not null then
   select * into old from public.ownership_periods p where p.id=target and p.scope_id=scope and p.unit_id=unit and p.record_state='current' for update;
   if not found then raise exception 'Ownership target unavailable or stale' using errcode='42501'; end if;
   update public.ownership_periods p set record_state=case when coalesce((item->>'void')::boolean,false) then 'voided' else 'superseded' end,
    retired_by=actor,retired_at=now(),retirement_note=btrim(reason),retirement_evidence=packet-'changes' where p.id=target;
  elsif coalesce((item->>'void')::boolean,false) then raise exception 'Void requires target' using errcode='23514'; end if;
 end loop;
 for item in select value from jsonb_array_elements(changes) loop
  if coalesce((item->>'void')::boolean,false) then continue; end if;
  if item->>'fraction' is null or item->>'fraction' !~ '^[01](\.[0-9]{1,10})?$'
   or item->>'valid_from' is null or item->>'valid_from' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   or (nullif(item->>'valid_to','') is not null and item->>'valid_to' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then
   raise exception 'Exact decimal fraction and ISO dates required' using errcode='23514'; end if;
  fraction:=(item->>'fraction')::numeric; starts:=(item->>'valid_from')::date; ends:=nullif(item->>'valid_to','')::date;
  select * into person from public.persons p where p.id=(item->>'person_id')::uuid and p.scope_id=scope;
  if not found then raise exception 'Person unavailable' using errcode='42501'; end if;
  select p.id into parent from public.unit_scope_periods p where p.scope_id=scope and p.unit_id=unit
   and daterange(p.valid_from,p.valid_to,'[)') @> daterange(starts,ends,'[)');
  if parent is null then raise exception 'Ownership period outside recorded unit scope' using errcode='23514'; end if;
  insert into public.ownership_periods(scope_id,unit_id,unit_scope_period_id,person_id,person_label,person_revision,
   ownership_fraction,valid_from,valid_to,source_kind,source_reference,known_from,history_note,field_evidence,recorded_by,replaces_id)
  values(scope,unit,parent,person.id,person.display_name,person.revision,fraction,starts,ends,source_kind,btrim(source_reference),known_from,btrim(history_note),
   jsonb_build_object('fields',array['unit_id','person_id','ownership_fraction','valid_from','valid_to'],
    'source_kind',source_kind,'source_reference',btrim(source_reference),'known_from',known_from,'history_note',btrim(history_note)),actor,nullif(item->>'target','')::uuid)
   returning id into created;
  result:=array_append(result,created);
 end loop;
 -- Unit lock serializes competing batches. Check EVERY start boundary, including future segments.
 if exists(select 1 from public.ownership_periods p where p.scope_id=scope and p.unit_id=unit and p.record_state='current'
  and (select sum(q.ownership_fraction) from public.ownership_periods q where q.scope_id=scope and q.unit_id=unit and q.record_state='current'
   and daterange(q.valid_from,q.valid_to,'[)') @> p.valid_from)>1) then raise exception 'Ownership total exceeds one' using errcode='23514'; end if;
 insert into private.ownership_batches(scope_id,request_key,unit_id,actor_id,payload,result_ids) values(scope,request_key,unit,actor,packet,result);
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,safe_delta)
 values(scope,actor,'ownership_batch','unit',unit,jsonb_build_object('request_key',request_key,'created_ids',result));
 return result;
end $$;
create function public.apply_ownership_changes(scope uuid,unit uuid,request_key uuid,changes jsonb,reason text,
 source_kind text,source_reference text,known_from date,history_note text) returns uuid[] language sql security invoker set search_path='' as $$
 select private.apply_ownership_changes(scope,unit,request_key,changes,reason,source_kind,source_reference,known_from,history_note)
$$;

create function private.ownership_fingerprint(scope uuid,unit uuid,as_of date) returns text language sql stable set search_path='' as $$
 select md5(coalesce(jsonb_agg(jsonb_build_array(p.id,p.verification_status,p.verified_at) order by p.id)::text,'[]'))
 from public.ownership_periods p where p.scope_id=scope and p.unit_id=unit and p.record_state='current' and daterange(p.valid_from,p.valid_to,'[)') @> as_of
$$;
create function private.review_ownership(scope uuid,unit uuid,target uuid,as_of date,note text) returns void language plpgsql security definer set search_path='' as $$
declare ids uuid[]; total numeric; pending integer;
begin
 if not private.has_scope_permission(scope,'manage_registry') then raise exception 'Forbidden' using errcode='42501'; end if;
 if note is null or length(btrim(note)) not between 1 and 300 then raise exception 'Review reason required' using errcode='23514'; end if;
 if not exists(select 1 from public.unit_scope_periods p where p.scope_id=scope and p.unit_id=unit) then raise exception 'Unit unavailable' using errcode='42501'; end if;
 perform 1 from public.units u where u.id=unit for update;
 if target is not null then
  update public.ownership_periods p set verification_status='verified',verified_by=private.actor(),verified_at=now(),verification_note=btrim(note)
   where p.id=target and p.scope_id=scope and p.unit_id=unit and p.record_state='current';
  if not found then raise exception 'Ownership target unavailable or stale' using errcode='42501'; end if;
 else
  select array_agg(p.id order by p.id),sum(p.ownership_fraction),count(*) filter(where p.verification_status<>'verified') into ids,total,pending
  from public.ownership_periods p where p.scope_id=scope and p.unit_id=unit and p.record_state='current' and daterange(p.valid_from,p.valid_to,'[)') @> as_of;
  if total is distinct from 1::numeric or pending<>0 then raise exception 'Complete reviewed set with exact total one required' using errcode='23514'; end if;
  insert into public.ownership_set_reviews(scope_id,unit_id,as_of,fingerprint,record_ids,reviewed_by,note)
   values(scope,unit,as_of,private.ownership_fingerprint(scope,unit,as_of),ids,private.actor(),btrim(note));
 end if;
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id)
 values(scope,private.actor(),case when target is null then 'review_ownership_set' else 'review_ownership_row' end,'unit',unit);
end $$;
create function public.review_ownership(scope uuid,unit uuid,target uuid,as_of date,note text) returns void language sql security invoker set search_path='' as $$select private.review_ownership(scope,unit,target,as_of,note)$$;
create function private.read_ownership(scope uuid,unit uuid,as_of date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; total numeric; pending integer; review public.ownership_set_reviews;
begin
 if not private.has_scope_permission(scope,'read_registry') or not exists(select 1 from public.unit_scope_periods p where p.scope_id=scope and p.unit_id=unit)
 then raise exception 'Forbidden' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('ownership_fraction',p.ownership_fraction::text) order by p.valid_from,p.recorded_at,p.id),'[]') into rows
  from public.ownership_periods p where p.scope_id=scope and p.unit_id=unit;
 select coalesce(sum(p.ownership_fraction),0),count(*) filter(where p.verification_status<>'verified') into total,pending
  from public.ownership_periods p where p.scope_id=scope and p.unit_id=unit and p.record_state='current' and daterange(p.valid_from,p.valid_to,'[)') @> as_of;
 select * into review from public.ownership_set_reviews r where r.scope_id=scope and r.unit_id=unit and r.as_of=read_ownership.as_of
  and r.fingerprint=private.ownership_fingerprint(scope,unit,read_ownership.as_of) order by r.reviewed_at desc,r.id desc limit 1;
 return jsonb_build_object('records',rows,'total_fraction',total::text,'unreviewed_count',pending,'set_reviewed',review.id is not null,
  'reviewed_at',review.reviewed_at,'review_note',review.note,'as_of',as_of);
end $$;
create function public.read_ownership(scope uuid,unit uuid,as_of date) returns jsonb language sql security invoker set search_path='' as $$select private.read_ownership(scope,unit,as_of)$$;
revoke all on function private.guard_ownership_facts(),private.ownership_fingerprint(uuid,uuid,date) from public,anon,authenticated;
revoke all on function private.apply_ownership_changes(uuid,uuid,uuid,jsonb,text,text,text,date,text),public.apply_ownership_changes(uuid,uuid,uuid,jsonb,text,text,text,date,text),
 private.review_ownership(uuid,uuid,uuid,date,text),public.review_ownership(uuid,uuid,uuid,date,text),private.read_ownership(uuid,uuid,date),public.read_ownership(uuid,uuid,date) from public,anon,authenticated;
grant execute on function private.apply_ownership_changes(uuid,uuid,uuid,jsonb,text,text,text,date,text),public.apply_ownership_changes(uuid,uuid,uuid,jsonb,text,text,text,date,text),
 private.review_ownership(uuid,uuid,uuid,date,text),public.review_ownership(uuid,uuid,uuid,date,text),private.read_ownership(uuid,uuid,date),public.read_ownership(uuid,uuid,date) to authenticated;
