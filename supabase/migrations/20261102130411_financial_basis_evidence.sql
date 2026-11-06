-- DB-D/1a: structured claims/evidence and explicit review; never activation or a ledger.
insert into public.role_permissions(role_code,permission_code) values('manager','publish_rules');
alter table public.resolutions
 add column evidence jsonb not null default '{}' check(jsonb_typeof(evidence)='object'),
 add column reviewed_by uuid references public.profiles,
 add column reviewed_at timestamptz,
 add column reviewed_revision integer,
 add column review_note text;
alter table public.resolutions drop constraint resolutions_verification_status_check;
alter table public.resolutions add constraint resolutions_verification_status_check
 check(verification_status in('needs_review','reviewed','changes_requested')),
 add constraint financial_review_identity_check check(
 (verification_status='needs_review' and reviewed_by is null and reviewed_at is null and reviewed_revision is null and review_note is null)
 or(verification_status<>'needs_review' and reviewed_by is not null and reviewed_at is not null and reviewed_revision is not null and reviewed_revision=revision and review_note is not null and length(btrim(review_note)) between 1 and 1000));
create index financial_resolution_reviewer_idx on public.resolutions(reviewed_by) where reviewed_by is not null;

create function private.validate_financial_evidence(b public.resolutions,p jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare k text; v text; building uuid; c numeric; available numeric; used numeric; collect numeric;
begin
 if p is null or jsonb_typeof(p)<>'object' or p-array['schema_version','record_kind','currency','denominator','unit_ids','participants_reference',
 'works_description','works_classification','classification_reference','evidence_reference','evidence_sha256','legal_reference','legal_version','majority_reference',
 'approved_cost','reported_available','authorized_use','target_collection','funds_as_of','funds_reference','use_reference','collection_reference','liability_reference','due_on']<>'{}'::jsonb
 or p->>'schema_version' is distinct from 'fnd05-v1' or p->>'currency' is distinct from 'EUR' or p->>'denominator' is distinct from 'building_common_parts'
 then raise exception 'Unsupported evidence schema' using errcode='23514'; end if;
 select s.building_id into building from public.management_units s where s.id=b.scope_id and s.mode='building';
 if building is null or b.resolution_type<>'planned_repair_shortfall' then raise exception 'FND-F05 building basis required' using errcode='23514'; end if;
 for k,v in select key,value#>>'{}' from jsonb_each(p) where key not in('unit_ids') and value<>'null'::jsonb loop
  if jsonb_typeof(p->k)<>'string' or length(btrim(v)) not between 1 and 1000 then raise exception 'Evidence values must be explicit text' using errcode='23514'; end if;
 end loop;
 if p->>'record_kind' is not null and p->>'record_kind' not in('synthetic','client') then raise exception 'Evidence origin required' using errcode='23514'; end if;
 if p->>'evidence_sha256' is not null and p->>'evidence_sha256' !~ '^[a-fA-F0-9]{64}$' then raise exception 'Invalid evidence SHA256' using errcode='23514'; end if;
 if p->'unit_ids' is not null and p->'unit_ids'<>'null'::jsonb then
  if jsonb_typeof(p->'unit_ids')<>'array' then raise exception 'Explicit unit set required' using errcode='23514'; end if;
  if jsonb_array_length(p->'unit_ids')>10000 or exists(select 1 from jsonb_array_elements(p->'unit_ids') x where jsonb_typeof(x)<>'string' or x#>>'{}' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$')
  then raise exception 'Invalid participant IDs' using errcode='23514'; end if;
  if (select count(*)<>count(distinct lower(value)) from jsonb_array_elements_text(p->'unit_ids'))
  then raise exception 'Duplicate participants' using errcode='23514'; end if;
  if exists(select 1 from jsonb_array_elements_text(p->'unit_ids') x where not exists(select 1 from public.units u where u.id=x::uuid and u.building_id=building))
  then raise exception 'Participant unavailable in building' using errcode='42501'; end if;
 end if;
 foreach k in array array['approved_cost','reported_available','authorized_use','target_collection'] loop
  if p->>k is not null and p->>k !~ '^(0|[1-9][0-9]{0,11})\.[0-9]{2}$' then raise exception 'Exact EUR decimal string required' using errcode='23514'; end if;
 end loop;
 c:=(p->>'approved_cost')::numeric; available:=(p->>'reported_available')::numeric; used:=(p->>'authorized_use')::numeric; collect:=(p->>'target_collection')::numeric;
 if c<=0 or collect<=0 or used>available or c<>used+collect then raise exception 'Inconsistent funding claims' using errcode='23514'; end if;
 foreach k in array array['funds_as_of','due_on'] loop
  if p->>k is not null then
   if p->>k !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid evidence date' using errcode='23514'; end if;
   perform (p->>k)::date;
  end if;
 end loop;
 if (p->>'funds_as_of')::date>current_date or (p->>'due_on')::date<b.effective_from
 or(b.effective_to is not null and (p->>'due_on')::date>=b.effective_to)
 then raise exception 'Evidence dates outside supported period' using errcode='23514'; end if;
end $$;

create function private.financial_basis_gaps(b public.resolutions) returns text[] language plpgsql stable set search_path='' as $$
declare missing text[]:='{}'; k text;
begin
 if b.resolution_type<>'planned_repair_shortfall' then return array['legacy_basis']; end if;
 if b.effective_to is null then missing:=array_append(missing,'effective_to'); end if;
 foreach k in array array['record_kind','participants_reference','works_description','works_classification','classification_reference','evidence_reference','evidence_sha256',
 'legal_reference','legal_version','majority_reference','approved_cost','reported_available','authorized_use','target_collection','funds_as_of','funds_reference',
 'use_reference','collection_reference','liability_reference','due_on'] loop
  if nullif(btrim(b.evidence->>k),'') is null then missing:=array_append(missing,k); end if;
 end loop;
 if (case when jsonb_typeof(b.evidence->'unit_ids')='array' then jsonb_array_length(b.evidence->'unit_ids') else 0 end)=0 then missing:=array_append(missing,'unit_ids'); end if;
 return missing;
end $$;
create function private.invalidate_financial_basis_review() returns trigger language plpgsql set search_path='' as $$
begin
 if new.evidence<>'{}'::jsonb then perform private.validate_financial_evidence(new,new.evidence); end if;
 if (to_jsonb(new)-array['revision','modified_by','modified_at','verification_status','reviewed_by','reviewed_at','reviewed_revision','review_note']) is distinct from
 (to_jsonb(old)-array['revision','modified_by','modified_at','verification_status','reviewed_by','reviewed_at','reviewed_revision','review_note'])
 or(new.revision<>old.revision and new.reviewed_revision is not distinct from old.reviewed_revision) then
  new.verification_status:='needs_review';new.reviewed_by:=null;new.reviewed_at:=null;new.reviewed_revision:=null;new.review_note:=null;
 end if;
 return new;
end $$;
create trigger invalidate_financial_basis_review before update on public.resolutions for each row execute function private.invalidate_financial_basis_review();

create function private.save_financial_basis_evidence(scope uuid,target uuid,expected_revision integer,payload jsonb,note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare old public.resolutions; fresh public.resolutions;
begin
 if not private.has_scope_permission(scope,'prepare_rules') then raise exception 'Financial preparation forbidden' using errcode='42501'; end if;
 if note is null or length(btrim(note)) not between 1 and 1000 then raise exception 'Reason required' using errcode='23514'; end if;
 select * into old from public.resolutions r where r.scope_id=scope and r.id=target for update;
 if not found then raise exception 'Basis unavailable' using errcode='42501'; end if;
 if old.revision is distinct from expected_revision then raise exception 'Basis changed; reload' using errcode='PT409'; end if;
 perform private.validate_financial_evidence(old,payload);
 update public.resolutions set evidence=payload,revision=revision+1,modified_by=private.actor(),modified_at=clock_timestamp() where id=target returning * into fresh;
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta)
 values(scope,private.actor(),'save_financial_basis_evidence','resolution',target,btrim(note),jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(fresh)));
 return target;
end $$;
create function public.save_financial_basis_evidence(scope uuid,target uuid,expected_revision integer,payload jsonb,note text)
returns uuid language sql security invoker set search_path='' as $$select private.save_financial_basis_evidence(scope,target,expected_revision,payload,note)$$;

create function private.review_financial_basis(scope uuid,target uuid,expected_revision integer,outcome text,note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare old public.resolutions; fresh public.resolutions;
begin
 if not private.has_scope_permission(scope,'publish_rules') then raise exception 'Financial review forbidden' using errcode='42501'; end if;
 if not exists(select 1 from public.management_units s where s.id=scope and s.mode='building') then raise exception 'FND-F05 building review required' using errcode='23514'; end if;
 if note is null or length(btrim(note)) not between 1 and 1000 or outcome is null or outcome not in('reviewed','changes_requested') then raise exception 'Explicit review outcome/reason required' using errcode='23514'; end if;
 select * into old from public.resolutions r where r.scope_id=scope and r.id=target for update;
 if not found then raise exception 'Basis unavailable' using errcode='42501'; end if;
 if old.revision is distinct from expected_revision then raise exception 'Basis changed; reload' using errcode='PT409'; end if;
 if old.resolution_type<>'planned_repair_shortfall' then raise exception 'Legacy basis is not reviewable' using errcode='23514'; end if;
 if outcome='reviewed' then
  perform private.validate_financial_evidence(old,old.evidence);
  if cardinality(private.financial_basis_gaps(old))<>0 then raise exception 'Incomplete basis; review gaps' using errcode='23514'; end if;
 end if;
 update public.resolutions set verification_status=outcome,reviewed_by=private.actor(),reviewed_at=clock_timestamp(),reviewed_revision=revision+1,
 review_note=btrim(note),revision=revision+1,modified_by=private.actor(),modified_at=clock_timestamp() where id=target returning * into fresh;
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta)
 values(scope,private.actor(),'review_financial_basis','resolution',target,btrim(note),jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(fresh)));
 return target;
