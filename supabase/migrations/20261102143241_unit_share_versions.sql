-- DB16 persisted facts, immutable corrections/reviews. No financial integration.
create table public.unit_share_bases(
 id uuid primary key default gen_random_uuid(),scope_id uuid not null references public.management_units,
 kind text not null check(kind in('building','entrance')),building_id uuid not null references public.buildings,entrance_id uuid,
 revision integer not null default 0 check(revision>=0),current_version_id uuid,
 foreign key(building_id,entrance_id) references public.entrances(building_id,id),
 check((kind='building' and entrance_id is null) or(kind='entrance' and entrance_id is not null)),
 check((revision=0 and current_version_id is null) or(revision>0 and current_version_id is not null)),unique(scope_id,id)
);
create unique index unit_share_physical_basis_idx on public.unit_share_bases(building_id,kind,entrance_id) nulls not distinct;
create index unit_share_basis_scope_idx on public.unit_share_bases(scope_id);
create table public.unit_share_versions(
 id uuid primary key,scope_id uuid not null,basis_id uuid not null,revision integer not null check(revision>0),
 packet jsonb not null check(jsonb_typeof(packet)='object'),previous_version_id uuid references public.unit_share_versions,
 request_key uuid not null,request_input jsonb not null,recorded_by uuid not null references public.profiles,
 recorded_at timestamptz not null default clock_timestamp(),reason text not null check(length(btrim(reason)) between 1 and 300),
 foreign key(scope_id,basis_id) references public.unit_share_bases(scope_id,id),unique(basis_id,revision),unique(recorded_by,request_key),
 unique(scope_id,id),unique(basis_id,id)
);
alter table public.unit_share_bases add foreign key(id,current_version_id) references public.unit_share_versions(basis_id,id);
create index unit_share_version_scope_idx on public.unit_share_versions(scope_id,basis_id);
create index unit_share_version_previous_idx on public.unit_share_versions(previous_version_id);
create index unit_share_version_actor_idx on public.unit_share_versions(recorded_by);
create table public.unit_share_verifications(
 id uuid primary key default gen_random_uuid(),scope_id uuid not null,version_id uuid not null unique,
 as_of date not null,basis_reference text not null,participants_reference text not null,note text not null,
 reviewed_row_ids jsonb not null,snapshot jsonb not null,
 verified_by uuid not null references public.profiles,verified_at timestamptz not null default clock_timestamp(),
 foreign key(scope_id,version_id) references public.unit_share_versions(scope_id,id)
);
create index unit_share_review_scope_idx on public.unit_share_verifications(scope_id);
create index unit_share_review_actor_idx on public.unit_share_verifications(verified_by);
create function private.immutable_unit_share_fact() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Share facts and reviews are immutable; append a correction' using errcode='42501';end $$;
create trigger immutable_share_version before update or delete on public.unit_share_versions for each row execute function private.immutable_unit_share_fact();
create trigger immutable_share_verification before update or delete on public.unit_share_verifications for each row execute function private.immutable_unit_share_fact();
create function private.guard_unit_share_head() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Basis history cannot be deleted' using errcode='42501';end if;
 if (new.scope_id,new.kind,new.building_id,new.entrance_id) is distinct from(old.scope_id,old.kind,old.building_id,old.entrance_id)
 or new.revision<>old.revision+1 or not exists(select 1 from public.unit_share_versions where id=new.current_version_id and basis_id=old.id and revision=new.revision)
 then raise exception 'Invalid basis identity or revision' using errcode='23514';end if;return new;
end $$;
create trigger guard_unit_share_head before update or delete on public.unit_share_bases for each row execute function private.guard_unit_share_head();
create function private.share_date(v text) returns date language plpgsql set search_path='' as $$
begin if v is null or v !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid share date' using errcode='23514';end if;return v::date;end $$;
create function private.share_provenance(p jsonb) returns void language plpgsql set search_path='' as $$
begin
 if p->>'source_kind' is null or p->>'source_kind' not in('document','declaration')
 or jsonb_typeof(p->'source_reference') is distinct from 'string' or length(btrim(p->>'source_reference')) not between 1 and 200
 or jsonb_typeof(p->'history_note') is distinct from 'string' or length(btrim(p->>'history_note')) not between 1 and 300
 or private.share_date(p->>'known_from')>current_date then raise exception 'Explicit provenance required' using errcode='23514';end if;
