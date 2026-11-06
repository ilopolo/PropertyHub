-- Calculation artifacts only: no obligations, charges, ledger or money movements.
insert into public.role_permissions(role_code,permission_code) values('manager','prepare_charges'),('cashier','prepare_charges');
create table public.financial_previews(
 id uuid primary key default gen_random_uuid(),scope_id uuid not null references public.management_units,
 rule_id uuid not null,share_version_id uuid not null,reference_date date not null,
 input_token text not null,inputs jsonb not null,result jsonb not null,
 policy text not null check(policy='largest-remainder-unit-id-v1'),
 request_key uuid not null,request_input jsonb not null,
 recorded_by uuid not null references public.profiles,recorded_at timestamptz not null default clock_timestamp(),
 note text not null check(length(btrim(note)) between 1 and 1000),
 foreign key(scope_id,rule_id) references public.allocation_rule_versions(scope_id,id),
 foreign key(scope_id,share_version_id) references public.unit_share_versions(scope_id,id),unique(recorded_by,request_key)
);
create index financial_preview_scope_idx on public.financial_previews(scope_id,recorded_at);
create index financial_preview_rule_idx on public.financial_previews(rule_id);
create index financial_preview_share_idx on public.financial_previews(share_version_id);
create index financial_preview_actor_idx on public.financial_previews(recorded_by);
create function private.can_read_financial_preview(scope uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_scope_permission(scope,'read_rules') or private.has_scope_permission(scope,'prepare_charges') $$;
create function private.immutable_financial_preview() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Preview snapshots are immutable' using errcode='42501';end $$;
create trigger immutable_financial_preview before update or delete on public.financial_previews for each row execute function private.immutable_financial_preview();

create function private.financial_preview_inputs(scope uuid,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.allocation_rule_versions;v public.unit_share_versions;b public.unit_share_bases;review public.unit_share_verifications;
 at_date date;uid uuid;owners jsonb;rows jsonb:='[]';share_row jsonb;unit public.units;oreview public.ownership_set_reviews;basis public.resolutions;
begin
 if p is null or jsonb_typeof(p)<>'object' or p-array['rule_id','share_version_id','reference_date']<>'{}'::jsonb
 or p->>'rule_id' is null or p->>'share_version_id' is null or p->>'reference_date' is null then raise exception 'preview_input_fields' using errcode='23514';end if;
 at_date:=private.share_date(p->>'reference_date');
 -- Short conservative MVP read barrier, including phantom inserts. No waiting/retry loop.
 begin
  lock table public.allocation_rule_versions,public.unit_share_bases,public.unit_share_versions,public.unit_share_verifications,
   public.units,public.unit_scope_periods,public.ownership_periods,public.ownership_set_reviews,public.persons in share mode nowait;
 exception when lock_not_available then raise exception 'preview_inputs_busy' using errcode='PT409';end;
 select * into r from public.allocation_rule_versions where id=(p->>'rule_id')::uuid and scope_id=scope;
 if not found then raise exception 'preview_rule_unavailable' using errcode='42501';end if;
 if r.status<>'active' or r.method<>'ideal_shares' or r.mode<>'POOL' or r.category_id<>'f0100000-0000-4000-8000-000000000002'::uuid
 or r.activation_snapshot->>'schema_version' is distinct from 'fnd05-activation-v1'
 or exists(select 1 from public.allocation_rule_versions where supersedes_id=r.id)
 then raise exception 'preview_current_active_rule_required' using errcode='23514';end if;
 if not daterange(r.valid_from,r.valid_to,'[)') @> at_date then raise exception 'preview_rule_date' using errcode='23514';end if;
 select * into basis from jsonb_populate_record(null::public.resolutions,r.activation_snapshot->'basis');
 perform private.validate_financial_evidence(basis,basis.evidence);perform private.validate_financial_applicability(basis,basis.applicability);
 if basis.verification_status<>'reviewed' or basis.reviewed_revision is distinct from basis.revision or cardinality(private.financial_basis_gaps(basis))<>0
 or r.config->>'denominator' is distinct from 'building_common_parts' or r.config->>'participants' is distinct from 'all_building_units'
 or not exists(select 1 from public.management_units where id=scope and mode='building' and building_id=r.denominator_building_id)
 then raise exception 'preview_pinned_basis_invalid' using errcode='23514';end if;
 select * into v from public.unit_share_versions where id=(p->>'share_version_id')::uuid and scope_id=scope;
 if not found then raise exception 'preview_share_unavailable' using errcode='42501';end if;
 select * into b from public.unit_share_bases where id=v.basis_id;
 if b.kind<>'building' or b.building_id<>r.denominator_building_id then raise exception 'preview_denominator_mismatch' using errcode='23514';end if;
 if b.current_version_id<>v.id then raise exception 'preview_share_version_changed' using errcode='PT409';end if;
 select * into review from public.unit_share_verifications where version_id=v.id;
 if review.id is null or not private.unit_share_review_current(v) then raise exception 'preview_share_unverified' using errcode='23514';end if;
 if not daterange((v.packet->'interval'->>'valid_from')::date,(v.packet->'interval'->>'valid_to')::date,'[)') @> at_date then raise exception 'preview_share_date' using errcode='23514';end if;
 if (select jsonb_agg(value::uuid order by value::uuid) from jsonb_array_elements_text(v.packet->'participants'->'unit_ids')) is distinct from
 (select jsonb_agg(value::uuid order by value::uuid) from jsonb_array_elements_text(basis.evidence->'unit_ids')) then raise exception 'preview_participants_mismatch' using errcode='23514';end if;
 for uid in select value::uuid from jsonb_array_elements_text(v.packet->'participants'->'unit_ids') order by value::uuid loop
  select * into unit from public.units where id=uid;
  select x into share_row from jsonb_array_elements(review.snapshot->'rows') x where (x->>'unit_id')::uuid=uid and daterange((x->>'valid_from')::date,(x->>'valid_to')::date,'[)') @> at_date;
  if share_row is null then raise exception 'preview_share_row_missing' using errcode='23514';end if;
  select * into oreview from public.ownership_set_reviews where scope_id=scope and unit_id=uid and as_of=at_date
   and fingerprint=private.ownership_fingerprint(scope,uid,at_date) order by reviewed_at desc,id desc limit 1;
  if oreview.id is null or (select sum(ownership_fraction) from public.ownership_periods where scope_id=scope and unit_id=uid and record_state='current' and daterange(valid_from,valid_to,'[)') @> at_date) is distinct from 1::numeric
  or exists(select 1 from public.ownership_periods o join public.persons person on person.id=o.person_id where o.scope_id=scope and o.unit_id=uid and o.record_state='current' and daterange(o.valid_from,o.valid_to,'[)') @> at_date
    and(o.verification_status<>'verified' or person.verification_status<>'verified' or person.status<>'active' or person.revision<>o.person_revision))
  then raise exception 'preview_ownership_unverified' using errcode='23514',detail=uid::text;end if;
  select jsonb_agg(jsonb_build_object('ownership_id',o.id,'person_id',o.person_id,'person_revision',o.person_revision,'label',o.person_label,
   'fraction',o.ownership_fraction::text,'valid_from',o.valid_from,'valid_to',o.valid_to,'source_reference',o.source_reference,'verified_by',o.verified_by,'verified_at',o.verified_at) order by o.person_id,o.id)
   into owners from public.ownership_periods o where o.scope_id=scope and o.unit_id=uid and o.record_state='current' and daterange(o.valid_from,o.valid_to,'[)') @> at_date;
  rows:=rows||jsonb_build_array(jsonb_build_object('unit_id',uid,'unit_number',unit.unit_number,'percentage',share_row->'percentage','share_row_id',share_row->'id','owners_context',owners,'ownership_review',to_jsonb(oreview),
   'scope_periods',(select jsonb_agg(to_jsonb(sp) order by sp.id) from public.unit_scope_periods sp where sp.scope_id=scope and sp.unit_id=uid and daterange(sp.valid_from,sp.valid_to,'[)') @> at_date)));
 end loop;
 return jsonb_build_object('schema_version','fnd05-preview-input-v1','scope_id',scope,'reference_date',at_date,'rule_id',r.id,'rule_revision',r.revision,'activation_snapshot',r.activation_snapshot,
 'share_version_id',v.id,'share_revision',v.revision,'share_review_id',review.id,'share_snapshot',review.snapshot,'building_id',b.building_id,
 'collection_amount',basis.evidence->'target_collection','policy','largest-remainder-unit-id-v1','liability_status','unresolved_no_personal_amounts','units',rows);
end $$;

create function private.calculate_financial_preview(inputs jsonb) returns jsonb language sql immutable set search_path='' as $$
 with source as(select (inputs->>'collection_amount')::numeric*100 total),
 quota as(select (x->>'unit_id')::uuid unit_id,((x->>'percentage')::numeric*100000000)::bigint share_units,total*((x->>'percentage')::numeric*100000000) numerator,total from source,jsonb_array_elements(inputs->'units') x),
 floors as(select *,floor(numerator/10000000000)::bigint floor_cents,mod(numerator,10000000000)::bigint remainder from quota),
 ranked as(select *,row_number() over(order by remainder desc,unit_id) rank,total-sum(floor_cents) over() residual_count from floors),
 result as(select *,case when rank<=residual_count then 1 else 0 end extra from ranked)
 select jsonb_build_object('policy','largest-remainder-unit-id-v1','total_cents',(select total::bigint::text from source),'currency','EUR',
 'rows',jsonb_agg(jsonb_build_object('unit_id',unit_id,'percentage_units',share_units::text,'quota_numerator',floor(numerator)::text,'remainder_denominator','10000000000','floor_cents',floor_cents::text,
 'remainder_numerator',remainder::text,'residual_cent',extra=1,'amount_cents',(floor_cents+extra)::text,'amount',to_char((floor_cents+extra)::numeric/100,'FM999999999999990.00')) order by unit_id)) from result
$$;
create function private.load_financial_preview_inputs(scope uuid,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare inputs jsonb;
begin
 if not private.can_read_financial_preview(scope) then raise exception 'Preview read forbidden' using errcode='42501';end if;
 inputs:=private.financial_preview_inputs(scope,payload);
 if not private.can_read_financial_preview(scope) then raise exception 'Preview read revoked' using errcode='42501';end if;
 return jsonb_build_object('input_token',md5(inputs::text),'inputs',inputs);
end $$;
create function public.load_financial_preview_inputs(scope uuid,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.load_financial_preview_inputs(scope,payload)$$;
create function private.create_financial_preview(scope uuid,payload jsonb,expected_token text,request_key uuid,note text) returns uuid language plpgsql security definer set search_path='' as $$
declare inputs jsonb;result jsonb;old public.financial_previews;request jsonb;id uuid;
begin
 if not private.has_scope_permission(scope,'prepare_charges') then raise exception 'Preview preparation forbidden' using errcode='42501';end if;
 if expected_token is null or request_key is null or note is null or length(btrim(note)) not between 1 and 1000 then raise exception 'preview_request_required' using errcode='23514';end if;
 request:=jsonb_build_object('scope',scope,'payload',payload,'expected_token',expected_token,'note',btrim(note));
 perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||':preview:'||request_key::text,0));
 select * into old from public.financial_previews where recorded_by=private.actor() and financial_previews.request_key=create_financial_preview.request_key;
 if found then if old.request_input is distinct from request then raise exception 'preview_request_changed' using errcode='PT409';end if;return old.id;end if;
 inputs:=private.financial_preview_inputs(scope,payload);
 if md5(inputs::text)<>expected_token then raise exception 'preview_inputs_changed' using errcode='PT409';end if;
 result:=private.calculate_financial_preview(inputs);
 if (select sum((x->>'amount_cents')::numeric) from jsonb_array_elements(result->'rows') x) is distinct from (inputs->>'collection_amount')::numeric*100 then raise exception 'preview_total_mismatch' using errcode='23514';end if;
 if not private.has_scope_permission(scope,'prepare_charges') then raise exception 'Preview preparation revoked' using errcode='42501';end if;
 insert into public.financial_previews(scope_id,rule_id,share_version_id,reference_date,input_token,inputs,result,policy,request_key,request_input,recorded_by,note)
 values(scope,(payload->>'rule_id')::uuid,(payload->>'share_version_id')::uuid,(payload->>'reference_date')::date,expected_token,inputs,result,'largest-remainder-unit-id-v1',request_key,request,private.actor(),btrim(note)) returning financial_previews.id into id;
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta) values(scope,private.actor(),'create_financial_preview','financial_preview',id,btrim(note),jsonb_build_object('input_token',expected_token,'rule_id',payload->'rule_id','share_version_id',payload->'share_version_id','policy','largest-remainder-unit-id-v1'));
 return id;
end $$;
create function public.create_financial_preview(scope uuid,payload jsonb,expected_token text,request_key uuid,note text) returns uuid language sql security invoker set search_path='' as $$select private.create_financial_preview(scope,payload,expected_token,request_key,note)$$;
create function private.financial_preview_feed() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'scopes',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'label',s.label,'can_prepare',private.has_scope_permission(s.id,'prepare_charges')) order by s.id),'[]') from public.management_units s where private.can_read_financial_preview(s.id)),
 'rules',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'scope_id',r.scope_id,'valid_from',r.valid_from,'valid_to',r.valid_to,'label',r.resolution_snapshot->>'reference') order by r.id),'[]') from public.allocation_rule_versions r where private.can_read_financial_preview(r.scope_id) and r.status='active' and not exists(select 1 from public.allocation_rule_versions child where child.supersedes_id=r.id)),
 'shares',(select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'scope_id',v.scope_id,'revision',v.revision,'basis_id',v.basis_id,'label',v.packet->>'common_parts_reference') order by v.id),'[]') from public.unit_share_bases b join public.unit_share_versions v on v.id=b.current_version_id where private.can_read_financial_preview(v.scope_id)),
 'previews',(select coalesce(jsonb_agg(to_jsonb(p)-array['request_input','request_key'] order by p.recorded_at,p.id),'[]') from public.financial_previews p where private.can_read_financial_preview(p.scope_id)))
