-- P26: one source packet covers the supplied values of a minimal record; NULL fields stay unknown.
-- A future mixed-source field edit must introduce field-level evidence before it is enabled.
do $$declare t text; begin
 foreach t in array array['buildings','entrances','management_units','management_assignments','units','unit_scope_periods'] loop
  execute format('alter table public.%I
   add column source_kind text not null default ''legacy_unknown'' check(source_kind in (''legacy_unknown'',''declaration'',''document'')),
   add column source_reference text check(length(btrim(source_reference)) between 1 and 200),
   add column known_from date,
   add column verification_status text not null default ''needs_review'' check(verification_status in (''needs_review'',''verified'')),
   add column recorded_by uuid references public.profiles,
   add column recorded_at timestamptz not null default now(),
   add column verified_by uuid references public.profiles,
   add column verified_at timestamptz,
   add column verification_note text check(length(btrim(verification_note)) between 1 and 300),
   add constraint provenance_packet check(source_kind=''legacy_unknown'' or (source_reference is not null and known_from is not null and recorded_by is not null)),
   add constraint provenance_review check((verification_status=''needs_review'' and verified_by is null and verified_at is null and verification_note is null)
    or (verification_status=''verified'' and source_kind<>''legacy_unknown'' and known_from is not null and verified_by is not null and verified_at is not null and verification_note is not null))',t);
  execute format('create index %I on public.%I(recorded_by)',t||'_recorder_idx',t);
  execute format('create index %I on public.%I(verified_by)',t||'_verifier_idx',t);
 end loop;
end $$;
-- recorded_at on old rows is migration time, not an assertion about when their facts became known.
create function private.check_provenance(source_kind text, source_reference text, known_from date) returns void language plpgsql set search_path='' as $$
begin
 if source_kind is null or source_kind not in ('declaration','document') or source_reference is null
 or length(btrim(source_reference)) not between 1 and 200 or known_from is null or known_from>current_date then
  raise exception 'Source and known-from date required' using errcode='23514';
 end if;
end $$;
create function private.stamp_provenance(target_table text,target uuid,kind text,reference text,known date) returns void language plpgsql security definer set search_path='' as $$
begin
 if target_table not in ('buildings','entrances','management_units','management_assignments','units','unit_scope_periods') then raise exception 'Invalid provenance target' using errcode='23514'; end if;
 perform private.check_provenance(kind,reference,known);
 execute format('update public.%I set source_kind=$1,source_reference=$2,known_from=$3,recorded_by=$4,recorded_at=now() where id=$5 and source_kind=''legacy_unknown''',target_table)
 using kind,btrim(reference),known,private.actor(),target;
end $$;

create function private.complete_scope_setup_with_source(request_id uuid,address text,entrance_code text,source_kind text,source_reference text,known_from date) returns uuid language plpgsql security definer set search_path='' as $$
declare scope uuid; s public.management_units; assignment uuid;
begin
 perform private.check_provenance(source_kind,source_reference,known_from);
 scope:=private.complete_scope_setup(request_id,address,entrance_code);
 select * into strict s from public.management_units where id=scope for update;
 -- A repeated acceptance must describe the same physical context and source, never silently overwrite it.
 if not exists(select 1 from public.buildings b where b.id=s.building_id and b.address=btrim(complete_scope_setup_with_source.address))
 or (select e.code from public.entrances e where e.id=s.entrance_id) is distinct from nullif(btrim(entrance_code),'')
 or (s.source_kind<>'legacy_unknown' and (s.source_kind<>source_kind or s.source_reference<>btrim(source_reference) or s.known_from<>known_from)) then
  raise exception 'Completed request differs' using errcode='23514';
 end if;
 perform private.stamp_provenance('buildings',s.building_id,source_kind,source_reference,known_from);
 if s.entrance_id is not null then perform private.stamp_provenance('entrances',s.entrance_id,source_kind,source_reference,known_from); end if;
 perform private.stamp_provenance('management_units',scope,source_kind,source_reference,known_from);
 select id into strict assignment from public.management_assignments where scope_id=scope;
 perform private.stamp_provenance('management_assignments',assignment,source_kind,source_reference,known_from);
 return scope;
end $$;
create function public.complete_scope_setup(request_id uuid,address text,entrance_code text,source_kind text,source_reference text,known_from date) returns uuid language sql security invoker set search_path='' as $$select private.complete_scope_setup_with_source(request_id,address,entrance_code,source_kind,source_reference,known_from)$$;

drop function public.create_unit(uuid,text,text,text,numeric);
drop function private.create_unit(uuid,text,text,text,numeric);
create function private.create_unit(scope uuid,unit_number text,unit_type text,floor text default null,area numeric default null,source_kind text default null,source_reference text default null,known_from date default null) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.management_units; result uuid; period uuid;
begin
 if not private.has_scope_permission(scope,'manage_registry') then raise exception 'Forbidden' using errcode='42501'; end if;
 perform private.check_provenance(source_kind,source_reference,known_from);
 select * into strict s from public.management_units where id=scope for update;
 insert into public.units(building_id,entrance_id,unit_number,unit_type,floor,area) values(s.building_id,s.entrance_id,btrim(unit_number),unit_type,nullif(btrim(floor),''),area) returning id into result;
 insert into public.unit_scope_periods(scope_id,unit_id,valid_from) values(scope,result,current_date) returning id into period;
 perform private.stamp_provenance('units',result,source_kind,source_reference,known_from);
 perform private.stamp_provenance('unit_scope_periods',period,source_kind,source_reference,known_from);
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id) values(scope,private.actor(),'create_unit','unit',result);
 return result;