end $$;
create function private.validate_share_packet(scope uuid,p jsonb,complete boolean) returns void language plpgsql security definer set search_path='' as $$
declare bid uuid;eid uuid;starts date;ends date;r jsonb;rid uuid;point date;total numeric;known integer;expected integer;
begin
 if p is null or jsonb_typeof(p)<>'object' or length(p::text)>1048576
 or p-array['kind','building_id','entrance_id','common_parts_reference','participants_reference','source_kind','source_reference','known_from','history_note','valid_from','valid_to','unit_ids','rows']<>'{}'::jsonb
 then raise exception 'Unsupported share packet' using errcode='23514';end if;
 if p->>'kind' is null or p->>'kind' not in('building','entrance') then raise exception 'Explicit physical denominator required' using errcode='23514';end if;
 bid:=(p->>'building_id')::uuid;eid:=(p->>'entrance_id')::uuid;
 if not exists(select 1 from public.management_units where id=scope and mode='building' and building_id=bid)
 or(p->>'kind'='building' and eid is not null) or(p->>'kind'='entrance' and not exists(select 1 from public.entrances where id=eid and building_id=bid))
 then raise exception 'Physical basis unavailable in scope' using errcode='42501';end if;
 if jsonb_typeof(p->'common_parts_reference') is distinct from 'string' or length(btrim(p->>'common_parts_reference')) not between 1 and 200
 or jsonb_typeof(p->'participants_reference') is distinct from 'string' or length(btrim(p->>'participants_reference')) not between 1 and 200
 then raise exception 'Basis and participant evidence required' using errcode='23514';end if;
 perform private.share_provenance(p);starts:=private.share_date(p->>'valid_from');ends:=case when p->>'valid_to' is null then null else private.share_date(p->>'valid_to') end;
 if ends<=starts or jsonb_typeof(p->'unit_ids') is distinct from 'array' or jsonb_typeof(p->'rows') is distinct from 'array' then raise exception 'Invalid interval or participants' using errcode='23514';end if;
 if jsonb_array_length(p->'unit_ids') not between 1 and 1000 or jsonb_array_length(p->'rows')>2000 then raise exception 'Invalid packet size' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(p->'unit_ids') x where jsonb_typeof(x)<>'string')
 or(select count(*)<>count(distinct value::uuid) from jsonb_array_elements_text(p->'unit_ids')) then raise exception 'Duplicate/invalid participant' using errcode='23514';end if;
 for rid in select value::uuid from jsonb_array_elements_text(p->'unit_ids') loop
  if not exists(select 1 from public.units u where u.id=rid and u.building_id=bid and(eid is null or u.entrance_id=eid))
  or not exists(select 1 from public.unit_scope_periods s where s.unit_id=rid and s.scope_id=scope and daterange(s.valid_from,s.valid_to,'[)') && daterange(starts,ends,'[)'))
  then raise exception 'Participant outside permitted physical basis' using errcode='42501';end if;
 end loop;
 for r in select value from jsonb_array_elements(p->'rows') loop
  if jsonb_typeof(r)<>'object' or r-array['unit_id','percentage','valid_from','valid_to','source_kind','source_reference','known_from','history_note']<>'{}'::jsonb then raise exception 'Invalid share row' using errcode='23514';end if;
  rid:=(r->>'unit_id')::uuid;
  if rid is null or not exists(select 1 from jsonb_array_elements_text(p->'unit_ids') x where x::uuid=rid) then raise exception 'Unexpected participant row' using errcode='23514';end if;
  if r->>'percentage' is not null and(jsonb_typeof(r->'percentage')<>'string' or r->>'percentage' !~ '^(0|[1-9][0-9]{0,2})(\.[0-9]{1,8})?$') then raise exception 'Exact percentage text required' using errcode='23514';end if;
  if (r->>'percentage')::numeric<=0 or(r->>'percentage')::numeric>100 then raise exception 'Percentage outside(0,100]' using errcode='23514';end if;
  perform private.share_provenance(r);perform private.share_date(r->>'valid_from');
  if r->>'valid_to' is not null then perform private.share_date(r->>'valid_to');end if;
  if (r->>'valid_from')::date<starts or(r->>'valid_to')::date<=(r->>'valid_from')::date
  or(ends is not null and(r->>'valid_to' is null or(r->>'valid_to')::date>ends))
  or not exists(select 1 from public.unit_scope_periods s where s.unit_id=rid and s.scope_id=scope and daterange(s.valid_from,s.valid_to,'[)') @> daterange((r->>'valid_from')::date,(r->>'valid_to')::date,'[)'))
  then raise exception 'Share period outside established coverage' using errcode='23514';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p->'rows') with ordinality a(x,i),jsonb_array_elements(p->'rows') with ordinality b(y,j)
 where i<j and(x->>'unit_id')::uuid=(y->>'unit_id')::uuid and daterange((x->>'valid_from')::date,(x->>'valid_to')::date,'[)') && daterange((y->>'valid_from')::date,(y->>'valid_to')::date,'[)'))
 then raise exception 'Overlapping current unit periods' using errcode='23514';end if;
 expected:=jsonb_array_length(p->'unit_ids');
 if complete then
  if exists(select 1 from jsonb_array_elements_text(p->'unit_ids') x where not exists(select 1 from public.unit_scope_periods s where s.unit_id=x::uuid and s.scope_id=scope and daterange(s.valid_from,s.valid_to,'[)') @> daterange(starts,ends,'[)')))
  or(select count(*) from public.units u where u.building_id=bid and(eid is null or u.entrance_id=eid) and exists(select 1 from public.unit_scope_periods s where s.unit_id=u.id and daterange(s.valid_from,s.valid_to,'[)') && daterange(starts,ends,'[)')))<>expected
  then raise exception 'Whole participant set not established in permitted scope' using errcode='23514';end if;
 end if;
 for point in select d from(select starts d union select(value->>'valid_from')::date from jsonb_array_elements(p->'rows') union select(value->>'valid_to')::date from jsonb_array_elements(p->'rows')) q where d is not null and d>=starts and(ends is null or d<ends) loop
  select coalesce(sum((x->>'percentage')::numeric),0),count(*) filter(where x->>'percentage' is not null) into total,known from jsonb_array_elements(p->'rows') x where(x->>'valid_from')::date<=point and(x->>'valid_to' is null or point<(x->>'valid_to')::date);
  if total>100 or(complete and(total<>100 or known<>expected)) then raise exception 'Incomplete or exceeded exact share total' using errcode='23514';end if;
 end loop;
