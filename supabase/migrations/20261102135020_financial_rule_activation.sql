-- DB-D/2 only. No charges, balances or money movement.
alter table public.resolutions add column applicability jsonb not null default '{}' check(jsonb_typeof(applicability)='object');
create function private.validate_financial_applicability(b public.resolutions,p jsonb) returns void language plpgsql set search_path='' as $$
declare k text;
begin
 if p is null or jsonb_typeof(p)<>'object' or p-array['schema_version','qualification','regime','funding','denominator','procedure','dominant_owner','property_regime','qualification_reference','rationale','voting_reference','votes_for_percent','represented_percent']<>'{}'::jsonb
 or p->>'schema_version' is distinct from 'fnd05-major-v1' or p->>'qualification' is distinct from 'major_repair'
 or p->>'regime' is distinct from 'zues_17_2_5_2023' or p->>'funding' is distinct from 'owners_only_no_credit_or_aid'
 or p->>'denominator' is distinct from 'all_common_parts' or p->>'procedure' is distinct from 'in_person_assembly'
 or p->>'dominant_owner' is distinct from 'none_over_51' or p->>'property_regime' is distinct from 'zues_general'
 then raise exception 'Unresolved or unsupported applicability' using errcode='23514'; end if;
 foreach k in array array['qualification_reference','rationale','voting_reference','votes_for_percent','represented_percent'] loop
  if jsonb_typeof(p->k) is distinct from 'string' or length(btrim(p->>k)) not between 1 and 1000 then raise exception 'Documented applicability required' using errcode='23514'; end if;
 end loop;
 foreach k in array array['votes_for_percent','represented_percent'] loop
  if p->>k !~ '^(0|[1-9][0-9]{0,2})\.[0-9]{8}$' then raise exception 'Exact vote percentage required' using errcode='23514'; end if;
 end loop;
 if (p->>'votes_for_percent')::numeric<51 or (p->>'represented_percent')::numeric>100 or (p->>'votes_for_percent')::numeric>(p->>'represented_percent')::numeric
 or b.meeting_date<date '2023-09-29' or b.resolution_type<>'planned_repair_shortfall'
 then raise exception 'Applicability outside supported statutory case' using errcode='23514'; end if;
end $$;
create function private.save_financial_applicability(scope uuid,target uuid,expected_revision integer,payload jsonb,note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare old public.resolutions; fresh public.resolutions;
begin
 if not private.has_scope_permission(scope,'prepare_rules') then raise exception 'Preparation forbidden' using errcode='42501'; end if;
 if note is null or length(btrim(note)) not between 1 and 1000 then raise exception 'Reason required' using errcode='23514'; end if;
 select * into old from public.resolutions r where r.id=target and r.scope_id=scope for update;
 if not found then raise exception 'Basis unavailable' using errcode='42501'; end if;
 if old.revision is distinct from expected_revision then raise exception 'Basis changed; reload' using errcode='PT409'; end if;
 if not exists(select 1 from public.management_units where id=scope and mode='building') then raise exception 'Building required' using errcode='23514'; end if;
 perform private.validate_financial_applicability(old,payload);
 update public.resolutions set applicability=payload,revision=revision+1,modified_by=private.actor(),modified_at=clock_timestamp() where id=target returning * into fresh;
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta) values(scope,private.actor(),'save_financial_applicability','resolution',target,btrim(note),jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(fresh)));
 return target;
end $$;
create function public.save_financial_applicability(scope uuid,target uuid,expected_revision integer,payload jsonb,note text)
returns uuid language sql security invoker set search_path='' as $$select private.save_financial_applicability(scope,target,expected_revision,payload,note)$$;

alter table public.allocation_rule_versions
 add column source_draft_id uuid,
 add column source_draft_revision integer,
 add column activation_snapshot jsonb,
 add column activation_input jsonb,
 add column activation_request_key uuid,
 add column activated_by uuid references public.profiles,
 add column activated_at timestamptz,
 add column supersedes_id uuid,
 add foreign key(scope_id,source_draft_id) references public.allocation_rule_versions(scope_id,id),
 add foreign key(scope_id,supersedes_id) references public.allocation_rule_versions(scope_id,id),
 add unique(source_draft_id,source_draft_revision),add unique(activated_by,activation_request_key),add unique(supersedes_id);
