-- P6a corrective candidate. NOT hosted-applied by the acceptance run.
-- Transaction-stable now() must not preserve an expired grant after a lock wait.
-- Keep the canonical permission predicate; evaluate only CSV write guards at live time.
create function private.registry_csv_current_permission(scope uuid,permission text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare checked_at timestamptz:=clock_timestamp();allowed boolean;begin
 select exists(select 1 from public.user_roles r
 join public.profiles p on p.id=r.profile_id
 join public.organization_memberships m on m.id=r.membership_id
 join public.organizations o on o.id=m.organization_id
 join public.management_assignments a on a.organization_id=o.id and a.scope_id=r.scope_id
 join public.management_units s on s.id=a.scope_id
 where r.profile_id=private.actor() and p.status='active' and r.scope_id=scope and permission=any(r.permissions)
 and o.status='active' and m.status='active' and a.status='active' and s.status='active'
 and r.valid_from<=checked_at and(r.valid_to is null or checked_at<r.valid_to)
 and m.valid_from<=checked_at and(m.valid_to is null or checked_at<m.valid_to)
 and a.valid_from<=checked_at::date and(a.valid_to is null or checked_at::date<a.valid_to)) into allowed;
 return allowed;
end $$;
revoke all on function private.registry_csv_current_permission(uuid,text) from public,anon,authenticated;

create or replace function private.stage_registry_units(scope uuid,rows jsonb,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.actor();j public.import_jobs;packet_hash text;rec record;errors jsonb;matched jsonb;has_errors boolean:=false;begin
 if not(private.registry_csv_current_permission(scope,'prepare_registry_import') and private.registry_csv_current_permission(scope,'read_registry')) then raise exception 'registry_csv_prepare_forbidden' using errcode='42501';end if;
 if request_key is null or rows is null or jsonb_typeof(rows)<>'array' then raise exception 'registry_csv_payload' using errcode='23514';end if;
 if jsonb_array_length(rows) not between 1 and 200 or octet_length(rows::text)>262144 then raise exception 'registry_csv_limit' using errcode='23514';end if;
 packet_hash:=encode(sha256(convert_to(rows::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':registry-stage:'||request_key::text,0));
 -- The advisory lock can wait, including on a replay. Recheck BEFORE any early return.
 if not(private.registry_csv_current_permission(scope,'prepare_registry_import') and private.registry_csv_current_permission(scope,'read_registry')) then raise exception 'registry_csv_prepare_revoked' using errcode='42501';end if;
 select * into j from public.import_jobs x where x.created_by=actor and x.request_key=stage_registry_units.request_key;
 if j.id is not null then
  if j.scope_id<>scope or j.source_hash<>packet_hash then raise exception 'registry_csv_request_mismatch' using errcode='PT409';end if;
  return private.registry_units_import_job(j.id);
 end if;
 perform 1 from public.management_units s where s.id=scope for update;
 if not(private.registry_csv_current_permission(scope,'prepare_registry_import') and private.registry_csv_current_permission(scope,'read_registry')) then raise exception 'registry_csv_prepare_revoked' using errcode='42501';end if;
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

create or replace function private.commit_registry_units(job uuid,expected_revision integer,expected_hash text,request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.actor();j public.import_jobs;r public.import_rows;m jsonb;unit uuid;created integer:=0;unchanged integer:=0;ids jsonb:='[]';begin
 select * into j from public.import_jobs where id=job;
 if j.id is null or not(private.registry_csv_current_permission(j.scope_id,'commit_registry_import') and private.registry_csv_current_permission(j.scope_id,'manage_registry')) then raise exception 'registry_csv_commit_forbidden' using errcode='42501';end if;
 if request_key is null then raise exception 'registry_csv_request_required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':registry-commit:'||request_key::text,0));
 select * into j from public.import_jobs where id=job for update;
 perform 1 from public.management_units where id=j.scope_id for update;
 if not(private.registry_csv_current_permission(j.scope_id,'commit_registry_import') and private.registry_csv_current_permission(j.scope_id,'manage_registry')) then raise exception 'registry_csv_commit_revoked' using errcode='42501';end if;
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