end $$;
create function private.unit_share_review_current(v public.unit_share_versions) returns boolean language plpgsql stable security definer set search_path='' as $$
begin perform private.validate_share_packet(v.scope_id,v.request_input->'payload',true);return true;exception when check_violation or insufficient_privilege then return false;end $$;
create function private.save_unit_share_set(scope uuid,target uuid,expected_revision integer,request_key uuid,payload jsonb,note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.unit_share_bases;v public.unit_share_versions;input jsonb;basis jsonb;packet jsonb;rows jsonb;result uuid;units jsonb;
begin
 if not private.has_scope_permission(scope,'manage_registry') then raise exception 'Registry edit forbidden' using errcode='42501';end if;
 if request_key is null or note is null or length(btrim(note)) not between 1 and 300 then raise exception 'Request and reason required' using errcode='23514';end if;
 input:=jsonb_build_object('scope',scope,'target',target,'expected_revision',expected_revision,'payload',payload,'note',btrim(note));
 perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||':shares:'||request_key::text,0));
 select * into v from public.unit_share_versions where recorded_by=private.actor() and unit_share_versions.request_key=save_unit_share_set.request_key;
 if found then if v.request_input is distinct from input then raise exception 'Request changed' using errcode='PT409';end if;return jsonb_build_object('basis_id',v.basis_id,'version_id',v.id,'revision',v.revision);end if;
 perform private.validate_share_packet(scope,payload,false);
 perform pg_advisory_xact_lock(hashtextextended('shares:'||(payload->>'building_id')||':'||(payload->>'kind')||coalesce(payload->>'entrance_id',''),0));
 if target is null then
  if expected_revision is distinct from 0 then raise exception 'Basis changed' using errcode='PT409';end if;
  if exists(select 1 from public.unit_share_bases where building_id=(payload->>'building_id')::uuid and kind=payload->>'kind' and entrance_id is not distinct from(payload->>'entrance_id')::uuid) then raise exception 'Physical denominator already exists; select it' using errcode='PT409';end if;
  insert into public.unit_share_bases(scope_id,kind,building_id,entrance_id) values(scope,payload->>'kind',(payload->>'building_id')::uuid,(payload->>'entrance_id')::uuid) returning * into b;
 else
  select * into b from public.unit_share_bases where id=target and scope_id=scope for update;
  if not found then raise exception 'Basis unavailable' using errcode='42501';end if;
  if b.revision is distinct from expected_revision then raise exception 'Basis changed; reload' using errcode='PT409';end if;
  if (b.kind,b.building_id,b.entrance_id) is distinct from(payload->>'kind',(payload->>'building_id')::uuid,(payload->>'entrance_id')::uuid) then raise exception 'Wrong denominator identity' using errcode='23514';end if;
 end if;
 if not private.has_scope_permission(scope,'manage_registry') then raise exception 'Registry edit revoked' using errcode='42501';end if;
 result:=gen_random_uuid();basis:=jsonb_build_object('key',b.id,'revision',b.revision+1,'kind',b.kind,'building_id',b.building_id,'entrance_id',b.entrance_id,'verified',false);
 select jsonb_agg(value::uuid) into units from jsonb_array_elements_text(payload->'unit_ids');
 select coalesce(jsonb_agg(x||jsonb_build_object('id',gen_random_uuid(),'unit_id',(x->>'unit_id')::uuid,'basis',basis,'participant_revision',b.revision+1,'verification_status','needs_review','record_state','current')),'[]') into rows from jsonb_array_elements(payload->'rows') x;
 packet:=(payload-array['unit_ids','rows'])||jsonb_build_object('basis',basis,'participants',jsonb_build_object('basis',basis,'revision',b.revision+1,'unit_ids',units,'verified',false,'valid_from',payload->'valid_from','valid_to',payload->'valid_to'),
 'rows',rows,'interval',jsonb_build_object('valid_from',payload->'valid_from','valid_to',payload->'valid_to'));
 insert into public.unit_share_versions(id,scope_id,basis_id,revision,packet,previous_version_id,request_key,request_input,recorded_by,reason) values(result,scope,b.id,b.revision+1,packet,b.current_version_id,request_key,input,private.actor(),btrim(note));
 update public.unit_share_bases set revision=b.revision+1,current_version_id=result where id=b.id;
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta) values(scope,private.actor(),'save_unit_share_set','unit_share_version',result,btrim(note),jsonb_build_object('previous_version_id',b.current_version_id,'after',packet));
 return jsonb_build_object('basis_id',b.id,'version_id',result,'revision',b.revision+1);