alter table public.allocation_rule_versions drop constraint allocation_rule_versions_status_check;
alter table public.allocation_rule_versions drop constraint allocation_rule_versions_verification_status_check;
alter table public.allocation_rule_versions add check(status in('draft','active')),
 add check(verification_status in('needs_review','reviewed')),
 add constraint activation_record_check check(
 (status='draft' and verification_status='needs_review' and source_draft_id is null and source_draft_revision is null and activation_snapshot is null and activation_input is null and activation_request_key is null and activated_by is null and activated_at is null and supersedes_id is null)
 or(status='active' and verification_status='reviewed' and source_draft_id is not null and source_draft_revision is not null and source_draft_revision>0 and activation_snapshot is not null and jsonb_typeof(activation_snapshot)='object' and activation_input is not null and activation_request_key is not null and activated_by is not null and activated_at is not null));
create index financial_active_scope_idx on public.allocation_rule_versions(scope_id,status,valid_from,valid_to);
create index financial_source_idx on public.allocation_rule_versions(scope_id,source_draft_id);
create index financial_activated_by_idx on public.allocation_rule_versions(activated_by) where activated_by is not null;
create function private.immutable_active_financial_rule() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status='active' or (tg_op='UPDATE' and new.status='active') then raise exception 'Active variants are immutable; create an explicit new variant' using errcode='42501'; end if;
 if tg_op='DELETE' then return old; end if;return new;
end $$;
create trigger immutable_active_financial_rule before update or delete on public.allocation_rule_versions for each row execute function private.immutable_active_financial_rule();