$$;
create function public.financial_preview_feed() returns jsonb language sql stable security invoker set search_path='' as $$select private.financial_preview_feed()$$;
alter table public.financial_previews enable row level security;
revoke all on public.financial_previews from public,anon,authenticated;
grant select(id,scope_id,rule_id,share_version_id,reference_date,input_token,inputs,result,policy,recorded_by,recorded_at,note) on public.financial_previews to authenticated;
create policy financial_preview_read on public.financial_previews for select to authenticated using(private.can_read_financial_preview(scope_id));
revoke all on function private.can_read_financial_preview(uuid),private.immutable_financial_preview(),private.financial_preview_inputs(uuid,jsonb),private.calculate_financial_preview(jsonb),private.load_financial_preview_inputs(uuid,jsonb),public.load_financial_preview_inputs(uuid,jsonb),private.create_financial_preview(uuid,jsonb,text,uuid,text),public.create_financial_preview(uuid,jsonb,text,uuid,text),private.financial_preview_feed(),public.financial_preview_feed() from public,anon,authenticated;
grant execute on function private.can_read_financial_preview(uuid),private.load_financial_preview_inputs(uuid,jsonb),public.load_financial_preview_inputs(uuid,jsonb),private.create_financial_preview(uuid,jsonb,text,uuid,text),public.create_financial_preview(uuid,jsonb,text,uuid,text),private.financial_preview_feed(),public.financial_preview_feed() to authenticated;