end $$;
create function public.save_unit_share_set(scope uuid,target uuid,expected_revision integer,request_key uuid,payload jsonb,note text) returns jsonb language sql security invoker set search_path='' as $$select private.save_unit_share_set(scope,target,expected_revision,request_key,payload,note)$$;

create function private.verify_unit_share_set(scope uuid,version_id uuid,expected_revision integer,as_of date,basis_reference text,participants_reference text,row_ids jsonb,note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.unit_share_versions;b public.unit_share_bases;old public.unit_share_verifications;snapshot jsonb;basis jsonb;rows jsonb;ids jsonb;result uuid;at timestamptz:=clock_timestamp();
begin
 if not private.has_scope_permission(scope,'manage_registry') then raise exception 'Registry review forbidden' using errcode='42501';end if;
 if basis_reference is null or length(btrim(basis_reference)) not between 1 and 300 or participants_reference is null or length(btrim(participants_reference)) not between 1 and 300
 or note is null or length(btrim(note)) not between 1 and 300 or as_of is null or jsonb_typeof(row_ids) is distinct from 'array' then raise exception 'Explicit evidence review required' using errcode='23514';end if;
 select * into v from public.unit_share_versions where id=version_id and scope_id=scope;
 if not found then raise exception 'Version unavailable' using errcode='42501';end if;
 select * into b from public.unit_share_bases where id=v.basis_id;
 perform pg_advisory_xact_lock(hashtextextended('shares:'||b.building_id::text||':'||b.kind||coalesce(b.entrance_id::text,''),0));
 select * into b from public.unit_share_bases where id=v.basis_id for update;
 if b.revision is distinct from expected_revision or b.current_version_id<>version_id then raise exception 'Version changed; reload' using errcode='PT409';end if;
 if not private.has_scope_permission(scope,'manage_registry') then raise exception 'Registry review revoked' using errcode='42501';end if;
 perform private.validate_share_packet(scope,v.request_input->'payload',true);
 if not daterange((v.packet->'interval'->>'valid_from')::date,(v.packet->'interval'->>'valid_to')::date,'[)') @> as_of then raise exception 'Review date outside coverage' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(row_ids) x where jsonb_typeof(x)<>'string')
 or (select count(*)<>count(distinct value::uuid) from jsonb_array_elements_text(row_ids))
 or jsonb_array_length(row_ids)<>jsonb_array_length(v.packet->'rows')
 or exists(select 1 from jsonb_array_elements(v.packet->'rows') x where not exists(select 1 from jsonb_array_elements_text(row_ids) y where y::uuid=(x->>'id')::uuid))
 then raise exception 'Review each exact row source explicitly' using errcode='23514';end if;
 select jsonb_agg(value::uuid order by value::uuid) into ids from jsonb_array_elements_text(row_ids);
 select * into old from public.unit_share_verifications where unit_share_verifications.version_id=verify_unit_share_set.version_id;
 if found then
  if (old.as_of,old.basis_reference,old.participants_reference,old.reviewed_row_ids,old.note) is distinct from(as_of,btrim(basis_reference),btrim(participants_reference),ids,btrim(note))
  then raise exception 'Version already reviewed; correction needs a new version' using errcode='PT409';end if;return old.id;
 end if;
 basis:=v.packet->'basis'||jsonb_build_object('verified',true,'verified_by',private.actor(),'verified_at',at,'verification_note',btrim(basis_reference));
 select jsonb_agg(x||jsonb_build_object('basis',basis,'verification_status','verified','verified_by',private.actor(),'verified_at',at,'verification_note',btrim(note))) into rows from jsonb_array_elements(v.packet->'rows') x;
 snapshot:=v.packet||jsonb_build_object('basis',basis,'participants',v.packet->'participants'||jsonb_build_object('basis',basis,'verified',true,'verified_by',private.actor(),'verified_at',at,'verification_note',btrim(participants_reference)),'rows',rows);
 insert into public.unit_share_verifications(scope_id,version_id,as_of,basis_reference,participants_reference,note,reviewed_row_ids,snapshot,verified_by,verified_at)
 values(scope,version_id,as_of,btrim(basis_reference),btrim(participants_reference),btrim(note),ids,snapshot,private.actor(),at) returning id into result;
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta) values(scope,private.actor(),'verify_unit_share_set','unit_share_version',version_id,btrim(note),jsonb_build_object('review_id',result,'version_id',version_id,'basis_revision',b.revision,'as_of',as_of));
 return result;
