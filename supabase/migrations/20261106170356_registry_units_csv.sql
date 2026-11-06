-- P6a: units only. No historical scope dates, persons, ownership, opening balances or files.
insert into public.role_permissions values
 ('manager','prepare_registry_import'),('manager','commit_registry_import'),
 ('manager','export_registry'),('controller','export_registry') on conflict do nothing;

create table public.import_jobs(
 id uuid primary key default gen_random_uuid(),scope_id uuid not null references public.management_units,
 kind text not null default 'units' check(kind='units'),template_version text not null check(template_version='units-v1'),
 source_hash text not null check(source_hash~'^[a-f0-9]{64}$'),context_hash text not null check(context_hash~'^[a-f0-9]{64}$'),status text not null check(status in('invalid','ready','committed')),
 revision integer not null default 1 check(revision>0),created_by uuid not null references public.profiles,created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days',request_key uuid not null,
 commit_request_key uuid,committed_by uuid references public.profiles,commit_preview_revision integer,result jsonb,
 unique(created_by,request_key),unique(committed_by,commit_request_key),unique(scope_id,id),
 check(status<>'committed' or (commit_request_key is not null and committed_by is not null and commit_preview_revision is not null and result is not null))
);
create index import_jobs_scope_idx on public.import_jobs(scope_id,id);
create table public.import_rows(
 id uuid primary key default gen_random_uuid(),job_id uuid not null,
 scope_id uuid not null references public.management_units,row_number integer not null check(row_number between 2 and 201),
 raw_values jsonb not null,errors jsonb not null,outcome text not null check(outcome in('create','unchanged','invalid')),
 unique(job_id,row_number),unique(scope_id,id),foreign key(scope_id,job_id) references public.import_jobs(scope_id,id)
);
create index import_rows_scope_idx on public.import_rows(scope_id,job_id);
create table public.external_record_links(
 id uuid primary key default gen_random_uuid(),scope_id uuid not null references public.management_units,
 source_system text not null,external_key text not null,target_kind text not null check(target_kind='unit'),
 target_id uuid not null references public.units,import_row_id uuid not null,
 source_values jsonb not null,unique(scope_id,source_system,target_kind,external_key),foreign key(scope_id,import_row_id) references public.import_rows(scope_id,id)
);
create index external_record_links_target_idx on public.external_record_links(scope_id,target_id);
create function private.registry_csv_link_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'registry_csv_link_immutable' using errcode='42501';end $$;
create trigger registry_csv_link_immutable before update or delete on public.external_record_links
 for each row execute function private.registry_csv_link_immutable();

create function private.registry_csv_can_read(scope uuid) returns boolean language sql stable set search_path='' as $$
 select private.has_scope_permission(scope,'read_registry') and
 (private.has_scope_permission(scope,'prepare_registry_import') or private.has_scope_permission(scope,'commit_registry_import')) $$;
create function private.registry_csv_context(scope uuid) returns text language sql stable security definer set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_array(
  (select coalesce(jsonb_agg(to_jsonb(u) order by u.id),'[]') from public.units u join public.management_units s on s.building_id=u.building_id where s.id=scope),
  (select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from public.unit_scope_periods p where p.scope_id=scope),
  (select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]') from public.external_record_links l where l.scope_id=scope)
 )::text,'UTF8')),'hex') $$;
create function private.registry_csv_errors(r jsonb) returns jsonb language plpgsql set search_path='' as $$
declare errors jsonb:='[]';k text;lim integer;d date;
 trim_chars text:=U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff';begin
 if r is null or jsonb_typeof(r) is distinct from 'object' then return '[{"column":"row","code":"columns"}]';end if;
 if (select count(*) from jsonb_object_keys(r))<>9 or exists(
 select 1 from jsonb_each(r) e where e.key<>all(array['source_system','external_key','unit_number','unit_type','floor','area','source_kind','source_reference','known_from']) or jsonb_typeof(e.value)<>'string')
 then return jsonb_build_array(jsonb_build_object('column','row','code','columns'));end if;
 foreach k in array array['source_system','external_key','unit_number','source_reference'] loop
 lim:=case k when 'source_system' then 80 when 'external_key' then 120 when 'unit_number' then 40 else 200 end;
 if length(r->>k) not between 1 and lim or (r->>k)<>btrim(r->>k,trim_chars) then errors:=errors||jsonb_build_array(jsonb_build_object('column',k,'code','required_text'));end if;end loop;
 if r->>'source_system'!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$' then errors:=errors||'[{"column":"source_system","code":"source_system"}]';end if;
 if r->>'external_key'~'[[:cntrl:]]' then errors:=errors||'[{"column":"external_key","code":"key_characters"}]';end if;
 if r->>'unit_type'<>all(array['apartment','shop','office','garage','other']) then errors:=errors||'[{"column":"unit_type","code":"unit_type"}]';end if;
 if length(r->>'floor')>40 or r->>'floor'<>btrim(r->>'floor',trim_chars) then errors:=errors||'[{"column":"floor","code":"floor"}]';end if;
 if r->>'area'<>'' and (r->>'area'!~'^[0-9]{1,8}(\.[0-9]{1,4})?$' or r->>'area'!~'[1-9]') then errors:=errors||'[{"column":"area","code":"area"}]';end if;
 if r->>'source_kind'<>all(array['declaration','document']) then errors:=errors||'[{"column":"source_kind","code":"source_kind"}]';end if;
 begin
  if r->>'known_from'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'date';end if;
  d:=(r->>'known_from')::date;if d>current_date then raise exception 'date';end if;
  if errors='[]' then perform private.check_provenance(r->>'source_kind',r->>'source_reference',d);end if;
 exception when others then errors:=errors||'[{"column":"known_from","code":"known_from"}]';end;
 return errors;