end $$;
create function public.review_financial_basis(scope uuid,target uuid,expected_revision integer,outcome text,note text)
returns uuid language sql security invoker set search_path='' as $$select private.review_financial_basis(scope,target,expected_revision,outcome,note)$$;

create or replace function private.can_read_financial_drafts(scope uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_scope_permission(scope,'read_rules') or private.has_scope_permission(scope,'prepare_rules') or private.has_scope_permission(scope,'publish_rules') $$;
create or replace function private.financial_draft_feed() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'scopes',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'label',s.label,'mode',s.mode,'can_prepare',(private.has_scope_permission(s.id,'prepare_rules') and s.mode='building'),'can_review',(private.has_scope_permission(s.id,'publish_rules') and s.mode='building')) order by s.label),'[]') from public.management_units s where private.can_read_financial_drafts(s.id)),
 'catalog',(select coalesce(jsonb_agg(to_jsonb(c) order by c.code,c.version),'[]') from public.financial_categories c where exists(select 1 from public.management_units s where private.can_read_financial_drafts(s.id))),
 'resolutions',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('evidence_gaps',private.financial_basis_gaps(r)) order by r.recorded_at,r.id),'[]') from public.resolutions r where private.can_read_financial_drafts(r.scope_id)),
 'units',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'scope_id',s.id,'unit_type',u.unit_type,'unit_number',u.unit_number) order by u.id),'[]') from public.units u join public.management_units s on s.building_id=u.building_id and s.mode='building' where private.can_read_financial_drafts(s.id)),
 'rules',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('basis_changed',r.resolution_snapshot->>'revision' is distinct from b.revision::text) order by r.recorded_at,r.id),'[]') from public.allocation_rule_versions r join public.resolutions b on b.scope_id=r.scope_id and b.id=r.resolution_id where private.can_read_financial_drafts(r.scope_id)),
 'history',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'target_id',a.target_id,'action',a.action,'actor_profile_id',a.actor_profile_id,'at',a.happened_at,'reason',a.reason,'change',a.safe_delta) order by a.happened_at,a.id),'[]') from public.audit_events a where a.action in('save_financial_resolution','save_financial_rule','save_financial_basis_evidence','review_financial_basis') and private.can_read_financial_drafts(a.scope_id)))
$$;
revoke all on function private.validate_financial_evidence(public.resolutions,jsonb),private.financial_basis_gaps(public.resolutions),private.invalidate_financial_basis_review(),
 private.save_financial_basis_evidence(uuid,uuid,integer,jsonb,text),public.save_financial_basis_evidence(uuid,uuid,integer,jsonb,text),
 private.review_financial_basis(uuid,uuid,integer,text,text),public.review_financial_basis(uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function private.save_financial_basis_evidence(uuid,uuid,integer,jsonb,text),public.save_financial_basis_evidence(uuid,uuid,integer,jsonb,text),
 private.review_financial_basis(uuid,uuid,integer,text,text),public.review_financial_basis(uuid,uuid,integer,text,text) to authenticated;