end $$;
create function public.verify_unit_share_set(scope uuid,version_id uuid,expected_revision integer,as_of date,basis_reference text,participants_reference text,row_ids jsonb,note text)
returns uuid language sql security invoker set search_path='' as $$select private.verify_unit_share_set(scope,version_id,expected_revision,as_of,basis_reference,participants_reference,row_ids,note)$$;
create function private.unit_share_version_at(scope uuid,version_id uuid,at_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v public.unit_share_versions;b public.unit_share_bases;r public.unit_share_verifications;current boolean;
begin
 if not private.has_scope_permission(scope,'read_registry') then raise exception 'Registry read forbidden' using errcode='42501';end if;
 select * into v from public.unit_share_versions where id=version_id and scope_id=scope;
 if not found then raise exception 'Version unavailable' using errcode='42501';end if;
 select * into b from public.unit_share_bases where id=v.basis_id;select * into r from public.unit_share_verifications where unit_share_verifications.version_id=unit_share_version_at.version_id;
 if r.id is null or at_date is null or not daterange((v.packet->'interval'->>'valid_from')::date,(v.packet->'interval'->>'valid_to')::date,'[)') @> at_date then raise exception 'No verified version for requested date' using errcode='23514';end if;
 current:=b.current_version_id=v.id;
 return jsonb_build_object('version_id',v.id,'review_id',r.id,'basis_id',b.id,'revision',v.revision,'as_of',at_date,'is_current',current,
 'ready_for_new_use',current and private.unit_share_review_current(v),'snapshot',r.snapshot,'verified_by',r.verified_by,'verified_at',r.verified_at);
end $$;
create function public.unit_share_version_at(scope uuid,version_id uuid,at_date date) returns jsonb language sql stable security invoker set search_path='' as $$select private.unit_share_version_at(scope,version_id,at_date)$$;
create function private.unit_share_feed(scope uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_scope_permission(scope,'read_registry') then raise exception 'Registry read forbidden' using errcode='42501';end if;
 return jsonb_build_object(
 'can_manage',private.has_scope_permission(scope,'manage_registry') and exists(select 1 from public.management_units where id=scope and mode='building'),
 'building',(select jsonb_build_object('id',b.id,'label',coalesce(b.label,b.address)) from public.management_units s join public.buildings b on b.id=s.building_id where s.id=scope),
 'entrances',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'building_id',e.building_id,'label',e.code)),'[]') from public.management_units s join public.entrances e on e.building_id=s.building_id where s.id=scope),
 'units',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'building_id',u.building_id,'entrance_id',u.entrance_id,'unit_number',u.unit_number,'unit_type',u.unit_type) order by u.unit_number),'[]') from public.units u where exists(select 1 from public.unit_scope_periods p where p.unit_id=u.id and p.scope_id=scope)),
 'bases',(select coalesce(jsonb_agg(to_jsonb(b)||jsonb_build_object('review_current',r.id is not null and private.unit_share_review_current(v)) order by b.id),'[]') from public.unit_share_bases b join public.unit_share_versions v on v.id=b.current_version_id left join public.unit_share_verifications r on r.version_id=v.id where b.scope_id=scope),
 'versions',(select coalesce(jsonb_agg(to_jsonb(v)-array['request_input','request_key'] order by v.recorded_at,v.id),'[]') from public.unit_share_versions v where v.scope_id=scope),
 'reviews',(select coalesce(jsonb_agg(to_jsonb(r) order by r.verified_at,r.id),'[]') from public.unit_share_verifications r where r.scope_id=scope)
 );