end $$;
create function private.registry_csv_match(scope uuid,r jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.external_record_links;s public.management_units;begin
 select * into s from public.management_units where id=scope;
 select * into l from public.external_record_links x where x.scope_id=scope and x.source_system=r->>'source_system' and x.external_key=r->>'external_key' and x.target_kind='unit';
 if l.id is not null then
  if l.source_values=r and exists(select 1 from public.units u join public.unit_scope_periods p on p.unit_id=u.id
   where u.id=l.target_id and p.scope_id=scope and p.valid_from<=current_date and (p.valid_to is null or current_date<p.valid_to)
   and u.archived_at is null and u.unit_number=r->>'unit_number' and u.unit_type=r->>'unit_type'
   and u.floor is not distinct from nullif(r->>'floor','') and u.area is not distinct from nullif(r->>'area','')::numeric
   and u.source_kind=r->>'source_kind' and u.source_reference=r->>'source_reference' and u.known_from=(r->>'known_from')::date)
  then return jsonb_build_object('outcome','unchanged','unit_id',l.target_id);end if;
  return '{"outcome":"invalid","code":"external_conflict"}';
 end if;
 if exists(select 1 from public.units u where u.building_id=s.building_id and u.entrance_id is not distinct from s.entrance_id and u.unit_type=r->>'unit_type' and u.unit_number=r->>'unit_number')
 then return '{"outcome":"invalid","code":"existing_unit_conflict"}';end if;
 return '{"outcome":"create"}';
end $$;

create function private.registry_units_import_job(job uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.import_jobs;begin
 select * into j from public.import_jobs where id=job;
 if j.id is null or not private.registry_csv_can_read(j.scope_id) then raise exception 'registry_csv_forbidden' using errcode='42501';end if;
 return jsonb_build_object('id',j.id,'scope_id',j.scope_id,'revision',j.revision,'source_hash',j.source_hash,'status',j.status,'expires_at',j.expires_at,'result',j.result,
 'rows',(select coalesce(jsonb_agg(jsonb_build_object('row_number',r.row_number,'values',r.raw_values,'errors',r.errors,'outcome',r.outcome) order by r.row_number),'[]') from public.import_rows r where r.job_id=j.id));
end $$;
create function private.registry_units_import_request(scope uuid,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare job uuid;begin
 if not private.registry_csv_can_read(scope) then raise exception 'registry_csv_forbidden' using errcode='42501';end if;
 select id into job from public.import_jobs j where j.scope_id=scope and j.created_by=private.actor() and j.request_key=registry_units_import_request.request_key;
 if job is null then return null;end if;return private.registry_units_import_job(job);
end $$;
create function private.registry_units_import_jobs(scope uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.registry_csv_can_read(scope) then raise exception 'registry_csv_forbidden' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]') from
 (select j.id,j.created_at,j.status,(select count(*) from public.import_rows r where r.job_id=j.id) row_count
 from public.import_jobs j where j.scope_id=scope and (j.expires_at>now() or j.status='committed') order by j.created_at desc,j.id limit 50) x);
end $$;
create function private.stage_registry_units(scope uuid,rows jsonb,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.actor();j public.import_jobs;packet_hash text;rec record;errors jsonb;matched jsonb;has_errors boolean:=false;begin
 if not(private.has_scope_permission(scope,'prepare_registry_import') and private.has_scope_permission(scope,'read_registry')) then raise exception 'registry_csv_prepare_forbidden' using errcode='42501';end if;
 if request_key is null or rows is null or jsonb_typeof(rows)<>'array' then raise exception 'registry_csv_payload' using errcode='23514';end if;
 if jsonb_array_length(rows) not between 1 and 200 or octet_length(rows::text)>262144 then raise exception 'registry_csv_limit' using errcode='23514';end if;
 packet_hash:=encode(sha256(convert_to(rows::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':registry-stage:'||request_key::text,0));
 select * into j from public.import_jobs x where x.created_by=actor and x.request_key=stage_registry_units.request_key;
 if j.id is not null then
  if j.scope_id<>scope or j.source_hash<>packet_hash then raise exception 'registry_csv_request_mismatch' using errcode='PT409';end if;
  return private.registry_units_import_job(j.id);
 end if;
 perform 1 from public.management_units s where s.id=scope for update;
 if not(private.has_scope_permission(scope,'prepare_registry_import') and private.has_scope_permission(scope,'read_registry')) then raise exception 'registry_csv_prepare_revoked' using errcode='42501';end if;
 insert into public.import_jobs(scope_id,template_version,source_hash,context_hash,status,created_by,request_key)
 values(scope,'units-v1',packet_hash,private.registry_csv_context(scope),'ready',actor,request_key) returning * into j;
 for rec in select value,ordinality::integer n from jsonb_array_elements(rows) with ordinality loop
  errors:=private.registry_csv_errors(rec.value);
  if errors='[]' then
   if (select count(*) from jsonb_array_elements(rows) v where v->>'source_system'=rec.value->>'source_system' and v->>'external_key'=rec.value->>'external_key')>1 then errors:=errors||'[{"column":"external_key","code":"duplicate_key"}]';end if;
   if (select count(*) from jsonb_array_elements(rows) v where v->>'unit_number'=rec.value->>'unit_number' and v->>'unit_type'=rec.value->>'unit_type')>1 then errors:=errors||'[{"column":"unit_number","code":"duplicate_unit"}]';end if;
   matched:=private.registry_csv_match(scope,rec.value);
   if matched->>'outcome'='invalid' then errors:=errors||jsonb_build_array(jsonb_build_object('column','external_key','code',matched->>'code'));end if;
  end if;
  if errors<>'[]' then has_errors:=true;end if;
  insert into public.import_rows(job_id,scope_id,row_number,raw_values,errors,outcome) values(j.id,scope,rec.n+1,rec.value,errors,case when errors<>'[]' then 'invalid' else matched->>'outcome' end);
 end loop;
 if has_errors then update public.import_jobs set status='invalid' where id=j.id;end if;
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id) values(scope,actor,'stage_registry_units','import_job',j.id);
 return private.registry_units_import_job(j.id);
end $$;
create function private.commit_registry_units(job uuid,expected_revision integer,expected_hash text,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.actor();j public.import_jobs;r public.import_rows;m jsonb;unit uuid;created integer:=0;unchanged integer:=0;ids jsonb:='[]';begin
 select * into j from public.import_jobs where id=job;
 if j.id is null or not(private.has_scope_permission(j.scope_id,'commit_registry_import') and private.has_scope_permission(j.scope_id,'manage_registry')) then raise exception 'registry_csv_commit_forbidden' using errcode='42501';end if;
 if request_key is null then raise exception 'registry_csv_request_required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':registry-commit:'||request_key::text,0));
 select * into j from public.import_jobs where id=job for update;
 perform 1 from public.management_units where id=j.scope_id for update;
 if not(private.has_scope_permission(j.scope_id,'commit_registry_import') and private.has_scope_permission(j.scope_id,'manage_registry')) then raise exception 'registry_csv_commit_revoked' using errcode='42501';end if;
 if j.status='committed' then
  if j.commit_request_key=request_key and j.committed_by=actor and j.commit_preview_revision=expected_revision and j.source_hash=expected_hash then return j.result;end if;
  raise exception 'registry_csv_already_committed' using errcode='PT409';
 end if;
 if j.status<>'ready' then raise exception 'registry_csv_invalid_rows' using errcode='23514';end if;
 if j.revision is distinct from expected_revision or j.source_hash is distinct from expected_hash or j.expires_at<=now() or j.context_hash<>private.registry_csv_context(j.scope_id)
 then raise exception 'registry_csv_stale_preview' using errcode='PT409';end if;
 if exists(select 1 from public.import_jobs x where x.committed_by=actor and x.commit_request_key=commit_registry_units.request_key) then raise exception 'registry_csv_request_mismatch' using errcode='PT409';end if;
 -- Revalidate EVERY row before the first domain write. Parent row lock also serializes create_unit.
 for r in select * from public.import_rows where job_id=job order by row_number loop
  if private.registry_csv_errors(r.raw_values)<>'[]' or private.registry_csv_match(j.scope_id,r.raw_values)->>'outcome'='invalid' then raise exception 'registry_csv_changed_input' using errcode='PT409';end if;
 end loop;
 for r in select * from public.import_rows where job_id=job order by row_number loop
  m:=private.registry_csv_match(j.scope_id,r.raw_values);
  if m->>'outcome'='unchanged' then unit:=(m->>'unit_id')::uuid;unchanged:=unchanged+1;
  else
   unit:=private.create_unit(j.scope_id,r.raw_values->>'unit_number',r.raw_values->>'unit_type',nullif(r.raw_values->>'floor',''),nullif(r.raw_values->>'area','')::numeric,r.raw_values->>'source_kind',r.raw_values->>'source_reference',(r.raw_values->>'known_from')::date);
   insert into public.external_record_links(scope_id,source_system,external_key,target_kind,target_id,import_row_id,source_values)
   values(j.scope_id,r.raw_values->>'source_system',r.raw_values->>'external_key','unit',unit,r.id,r.raw_values);created:=created+1;
  end if;ids:=ids||to_jsonb(unit);
 end loop;
 update public.import_jobs set status='committed',revision=revision+1,committed_by=actor,commit_request_key=commit_registry_units.request_key,commit_preview_revision=expected_revision,
 result=jsonb_build_object('created',created,'unchanged',unchanged,'total',created+unchanged,'unit_ids',ids) where id=job returning * into j;
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id) values(j.scope_id,actor,'commit_registry_units','import_job',job);
 return j.result;
exception when unique_violation then raise exception 'registry_csv_write_conflict' using errcode='PT409';
end $$;
create function private.registry_csv_contexts() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'label',s.label,
 'can_prepare',private.has_scope_permission(s.id,'read_registry') and private.has_scope_permission(s.id,'prepare_registry_import'),
 'can_commit',private.has_scope_permission(s.id,'manage_registry') and private.has_scope_permission(s.id,'commit_registry_import'),
 'can_export',private.has_scope_permission(s.id,'read_registry') and private.has_scope_permission(s.id,'export_registry')) order by s.label),'[]')
 from public.management_units s where private.registry_csv_can_read(s.id) or (private.has_scope_permission(s.id,'read_registry') and private.has_scope_permission(s.id,'export_registry')) $$;