create function private.activate_financial_rule(scope uuid,target uuid,expected_revision integer,basis_revision integer,request_key uuid,supersedes uuid,note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.allocation_rule_versions; b public.resolutions; c public.financial_categories; old public.allocation_rule_versions; fresh public.allocation_rule_versions;
 input jsonb; participants jsonb; result uuid; building uuid;
begin
 if not private.has_scope_permission(scope,'publish_rules') then raise exception 'Publish forbidden' using errcode='42501'; end if;
 if request_key is null or note is null or length(btrim(note)) not between 1 and 1000 then raise exception 'Request UUID and reason required' using errcode='23514'; end if;
 input:=jsonb_build_object('scope',scope,'target',target,'expected_revision',expected_revision,'basis_revision',basis_revision,'supersedes',supersedes,'note',btrim(note));
 perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||':'||request_key::text,0));
 perform pg_advisory_xact_lock(hashtextextended(scope::text||':common_repair:POOL',0));
 if not private.has_scope_permission(scope,'publish_rules') then raise exception 'Publish forbidden' using errcode='42501'; end if;
 select * into old from public.allocation_rule_versions where activated_by=private.actor() and activation_request_key=request_key;
 if found then
  if old.activation_input is distinct from input then raise exception 'Request key reused with different input' using errcode='PT409'; end if;
  return old.id;
 end if;
 select * into r from public.allocation_rule_versions v where v.scope_id=scope and v.id=target for update;
 if not found then raise exception 'Draft unavailable' using errcode='42501'; end if;
 if r.revision is distinct from expected_revision then raise exception 'Rule changed; reload' using errcode='PT409'; end if;
 if r.status<>'draft' or r.category_id<>'f0100000-0000-4000-8000-000000000002'::uuid then raise exception 'Supported draft required' using errcode='23514'; end if;
 select * into b from public.resolutions where id=r.resolution_id and scope_id=scope for update;
 if b.revision is distinct from basis_revision or r.resolution_snapshot is distinct from to_jsonb(b) then raise exception 'Basis changed; explicitly refresh draft' using errcode='PT409'; end if;
 if b.verification_status<>'reviewed' or b.reviewed_by is null or b.reviewed_revision<>b.revision then raise exception 'Current reviewed basis required' using errcode='23514'; end if;
 perform private.validate_financial_evidence(b,b.evidence);perform private.validate_financial_applicability(b,b.applicability);
 if cardinality(private.financial_basis_gaps(b))<>0 or r.valid_to is null or r.valid_from<b.effective_from or r.valid_to>b.effective_to
 or (b.evidence->>'due_on')::date<r.valid_from or (b.evidence->>'due_on')::date>=r.valid_to then raise exception 'Incomplete basis or invalid activation period' using errcode='23514'; end if;
 select building_id into building from public.management_units where id=scope and mode='building';
 perform 1 from public.units u join public.unit_scope_periods p on p.unit_id=u.id and p.scope_id=scope where u.id in(select value::uuid from jsonb_array_elements_text(b.evidence->'unit_ids')) for share of u,p;
 if building is null or r.denominator_building_id<>building or jsonb_array_length(b.evidence->'unit_ids')<4
 or (select count(*) from public.units where building_id=building)<>jsonb_array_length(b.evidence->'unit_ids')
 or exists(select 1 from jsonb_array_elements_text(b.evidence->'unit_ids') x where not exists(select 1 from public.unit_scope_periods p where p.scope_id=scope and p.unit_id=x::uuid and daterange(p.valid_from,p.valid_to,'[)') @> daterange(r.valid_from,r.valid_to,'[)')))
 then raise exception 'Incomplete known participant set or uncovered scope period' using errcode='23514'; end if;
 select * into c from public.financial_categories where id=r.category_id;
 if exists(select 1 from public.allocation_rule_versions where source_draft_id=target and source_draft_revision=expected_revision) then raise exception 'Draft revision already activated' using errcode='PT409'; end if;
 if supersedes is not null then
  select * into old from public.allocation_rule_versions where id=supersedes and scope_id=scope and status='active' for update;
  if not found or old.valid_from<>r.valid_from or old.valid_to is distinct from r.valid_to or old.mode<>r.mode
  or (select code from public.financial_categories where id=old.category_id)<>c.code
  or exists(select 1 from public.allocation_rule_versions where supersedes_id=supersedes) then raise exception 'Correction requires the current variant and identical period' using errcode='PT409'; end if;
 end if;
 if exists(select 1 from public.allocation_rule_versions a join public.financial_categories cat on cat.id=a.category_id where a.scope_id=scope and a.status='active' and cat.code=c.code and a.mode=r.mode
 and a.id is distinct from supersedes and not exists(select 1 from public.allocation_rule_versions child where child.supersedes_id=a.id)
 and daterange(a.valid_from,a.valid_to,'[)') && daterange(r.valid_from,r.valid_to,'[)')) then raise exception 'Active rule period conflict' using errcode='PT409'; end if;
 select jsonb_agg(jsonb_build_object('unit',to_jsonb(u),'scope_period',to_jsonb(p)) order by u.id) into participants from public.units u join public.unit_scope_periods p on p.unit_id=u.id and p.scope_id=scope
 where u.id in(select value::uuid from jsonb_array_elements_text(b.evidence->'unit_ids')) and daterange(p.valid_from,p.valid_to,'[)') @> daterange(r.valid_from,r.valid_to,'[)');
 if not private.has_scope_permission(scope,'publish_rules') then raise exception 'Publish forbidden' using errcode='42501'; end if;
 result:=gen_random_uuid();
 insert into public.allocation_rule_versions(id,scope_id,category_id,resolution_id,resolution_snapshot,method,mode,config,denominator_building_id,valid_from,valid_to,status,verification_status,recorded_by,modified_by,
 source_draft_id,source_draft_revision,activation_snapshot,activation_input,activation_request_key,activated_by,activated_at,supersedes_id)
 values(result,scope,r.category_id,b.id,to_jsonb(b),r.method,r.mode,r.config,building,r.valid_from,r.valid_to,'active','reviewed',private.actor(),private.actor(),target,r.revision,
 jsonb_build_object('schema_version','fnd05-activation-v1','catalog',to_jsonb(c),'basis',to_jsonb(b),'draft',to_jsonb(r),'participants',participants,'allocation_parameters',r.config,'legal_gate','zues_17_2_5_2023'),input,request_key,private.actor(),clock_timestamp(),supersedes)
 returning * into fresh;
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta) values(scope,private.actor(),'activate_financial_rule','allocation_rule_version',result,btrim(note),jsonb_build_object('supersedes',supersedes,'after',to_jsonb(fresh)));
 return result;