end $$;
create function public.unit_share_feed(scope uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.unit_share_feed(scope)$$;
alter table public.unit_share_bases enable row level security;
alter table public.unit_share_versions enable row level security;
alter table public.unit_share_verifications enable row level security;
revoke all on public.unit_share_bases,public.unit_share_versions,public.unit_share_verifications from public,anon,authenticated;
grant select on public.unit_share_bases,public.unit_share_verifications to authenticated;
grant select(id,scope_id,basis_id,revision,packet,previous_version_id,recorded_by,recorded_at,reason) on public.unit_share_versions to authenticated;
create policy unit_share_basis_read on public.unit_share_bases for select to authenticated using(private.has_scope_permission(scope_id,'read_registry'));
create policy unit_share_version_read on public.unit_share_versions for select to authenticated using(private.has_scope_permission(scope_id,'read_registry'));
create policy unit_share_review_read on public.unit_share_verifications for select to authenticated using(private.has_scope_permission(scope_id,'read_registry'));
revoke all on function private.immutable_unit_share_fact(),private.guard_unit_share_head(),private.share_date(text),private.share_provenance(jsonb),private.validate_share_packet(uuid,jsonb,boolean),private.unit_share_review_current(public.unit_share_versions),
 private.save_unit_share_set(uuid,uuid,integer,uuid,jsonb,text),public.save_unit_share_set(uuid,uuid,integer,uuid,jsonb,text),
 private.verify_unit_share_set(uuid,uuid,integer,date,text,text,jsonb,text),public.verify_unit_share_set(uuid,uuid,integer,date,text,text,jsonb,text),
 private.unit_share_version_at(uuid,uuid,date),public.unit_share_version_at(uuid,uuid,date),private.unit_share_feed(uuid),public.unit_share_feed(uuid) from public,anon,authenticated;
grant execute on function private.save_unit_share_set(uuid,uuid,integer,uuid,jsonb,text),public.save_unit_share_set(uuid,uuid,integer,uuid,jsonb,text),
 private.verify_unit_share_set(uuid,uuid,integer,date,text,text,jsonb,text),public.verify_unit_share_set(uuid,uuid,integer,date,text,text,jsonb,text),
 private.unit_share_version_at(uuid,uuid,date),public.unit_share_version_at(uuid,uuid,date),private.unit_share_feed(uuid),public.unit_share_feed(uuid) to authenticated;