end $$;
create function public.create_unit(scope uuid,unit_number text,unit_type text,floor text default null,area numeric default null,source_kind text default null,source_reference text default null,known_from date default null) returns uuid language sql security invoker set search_path='' as $$select private.create_unit(scope,unit_number,unit_type,floor,area,source_kind,source_reference,known_from)$$;

-- No client can declare a record verified through INSERT/UPDATE or a creation payload.
create function private.verify_registry_record(scope uuid,kind text,target uuid,note text) returns void language plpgsql security definer set search_path='' as $$
declare target_table text; allowed boolean; affected integer;
begin
 if not private.has_scope_permission(scope,'manage_registry') then raise exception 'Forbidden' using errcode='42501'; end if;
 if note is null or length(btrim(note)) not between 1 and 300 then raise exception 'Review note required' using errcode='23514'; end if;
 case kind
 when 'building' then target_table:='buildings'; select exists(select 1 from public.management_units s where s.id=scope and s.building_id=target) into allowed;
 when 'entrance' then target_table:='entrances'; select exists(select 1 from public.management_units s join public.entrances e on e.building_id=s.building_id where s.id=scope and e.id=target and (s.mode='building' or s.entrance_id=e.id)) into allowed;
 when 'scope' then target_table:='management_units'; allowed:=target=scope;
 when 'assignment' then target_table:='management_assignments'; select exists(select 1 from public.management_assignments a where a.id=target and a.scope_id=scope and a.organization_id in(select m.organization_id from public.organization_memberships m where m.profile_id=private.actor())) into allowed;
 when 'unit' then target_table:='units'; select exists(select 1 from public.unit_scope_periods p where p.unit_id=target and p.scope_id=scope and p.valid_from<=current_date and (p.valid_to is null or current_date<p.valid_to)) into allowed;
 when 'unit_scope' then target_table:='unit_scope_periods'; select exists(select 1 from public.unit_scope_periods p where p.id=target and p.scope_id=scope and p.valid_from<=current_date and (p.valid_to is null or current_date<p.valid_to)) into allowed;
 else raise exception 'Invalid target' using errcode='23514';
 end case;
 if not coalesce(allowed,false) then raise exception 'Forbidden' using errcode='42501'; end if;
 execute format('update public.%I set verification_status=''verified'',verified_by=$1,verified_at=now(),verification_note=$2 where id=$3 and source_kind<>''legacy_unknown'' and known_from is not null',target_table) using private.actor(),btrim(note),target;
 get diagnostics affected=row_count;
 if affected<>1 then raise exception 'Source must be established first' using errcode='23514'; end if;
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason) values(scope,private.actor(),'verify_registry_record',kind,target,btrim(note));
end $$;
create function public.verify_registry_record(scope uuid,kind text,target uuid,note text) returns void language sql security invoker set search_path='' as $$select private.verify_registry_record(scope,kind,target,note)$$;

revoke all on function private.check_provenance(text,text,date),private.stamp_provenance(text,uuid,text,text,date),private.complete_scope_setup_with_source(uuid,text,text,text,text,date),private.create_unit(uuid,text,text,text,numeric,text,text,date),private.verify_registry_record(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function private.complete_scope_setup_with_source(uuid,text,text,text,text,date),private.create_unit(uuid,text,text,text,numeric,text,text,date),private.verify_registry_record(uuid,text,uuid,text) to authenticated;
revoke all on function public.complete_scope_setup(uuid,text,text,text,text,date),public.create_unit(uuid,text,text,text,numeric,text,text,date),public.verify_registry_record(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.complete_scope_setup(uuid,text,text,text,text,date),public.create_unit(uuid,text,text,text,numeric,text,text,date),public.verify_registry_record(uuid,text,uuid,text) to authenticated;