create function private.export_registry_units(scope uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not(private.has_scope_permission(scope,'read_registry') and private.has_scope_permission(scope,'export_registry')) then raise exception 'registry_csv_export_forbidden' using errcode='42501';end if;
 return jsonb_build_object('template_version','units-export-v1','as_of',current_date,
 'rows',(select coalesce(jsonb_agg(jsonb_build_object('unit_id',u.id,'source_system',l.source_system,'external_key',l.external_key,'unit_number',u.unit_number,'unit_type',u.unit_type,'floor',u.floor,'area',u.area::text,'source_kind',u.source_kind,'source_reference',u.source_reference,'known_from',u.known_from) order by u.unit_number,u.id),'[]')
 from public.units u join public.unit_scope_periods p on p.unit_id=u.id
 left join public.external_record_links l on l.target_id=u.id and l.scope_id=scope
 where p.scope_id=scope and p.valid_from<=current_date and (p.valid_to is null or current_date<p.valid_to) and u.archived_at is null));
end $$;

create function public.registry_csv_contexts() returns jsonb language sql stable security invoker set search_path='' as $$ select private.registry_csv_contexts() $$;
create function public.stage_registry_units(scope uuid,rows jsonb,request_key uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.stage_registry_units(scope,rows,request_key) $$;
create function public.registry_units_import_job(job uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.registry_units_import_job(job) $$;
create function public.registry_units_import_request(scope uuid,request_key uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.registry_units_import_request(scope,request_key) $$;
create function public.registry_units_import_jobs(scope uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.registry_units_import_jobs(scope) $$;
create function public.commit_registry_units(job uuid,expected_revision integer,expected_hash text,request_key uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.commit_registry_units(job,expected_revision,expected_hash,request_key) $$;
create function public.export_registry_units(scope uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.export_registry_units(scope) $$;
do $$declare t text;f record;begin
 foreach t in array array['import_jobs','import_rows','external_record_links'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 n.nspname in('public','private') and p.proname=any(array['registry_csv_link_immutable','registry_csv_can_read','registry_csv_context','registry_csv_errors','registry_csv_match','registry_units_import_job','registry_units_import_request','registry_units_import_jobs','stage_registry_units','commit_registry_units','registry_csv_contexts','export_registry_units']) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 if f.signature::text~'(registry_units_import_job|registry_units_import_request|registry_units_import_jobs|stage_registry_units|commit_registry_units|registry_csv_contexts|export_registry_units)\(' then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