end $$;
create function public.activate_financial_rule(scope uuid,target uuid,expected_revision integer,basis_revision integer,request_key uuid,supersedes uuid,note text)
returns uuid language sql security invoker set search_path='' as $$select private.activate_financial_rule(scope,target,expected_revision,basis_revision,request_key,supersedes,note)$$;
revoke all on function private.validate_financial_applicability(public.resolutions,jsonb),private.save_financial_applicability(uuid,uuid,integer,jsonb,text),public.save_financial_applicability(uuid,uuid,integer,jsonb,text),
 private.immutable_active_financial_rule(),private.activate_financial_rule(uuid,uuid,integer,integer,uuid,uuid,text),public.activate_financial_rule(uuid,uuid,integer,integer,uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.save_financial_applicability(uuid,uuid,integer,jsonb,text),public.save_financial_applicability(uuid,uuid,integer,jsonb,text),
 private.activate_financial_rule(uuid,uuid,integer,integer,uuid,uuid,text),public.activate_financial_rule(uuid,uuid,integer,integer,uuid,uuid,text) to authenticated;

create or replace function private.review_financial_basis(scope uuid,target uuid,expected_revision integer,outcome text,note text)
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
  perform private.validate_financial_evidence(old,old.evidence);if old.applicability<>'{}'::jsonb then perform private.validate_financial_applicability(old,old.applicability);end if;
  if cardinality(private.financial_basis_gaps(old))<>0 then raise exception 'Incomplete basis; review gaps' using errcode='23514'; end if;
 end if;
 update public.resolutions set verification_status=outcome,reviewed_by=private.actor(),reviewed_at=clock_timestamp(),reviewed_revision=revision+1,
 review_note=btrim(note),revision=revision+1,modified_by=private.actor(),modified_at=clock_timestamp() where id=target returning * into fresh;
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta)
 values(scope,private.actor(),'review_financial_basis','resolution',target,btrim(note),jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(fresh)));
 return target;
end $$;

create or replace function private.financial_draft_feed() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'scopes',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'label',s.label,'mode',s.mode,'can_prepare',(private.has_scope_permission(s.id,'prepare_rules') and s.mode='building'),'can_review',(private.has_scope_permission(s.id,'publish_rules') and s.mode='building')) order by s.label),'[]') from public.management_units s where private.can_read_financial_drafts(s.id)),
 'catalog',(select coalesce(jsonb_agg(to_jsonb(c) order by c.code,c.version),'[]') from public.financial_categories c where exists(select 1 from public.management_units s where private.can_read_financial_drafts(s.id))),
 'resolutions',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('evidence_gaps',private.financial_basis_gaps(r)) order by r.recorded_at,r.id),'[]') from public.resolutions r where private.can_read_financial_drafts(r.scope_id)),
 'units',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'scope_id',s.id,'unit_type',u.unit_type,'unit_number',u.unit_number) order by u.id),'[]') from public.units u join public.management_units s on s.building_id=u.building_id and s.mode='building' where private.can_read_financial_drafts(s.id)),
 'rules',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('basis_changed',r.resolution_snapshot->>'revision' is distinct from b.revision::text) order by r.recorded_at,r.id),'[]') from public.allocation_rule_versions r join public.resolutions b on b.scope_id=r.scope_id and b.id=r.resolution_id where private.can_read_financial_drafts(r.scope_id)),
 'history',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'target_id',a.target_id,'action',a.action,'actor_profile_id',a.actor_profile_id,'at',a.happened_at,'reason',a.reason,'change',a.safe_delta) order by a.happened_at,a.id),'[]') from public.audit_events a where a.action in('save_financial_resolution','save_financial_rule','save_financial_basis_evidence','review_financial_basis','save_financial_applicability','activate_financial_rule') and private.can_read_financial_drafts(a.scope_id)))
$$;
