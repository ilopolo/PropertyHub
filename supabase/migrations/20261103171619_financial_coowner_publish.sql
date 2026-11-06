-- Local B/2 only: explicit version routing; no backfill/recalculation of published A snapshots.
alter table public.charge_batches add column publication_model text not null default 'sole-owner-v1'
 check(publication_model in('sole-owner-v1','ordinary-coowner-v1'));
alter table public.obligation_parties drop constraint obligation_parties_charge_id_key;
alter table public.obligation_parties add constraint obligation_party_person unique(charge_id,person_id);

-- Exact SQL counterpart of the existing B/1 allocator, tested against allocatePersonal.
-- Only server-derived, verified roster reaches this helper. No new public arithmetic endpoint.
create function private.allocate_personal_cents(amount text,roster jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare total numeric;den constant numeric:=10000000000;row jsonb;q text;weight numeric;items jsonb:='[]';floors numeric:=0;k integer;answer jsonb;
begin
 if amount is null or amount !~ '^(0|[1-9][0-9]*)$' then raise exception 'invalid_amount_cents' using errcode='23514';end if;
 if jsonb_typeof(roster) is distinct from 'array' or jsonb_array_length(roster)=0 then raise exception 'missing_roster' using errcode='23514';end if;
 if (select count(distinct (x->>'person_id')::uuid) from jsonb_array_elements(roster) x)<>jsonb_array_length(roster) then raise exception 'duplicate_participant' using errcode='23514';end if;
 total:=0;
 for row in select value from jsonb_array_elements(roster) loop
  if row->>'person_id' is null then raise exception 'invalid_person_id' using errcode='23514';end if;
  q:=row->>'ownership_fraction';
  if q is null then raise exception 'missing_fraction' using errcode='23514';end if;
  if q !~ '^(0|1)(\.[0-9]{1,10})?$' then raise exception 'unsupported_fraction_representation' using errcode='23514';end if;
  weight:=q::numeric*den;if weight<=0 or weight>den then raise exception 'invalid_fraction' using errcode='23514';end if;
  total:=total+weight;floors:=floors+div(amount::numeric*weight,den);
  items:=items||jsonb_build_array(jsonb_build_object('person_id',(row->>'person_id')::uuid,'ownership_units',weight::bigint::text,
   'quota_numerator',trunc(amount::numeric*weight)::text,'remainder_denominator',den::bigint::text,
   'floor_cents',trunc(div(amount::numeric*weight,den))::text,'remainder_numerator',trunc(mod(amount::numeric*weight,den))::text));
 end loop;
 if total<>den then raise exception 'incomplete_or_excess_fraction_total' using errcode='23514';end if;
 k:=(amount::numeric-floors)::integer;
 select jsonb_agg(x||jsonb_build_object('residual_cent',rank<=k,'amount_cents',((x->>'floor_cents')::numeric+case when rank<=k then 1 else 0 end)::text) order by (x->>'person_id')::uuid)
 into answer from(select x,row_number() over(order by(x->>'remainder_numerator')::numeric desc,(x->>'person_id')::uuid) rank from jsonb_array_elements(items) x) ranked;
 return jsonb_build_object('policy','largest-remainder-person-id-v1','currency','EUR','total_cents',amount,'rows',answer);
end $$;
revoke all on function private.allocate_personal_cents(text,jsonb) from public,anon,authenticated;

create or replace function private.charge_claim(p jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare k text;v text;result jsonb:='{}';
begin
 if p is null or jsonb_typeof(p)<>'object' or p-array['preview_id','liability_date','liability_event','legal_reference','evidence_reference','creditor_reference','replaces_batch_id','publication_model']<>'{}'
 then raise exception 'charge_fields' using errcode='23514';end if;
 if p->>'preview_id' is null then raise exception 'charge_preview_required' using errcode='23514';end if;
 result:=jsonb_build_object('preview_id',(p->>'preview_id')::uuid,'replaces_batch_id',nullif(p->>'replaces_batch_id','')::uuid,
   'liability_date',case when nullif(p->>'liability_date','') is not null then private.share_date(p->>'liability_date') else null end);
 foreach k in array array['liability_event','legal_reference','evidence_reference','creditor_reference'] loop
  if p->k is not null and p->k<>'null'::jsonb and jsonb_typeof(p->k)<>'string' then raise exception 'charge_text' using errcode='23514';end if;
  v:=nullif(btrim(p->>k),'');if v is not null and length(v)>1000 then raise exception 'charge_text_length' using errcode='23514';end if;
  result:=result||jsonb_build_object(k,v);
 end loop;
 if p ? 'publication_model' then
  if p->>'publication_model' is distinct from 'ordinary-coowner-v1' and p->>'publication_model' is distinct from 'sole-owner-v1' then raise exception 'charge_publication_model' using errcode='23514';end if;
  -- Omitted/default A retains its byte-for-byte prior claim/token shape.
  if p->>'publication_model'='ordinary-coowner-v1' then result:=result||jsonb_build_object('publication_model','ordinary-coowner-v1');end if;
 end if;
 return result;
end $$;

create or replace function private.charge_publication_inputs(scope uuid,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb:=private.charge_claim(p);pv public.financial_previews;r public.allocation_rule_versions;b public.resolutions;
 current_inputs jsonb;today date:=private.charge_publication_day();m date;l date;due date;d date;
 gaps text[]:='{}';uid uuid;n integer;o public.ownership_periods;person public.persons;parties jsonb:='[]';row jsonb;rowsum numeric;oreview public.ownership_set_reviews;roster jsonb;allocation jsonb;ap jsonb;coowner boolean:=c->>'publication_model'='ordinary-coowner-v1';
begin
 if not private.can_read_charge_batches(scope) then raise exception 'charge_read_forbidden' using errcode='42501';end if;
 begin lock table public.resolutions in share mode nowait;
 exception when lock_not_available then raise exception 'charge_inputs_busy' using errcode='PT409';end;
 select * into pv from public.financial_previews where id=(c->>'preview_id')::uuid and scope_id=scope;
 if not found then raise exception 'charge_preview_unavailable' using errcode='42501';end if;
 current_inputs:=private.financial_preview_inputs(scope,jsonb_build_object('rule_id',pv.rule_id,'share_version_id',pv.share_version_id,'reference_date',pv.reference_date));
 if md5(current_inputs::text)<>pv.input_token then raise exception 'charge_preview_inputs_changed' using errcode='PT409';end if;
 select * into r from public.allocation_rule_versions where id=pv.rule_id;
 select * into b from public.resolutions where id=r.resolution_id and scope_id=scope;
 if to_jsonb(b) is distinct from r.activation_snapshot->'basis' or b.verification_status<>'reviewed' or b.reviewed_revision<>b.revision
 then raise exception 'charge_basis_changed' using errcode='PT409';end if;
 m:=b.meeting_date;l:=(c->>'liability_date')::date;due:=(b.evidence->>'due_on')::date;d:=pv.reference_date;
 if m>today then gaps:=array_append(gaps,'decision_after_publication_day');end if;
 if l is null then gaps:=array_append(gaps,'liability_date_required');elsif l<m or l>today then gaps:=array_append(gaps,'liability_date_outside_M_T');end if;
 if d<m or d>today then gaps:=array_append(gaps,'preview_date_outside_M_T');end if;
 if due is null or due<m then gaps:=array_append(gaps,'due_date_required');end if;
 if c->>'liability_event' is null then gaps:=array_append(gaps,'liability_event_required');end if;
 if c->>'legal_reference' is null then gaps:=array_append(gaps,'legal_reference_required');end if;
 if c->>'evidence_reference' is null then gaps:=array_append(gaps,'evidence_reference_required');end if;
 if c->>'creditor_reference' is null then gaps:=array_append(gaps,'creditor_reference_required');end if;
 if pv.policy<>'largest-remainder-unit-id-v1' or pv.result->>'policy'<>pv.policy
 or (pv.result->>'total_cents')::numeric<>(current_inputs->>'collection_amount')::numeric*100
 then raise exception 'charge_preview_total_invalid' using errcode='23514';end if;
 select sum((x->>'amount_cents')::numeric) into rowsum from jsonb_array_elements(pv.result->'rows') x;
 if rowsum is distinct from (pv.result->>'total_cents')::numeric
 or jsonb_array_length(pv.result->'rows')<>jsonb_array_length(current_inputs->'units')
 or (select count(distinct x->>'unit_id') from jsonb_array_elements(pv.result->'rows') x)<>jsonb_array_length(pv.result->'rows')
 then raise exception 'charge_preview_total_invalid' using errcode='23514';end if;
 for row in select value from jsonb_array_elements(pv.result->'rows') order by(value->>'unit_id')::uuid loop
  uid:=(row->>'unit_id')::uuid;
  if (row->>'amount_cents')::numeric<0 or (row->>'amount')::numeric*100<>(row->>'amount_cents')::numeric
  or not exists(select 1 from jsonb_array_elements(current_inputs->'units') x where(x->>'unit_id')::uuid=uid)
  then raise exception 'charge_preview_row_invalid' using errcode='23514';end if;
  if coowner then
   -- A complete reviewed set at L, not a list or amounts supplied by the client.
   select * into oreview from public.ownership_set_reviews where scope_id=scope and unit_id=uid and as_of=l
    and fingerprint=private.ownership_fingerprint(scope,uid,l) order by reviewed_at desc,id desc limit 1;
   select coalesce(jsonb_agg(jsonb_build_object('person_id',own.person_id,'ownership_fraction',own.ownership_fraction::text) order by own.person_id),'[]') into roster
    from public.ownership_periods own where own.scope_id=scope and own.unit_id=uid and own.record_state='current' and daterange(own.valid_from,own.valid_to,'[)')&&daterange(m,greatest(m,today)+1,'[)');
   if oreview.id is null then gaps:=array_append(gaps,'coowner_complete_review_required:'||uid::text);
   elsif (select array_agg(own.id order by own.id) from public.ownership_periods own where own.scope_id=scope and own.unit_id=uid and own.record_state='current' and daterange(own.valid_from,own.valid_to,'[)')&&daterange(m,greatest(m,today)+1,'[)')) is distinct from
     (select array_agg(x order by x) from unnest(oreview.record_ids) x)
    or exists(select 1 from public.ownership_periods own left join public.persons pr on pr.id=own.person_id and pr.scope_id=scope
     where own.scope_id=scope and own.unit_id=uid and own.record_state='current' and daterange(own.valid_from,own.valid_to,'[)')&&daterange(m,greatest(m,today)+1,'[)')
     and(not daterange(own.valid_from,own.valid_to,'[)')@>daterange(m,greatest(m,today)+1,'[)') or own.verification_status<>'verified'
      or pr.id is null or pr.status<>'active' or pr.verification_status<>'verified' or pr.revision<>own.person_revision))
    or (select count(distinct x->>'person_id') from jsonb_array_elements(roster) x)<>jsonb_array_length(roster)
    or (select sum((x->>'ownership_fraction')::numeric) from jsonb_array_elements(roster) x) is distinct from 1::numeric
   then gaps:=array_append(gaps,'coowner_unchanged_complete_interval:'||uid::text);
   else
    allocation:=private.allocate_personal_cents(row->>'amount_cents',roster);
    for o in select * from public.ownership_periods where scope_id=scope and unit_id=uid and id=any(oreview.record_ids) order by person_id loop
     select * into person from public.persons where id=o.person_id and scope_id=scope;
     select value into ap from jsonb_array_elements(allocation->'rows') where(value->>'person_id')::uuid=person.id;
     parties:=parties||jsonb_build_array(jsonb_build_object('unit_id',uid,'unit_number',(select u->>'unit_number' from jsonb_array_elements(current_inputs->'units') u where(u->>'unit_id')::uuid=uid),
      'person_id',person.id,'person_revision',person.revision,'person_kind',person.person_kind,'label',person.display_name,
      'ownership_id',o.id,'fraction',o.ownership_fraction::text,'valid_from',o.valid_from,'valid_to',o.valid_to,
      'source_kind',o.source_kind,'source_reference',o.source_reference,'person_source_reference',person.source_reference,
      'verified_by',o.verified_by,'verified_at',o.verified_at,'verification_note',o.verification_note,
      'ownership_review',to_jsonb(oreview),'source_row',to_jsonb(o),'person_source',jsonb_build_object('id',person.id,'revision',person.revision,
       'person_kind',person.person_kind,'status',person.status,'verification_status',person.verification_status,
       'source_kind',person.source_kind,'source_reference',person.source_reference,'known_from',person.known_from,
       'verified_by',person.verified_by,'verified_at',person.verified_at),
      'personal_allocation',ap,'personal_allocation_policy',allocation->'policy',
      'unit_amount_cents',row->>'amount_cents','amount_cents',ap->>'amount_cents','amount',to_char((ap->>'amount_cents')::numeric/100,'FM9999999999999990.00')));
    end loop;
   end if;
  else
  select count(*) into n from public.ownership_periods where scope_id=scope and unit_id=uid and record_state='current'
   and daterange(valid_from,valid_to,'[)')&&daterange(m,greatest(m,today)+1,'[)');
  o:=null;person:=null;
  if n=1 then
   select * into o from public.ownership_periods where scope_id=scope and unit_id=uid and record_state='current'
    and daterange(valid_from,valid_to,'[)')@>daterange(m,greatest(m,today)+1,'[)');
   if o.id is not null then select * into person from public.persons where id=o.person_id and scope_id=scope;end if;
  end if;
  if o.id is null or o.ownership_fraction is distinct from 1 or o.verification_status is distinct from 'verified' or person.id is null
   or person.status is distinct from 'active' or person.verification_status is distinct from 'verified' or person.revision is distinct from o.person_revision
  then gaps:=array_append(gaps,'sole_owner_interval:'||uid::text);
  else
   parties:=parties||jsonb_build_array(jsonb_build_object('unit_id',uid,'unit_number',(select x->>'unit_number' from jsonb_array_elements(current_inputs->'units') x where(x->>'unit_id')::uuid=uid),
    'person_id',person.id,'person_revision',person.revision,'person_kind',person.person_kind,'label',person.display_name,
    'ownership_id',o.id,'fraction',o.ownership_fraction::text,'valid_from',o.valid_from,'valid_to',o.valid_to,
    'source_kind',o.source_kind,'source_reference',o.source_reference,'person_source_reference',person.source_reference,
    'verified_by',o.verified_by,'verified_at',o.verified_at,'verification_note',o.verification_note,
    'amount',row->>'amount','amount_cents',row->>'amount_cents'));
  end if;
  end if;
 end loop;
 return jsonb_build_object('schema_version',case when coowner then 'fnd05-publish-coowner-v1' else 'fnd05-publish-sole-owner-v1' end,'scope_id',scope,'claim',c,'publication_day',today,
  'meeting_date',m,'liability_date',l,'due_date',due,'reference_date',d,'interval_from',m,'interval_to',today+1,
  'preview',to_jsonb(pv),'basis',to_jsonb(b),'parties',parties,'gaps',to_jsonb(gaps));
end $$;

create or replace function private.save_charge_batch(scope uuid,target uuid,expected_revision integer,request_key uuid,payload jsonb,note text) returns uuid language plpgsql security definer set search_path='' as $$
declare c jsonb:=private.charge_claim(payload);x jsonb;old public.charge_batches;fresh public.charge_batches;result uuid;input jsonb;receipt private.charge_operations;r public.allocation_rule_versions;
begin
 if not private.has_scope_permission(scope,'prepare_charges') or(c->>'replaces_batch_id' is not null and not private.has_scope_permission(scope,'correct_finance')) then raise exception 'charge_prepare_forbidden' using errcode='42501';end if;
 if request_key is null or note is null or length(btrim(note)) not between 1 and 1000 then raise exception 'charge_request_required' using errcode='23514';end if;
 input:=jsonb_build_object('action','save','scope',scope,'target',target,'revision',expected_revision,'payload',c,'note',btrim(note));
 perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||':charge:'||request_key::text,0));
 if not private.has_scope_permission(scope,'prepare_charges') or(c->>'replaces_batch_id' is not null and not private.has_scope_permission(scope,'correct_finance')) then raise exception 'charge_prepare_revoked' using errcode='42501';end if;
 select * into receipt from private.charge_operations where actor_id=private.actor() and charge_operations.request_key=save_charge_batch.request_key;
 if found then if receipt.input<>input then raise exception 'charge_request_changed' using errcode='PT409';end if;return receipt.result_id;end if;
 if target is null then if expected_revision is distinct from 0 then raise exception 'charge_revision_changed' using errcode='PT409';end if;
 else
  select * into old from public.charge_batches where id=target and scope_id=scope for update;
  if not found then raise exception 'charge_unavailable' using errcode='42501';end if;
  if old.kind='replacement' and not private.has_scope_permission(scope,'correct_finance') then raise exception 'charge_correction_forbidden' using errcode='42501';end if;
  if old.status<>'draft' or old.revision is distinct from expected_revision then raise exception 'charge_revision_changed' using errcode='PT409';end if;
 end if;
 if c->>'replaces_batch_id' is not null and not exists(select 1 from public.charge_batches where id=(c->>'replaces_batch_id')::uuid and scope_id=scope and status='published' and kind<>'reversal')
 then raise exception 'charge_correction_unavailable' using errcode='42501';end if;
 if c->>'replaces_batch_id' is not null and exists(select 1 from public.charge_batches where id=(c->>'replaces_batch_id')::uuid and publication_model<>coalesce(c->>'publication_model','sole-owner-v1')) then raise exception 'charge_correction_model_mismatch' using errcode='23514';end if;
 x:=private.charge_publication_inputs(scope,c);
 if not private.has_scope_permission(scope,'prepare_charges') or(c->>'replaces_batch_id' is not null and not private.has_scope_permission(scope,'correct_finance')) then raise exception 'charge_prepare_revoked' using errcode='42501';end if;
 select * into r from public.allocation_rule_versions where id=(x->'preview'->>'rule_id')::uuid;
 if target is null then
  insert into public.charge_batches(scope_id,preview_id,category_id,resolution_id,rule_version_id,period_start,period_end,pool_amount,kind,status,claim,preparation_snapshot,preparation_token,replaces_id,recorded_by,note,publication_model)
  values(scope,(c->>'preview_id')::uuid,r.category_id,r.resolution_id,r.id,r.valid_from,r.valid_to,(x->'preview'->'inputs'->>'collection_amount')::numeric,
   case when c->>'replaces_batch_id' is null then 'original' else 'replacement' end,'draft',c,x,md5(x::text),(c->>'replaces_batch_id')::uuid,private.actor(),btrim(note),coalesce(c->>'publication_model','sole-owner-v1')) returning id into result;
 else
  update public.charge_batches set preview_id=(c->>'preview_id')::uuid,category_id=r.category_id,resolution_id=r.resolution_id,rule_version_id=r.id,
   period_start=r.valid_from,period_end=r.valid_to,pool_amount=(x->'preview'->'inputs'->>'collection_amount')::numeric,
   kind=case when c->>'replaces_batch_id' is null then 'original' else 'replacement' end,replaces_id=(c->>'replaces_batch_id')::uuid,
   publication_model=coalesce(c->>'publication_model','sole-owner-v1'),claim=c,preparation_snapshot=x,preparation_token=md5(x::text),revision=old.revision+1,review=null,note=btrim(save_charge_batch.note) where id=target returning id into result;
 end if;
 select * into fresh from public.charge_batches where id=result;
 insert into private.charge_operations values(private.actor(),request_key,input,result,clock_timestamp());
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta) values(scope,private.actor(),'save_charge_batch','charge_batch',result,btrim(note),jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(fresh)));
 return result;
end $$;

create or replace function private.review_charge_batch(scope uuid,target uuid,expected_revision integer,request_key uuid,acknowledged_parties jsonb,note text) returns uuid language plpgsql security definer set search_path='' as $$
declare b public.charge_batches;x jsonb;a jsonb;input jsonb;receipt private.charge_operations;
begin
 if not private.has_scope_permission(scope,'publish_charges') then raise exception 'charge_review_forbidden' using errcode='42501';end if;
 if request_key is null or note is null or length(btrim(note)) not between 1 and 1000 then raise exception 'charge_request_required' using errcode='23514';end if;
 input:=jsonb_build_object('action','review','scope',scope,'target',target,'revision',expected_revision,'parties',acknowledged_parties,'note',btrim(note));
 perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||':charge:'||request_key::text,0));
 select * into b from public.charge_batches where id=target and scope_id=scope for update;
 if not found then raise exception 'charge_unavailable' using errcode='42501';end if;
 if b.kind='replacement' and not private.has_scope_permission(scope,'correct_finance') then raise exception 'charge_correction_forbidden' using errcode='42501';end if;
 if not private.has_scope_permission(scope,'publish_charges') then raise exception 'charge_review_revoked' using errcode='42501';end if;
 select * into receipt from private.charge_operations where actor_id=private.actor() and charge_operations.request_key=review_charge_batch.request_key;
 if found then if receipt.input<>input then raise exception 'charge_request_changed' using errcode='PT409';end if;return receipt.result_id;end if;
 if b.status<>'draft' or b.revision is distinct from expected_revision then raise exception 'charge_revision_changed' using errcode='PT409';end if;
 x:=private.charge_publication_inputs(scope,b.claim);
 if md5(x::text)<>b.preparation_token then raise exception 'charge_inputs_changed_reload' using errcode='PT409';end if;
 if jsonb_array_length(x->'gaps')<>0 then raise exception 'charge_review_gaps' using errcode='23514',detail=(x->'gaps')::text;end if;
 if jsonb_typeof(acknowledged_parties) is distinct from 'array' or jsonb_array_length(acknowledged_parties)<>jsonb_array_length(x->'parties')
 or (select count(distinct jsonb_build_array(ack.value->>'unit_id',ack.value->>'person_id')) from jsonb_array_elements(acknowledged_parties) ack)<>jsonb_array_length(acknowledged_parties)
 then raise exception 'charge_review_each_party' using errcode='23514';end if;
 for a in select value from jsonb_array_elements(acknowledged_parties) loop
  if a-(array['unit_id','person_id','person_revision','ownership_id','evidence_reference']||case when b.publication_model='ordinary-coowner-v1' then array['ownership_regime','quota_representation','coowner_basis_kind','proportionality_reason'] else array[]::text[] end)<>'{}' or jsonb_typeof(a->'evidence_reference') is distinct from 'string'
   or length(btrim(a->>'evidence_reference')) not between 1 and 1000
   or not exists(select 1 from jsonb_array_elements(x->'parties') p where p->>'unit_id'=a->>'unit_id' and p->>'person_id'=a->>'person_id'
     and p->>'ownership_id'=a->>'ownership_id' and p->>'person_revision'=a->>'person_revision')
  then raise exception 'charge_party_ack_mismatch' using errcode='23514';end if;
  if b.publication_model='ordinary-coowner-v1' then
   if a->>'ownership_regime' is distinct from 'ordinary_fractional' then raise exception 'unsupported_regime' using errcode='23514';end if;
   if a->>'quota_representation' is distinct from 'exact_decimal' then raise exception 'unsupported_fraction_representation' using errcode='23514';end if;
   if a->>'coowner_basis_kind' is distinct from 'reviewed_proportional_liability' or jsonb_typeof(a->'proportionality_reason') is distinct from 'string'
    or length(btrim(a->>'proportionality_reason')) not between 1 and 1000 then raise exception 'coowner_proportional_basis_required' using errcode='23514';end if;
  end if;
 end loop;
 if not private.has_scope_permission(scope,'publish_charges') or(b.kind='replacement' and not private.has_scope_permission(scope,'correct_finance')) then raise exception 'charge_review_revoked' using errcode='42501';end if;
 if private.charge_publication_day()<>(x->>'publication_day')::date then raise exception 'charge_day_changed' using errcode='PT409';end if;
 update public.charge_batches set revision=b.revision+1,review=jsonb_build_object('status','reviewed','revision',b.revision+1,'input_token',md5(x::text),
   'publication_day',x->'publication_day','reviewed_by',private.actor(),'reviewed_at',clock_timestamp(),'note',btrim(review_charge_batch.note),'parties',acknowledged_parties) where id=target;
 insert into private.charge_operations values(private.actor(),request_key,input,target,clock_timestamp());
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta) values(scope,private.actor(),'review_charge_batch','charge_batch',target,btrim(note),jsonb_build_object('revision',b.revision+1,'reviewed_input',md5(x::text),'parties',acknowledged_parties));
 return target;
end $$;

create or replace function private.publish_charge_batch(scope uuid,target uuid,expected_revision integer,request_key uuid,note text) returns uuid language plpgsql security definer set search_path='' as $$
declare b public.charge_batches;old public.charge_batches;x jsonb;input jsonb;receipt private.charge_operations;row jsonb;p jsonb;
 cid uuid;rid uuid;oldcharge public.charges;op public.obligation_parties;stamp timestamptz;
begin
 if not private.has_scope_permission(scope,'publish_charges') then raise exception 'charge_publish_forbidden' using errcode='42501';end if;
 if request_key is null or note is null or length(btrim(note)) not between 1 and 1000 then raise exception 'charge_request_required' using errcode='23514';end if;
 input:=jsonb_build_object('action','publish','scope',scope,'target',target,'revision',expected_revision,'note',btrim(note));
 perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||':charge:'||request_key::text,0));
 perform pg_advisory_xact_lock(hashtextextended(scope::text||':charge-publication',0));
 if not private.has_scope_permission(scope,'publish_charges') then raise exception 'charge_publish_revoked' using errcode='42501';end if;
 select * into b from public.charge_batches where id=target and scope_id=scope for update;
 if not found then raise exception 'charge_unavailable' using errcode='42501';end if;
 if b.kind='replacement' and not private.has_scope_permission(scope,'correct_finance') then raise exception 'charge_correction_forbidden' using errcode='42501';end if;
 select * into receipt from private.charge_operations where actor_id=private.actor() and charge_operations.request_key=publish_charge_batch.request_key;
 if found then if receipt.input<>input then raise exception 'charge_request_changed' using errcode='PT409';end if;return receipt.result_id;end if;
 if b.status<>'draft' or b.revision is distinct from expected_revision then raise exception 'charge_revision_changed' using errcode='PT409';end if;
 if b.review is null or b.review->>'status'<>'reviewed' or (b.review->>'revision')::integer<>b.revision then raise exception 'charge_current_review_required' using errcode='23514';end if;
 if (b.review->>'publication_day')::date<>private.charge_publication_day() then raise exception 'charge_day_changed' using errcode='PT409';end if;
 x:=private.charge_publication_inputs(scope,b.claim);
 if md5(x::text)<>b.preparation_token or md5(x::text)<>b.review->>'input_token' then raise exception 'charge_inputs_changed_reload' using errcode='PT409';end if;
 if jsonb_array_length(x->'gaps')<>0 then raise exception 'charge_publish_gaps' using errcode='23514',detail=(x->'gaps')::text;end if;
 if b.kind='original' then
  if exists(select 1 from public.charge_batches where scope_id=scope and status='published' and kind='original'
    and(resolution_id=b.resolution_id or preview_id=b.preview_id or(category_id=b.category_id and period_start=b.period_start and period_end=b.period_end)))
  then raise exception 'charge_business_call_already_published' using errcode='PT409';end if;
 else
  -- Payment tables are deliberately absent. A later payment migration must integrate paid-correction semantics explicitly.
  if to_regclass('public.payments') is not null or to_regclass('public.payment_allocations') is not null then raise exception 'charge_payment_correction_contract_required' using errcode='23514';end if;
  select * into old from public.charge_batches where id=b.replaces_id and scope_id=scope for update;
  if old.id is null or old.status<>'published' or old.kind='reversal' or old.publication_model<>b.publication_model or(old.resolution_id,old.category_id,old.period_start,old.period_end) is distinct from(b.resolution_id,b.category_id,b.period_start,b.period_end)
   or exists(select 1 from public.charge_batches where reverses_id=old.id or(status='published' and replaces_id=old.id))
  then raise exception 'charge_correction_requires_current_unpaid_variant' using errcode='PT409';end if;
  if b.publication_model='ordinary-coowner-v1' and (
   old.pool_amount<>b.pool_amount or exists(
    select 1 from(select c.unit_id,c.amount from public.charges c where c.batch_id=old.id) prior
    full join(select (r->>'unit_id')::uuid unit_id,(r->>'amount')::numeric amount from jsonb_array_elements(x->'preview'->'result'->'rows') r) fresh using(unit_id)
    where prior.unit_id is null or fresh.unit_id is null or prior.amount<>fresh.amount))
  then raise exception 'coowner_correction_preserve_unit_amounts' using errcode='23514';end if;
  stamp:=clock_timestamp();
  insert into public.charge_batches(scope_id,preview_id,category_id,resolution_id,rule_version_id,period_start,period_end,pool_amount,kind,status,claim,preparation_snapshot,preparation_token,publication_snapshot,published_by,published_at,reverses_id,recorded_by,note,publication_model)
  values(scope,old.preview_id,old.category_id,old.resolution_id,old.rule_version_id,old.period_start,old.period_end,-old.pool_amount,'reversal','published',old.claim,old.preparation_snapshot,old.preparation_token,
    jsonb_build_object('schema_version','fnd05-unpaid-reversal-v1','original_id',old.id,'original_snapshot',old.publication_snapshot,'replacement_id',target,'reason',btrim(note),'actor',private.actor(),'at',stamp),private.actor(),stamp,old.id,private.actor(),btrim(note),old.publication_model) returning id into rid;
  for oldcharge in select * from public.charges where batch_id=old.id loop
   insert into public.charges(scope_id,batch_id,unit_id,amount,due_date,unit_snapshot,input_snapshot,assessment_basis,reversal_of_id)
   values(scope,rid,oldcharge.unit_id,-oldcharge.amount,oldcharge.due_date,oldcharge.unit_snapshot,oldcharge.input_snapshot,btrim(note),oldcharge.id) returning id into cid;
   for op in select * from public.obligation_parties where charge_id=oldcharge.id loop
   insert into public.obligation_parties(scope_id,charge_id,person_id,source_ownership_period_id,assessed_amount,liability_date,person_snapshot,party_basis)
   values(scope,cid,op.person_id,op.source_ownership_period_id,-op.assessed_amount,op.liability_date,op.person_snapshot,op.party_basis||jsonb_build_object('reversal_of_party',op.id));
   end loop;
  end loop;
 end if;
 for row in select value from jsonb_array_elements(x->'preview'->'result'->'rows') loop
  insert into public.charges(scope_id,batch_id,unit_id,amount,due_date,unit_snapshot,input_snapshot,assessment_basis)
  values(scope,target,(row->>'unit_id')::uuid,(row->>'amount')::numeric,(x->>'due_date')::date,
   (select value from jsonb_array_elements(x->'preview'->'inputs'->'units') where value->>'unit_id'=row->>'unit_id'),row,btrim(note)) returning id into cid;
  for p in select value from jsonb_array_elements(x->'parties') where value->>'unit_id'=row->>'unit_id' order by(value->>'person_id')::uuid loop
  insert into public.obligation_parties(scope_id,charge_id,person_id,source_ownership_period_id,assessed_amount,liability_date,person_snapshot,party_basis)
  values(scope,cid,(p->>'person_id')::uuid,(p->>'ownership_id')::uuid,(p->>'amount')::numeric,(x->>'liability_date')::date,p,
   jsonb_build_object('claim',b.claim,'review',b.review,'sole_owner_is_not_legal_certification',true,'payer_is_separate',true,'publication_model',b.publication_model,
     'coowner_basis_kind',case when b.publication_model='ordinary-coowner-v1' then 'reviewed_proportional_liability' else null end,
     'personal_allocation_policy',p->'personal_allocation_policy'));
  end loop;
  if (select sum(assessed_amount) from public.obligation_parties where charge_id=cid) is distinct from (row->>'amount')::numeric
   or(b.publication_model='sole-owner-v1' and(select count(*) from public.obligation_parties where charge_id=cid)<>1)
  then raise exception 'charge_personal_total_invalid' using errcode='23514';end if;
 end loop;
 if not private.has_scope_permission(scope,'publish_charges') or(b.kind='replacement' and not private.has_scope_permission(scope,'correct_finance')) then raise exception 'charge_publish_revoked' using errcode='42501';end if;
 if private.charge_publication_day()<>(x->>'publication_day')::date then raise exception 'charge_day_changed' using errcode='PT409';end if;
 stamp:=clock_timestamp();
 update public.charge_batches set status='published',revision=b.revision+1,publication_snapshot=jsonb_build_object('schema_version','fnd05-published-charge-v1','publication_model',b.publication_model,'inputs',x,'review',b.review,'actor',private.actor(),'at',stamp,'reason',btrim(publish_charge_batch.note),'reversal_batch_id',rid,
   'personal_changes',case when b.publication_model='ordinary-coowner-v1' and old.id is not null then jsonb_build_object(
    'before',(select jsonb_agg(jsonb_build_object('unit_id',c.unit_id,'person_id',p.person_id,'amount',p.assessed_amount,'source',p.source_ownership_period_id) order by c.unit_id,p.person_id) from public.charges c join public.obligation_parties p on p.charge_id=c.id where c.batch_id=old.id),
    'after',x->'parties') else null end),published_by=private.actor(),published_at=stamp where id=target;
 insert into private.charge_operations values(private.actor(),request_key,input,target,clock_timestamp());
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta) values(scope,private.actor(),case when rid is null then 'publish_charge_batch' else 'correct_charge_batch' end,'charge_batch',target,btrim(note),jsonb_build_object('replaces_id',b.replaces_id,'reversal_batch_id',rid,'preview_id',b.preview_id,'revision',b.revision+1));
 return target;
end $$;

create or replace function private.charge_batch_feed() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'scopes',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'can_prepare',private.has_scope_permission(id,'prepare_charges'),'can_publish',private.has_scope_permission(id,'publish_charges'),'can_correct',private.has_scope_permission(id,'correct_finance')) order by label),'[]') from public.management_units where private.can_read_charge_batches(id)),
 'previews',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'scope_id',scope_id,'date',reference_date,'amount',inputs->>'collection_amount','note',note) order by recorded_at,id),'[]') from public.financial_previews where private.can_read_charge_batches(scope_id)),
 'batches',(select coalesce(jsonb_agg(to_jsonb(b)||jsonb_build_object('pool_amount',b.pool_amount::text) order by recorded_at,id),'[]') from public.charge_batches b where private.can_read_charge_batches(scope_id)),
 'charges',(select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('amount',c.amount::text) order by unit_id,id),'[]') from public.charges c where private.can_read_charge_batches(scope_id)),
 'parties',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('assessed_amount',p.assessed_amount::text) order by id),'[]') from public.obligation_parties p where private.can_read_charge_batches(scope_id)),
 'history',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'target_id',target_id,'action',action,'at',happened_at,'actor',actor_profile_id,'reason',reason,'change',safe_delta) order by happened_at,id),'[]') from public.audit_events where action in('save_charge_batch','review_charge_batch','publish_charge_batch','correct_charge_batch') and private.can_read_charge_batches(scope_id)))
$$;

create function public.load_charge_batch_inputs_v2(scope uuid,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.load_charge_batch_inputs(scope,payload)$$;
create or replace function public.load_charge_batch_inputs(scope uuid,payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
begin if payload->>'publication_model'='ordinary-coowner-v1' then raise exception 'charge_versioned_client_required' using errcode='23514';end if;return private.load_charge_batch_inputs(scope,payload);end $$;

create function public.save_charge_batch_v2(scope uuid,target uuid,expected_revision integer,request_key uuid,payload jsonb,note text) returns uuid language sql security invoker set search_path='' as $$select private.save_charge_batch(scope,target,expected_revision,request_key,payload,note)$$;
create or replace function public.save_charge_batch(scope uuid,target uuid,expected_revision integer,request_key uuid,payload jsonb,note text) returns uuid language plpgsql security invoker set search_path='' as $$
begin if payload->>'publication_model'='ordinary-coowner-v1' or exists(select 1 from public.charge_batches where id=target and scope_id=scope and publication_model='ordinary-coowner-v1') or exists(select 1 from public.charge_batches where id=nullif(payload->>'replaces_batch_id','')::uuid and scope_id=scope and publication_model='ordinary-coowner-v1') then raise exception 'charge_versioned_client_required' using errcode='23514';end if;return private.save_charge_batch(scope,target,expected_revision,request_key,payload,note);end $$;

create function public.review_charge_batch_v2(scope uuid,target uuid,expected_revision integer,request_key uuid,acknowledged_parties jsonb,note text) returns uuid language sql security invoker set search_path='' as $$select private.review_charge_batch(scope,target,expected_revision,request_key,acknowledged_parties,note)$$;
create or replace function public.review_charge_batch(scope uuid,target uuid,expected_revision integer,request_key uuid,acknowledged_parties jsonb,note text) returns uuid language plpgsql security invoker set search_path='' as $$
begin if false or exists(select 1 from public.charge_batches where id=target and scope_id=scope and publication_model='ordinary-coowner-v1') then raise exception 'charge_versioned_client_required' using errcode='23514';end if;return private.review_charge_batch(scope,target,expected_revision,request_key,acknowledged_parties,note);end $$;

create function public.publish_charge_batch_v2(scope uuid,target uuid,expected_revision integer,request_key uuid,note text) returns uuid language sql security invoker set search_path='' as $$select private.publish_charge_batch(scope,target,expected_revision,request_key,note)$$;
create or replace function public.publish_charge_batch(scope uuid,target uuid,expected_revision integer,request_key uuid,note text) returns uuid language plpgsql security invoker set search_path='' as $$
begin if false or exists(select 1 from public.charge_batches where id=target and scope_id=scope and publication_model='ordinary-coowner-v1') then raise exception 'charge_versioned_client_required' using errcode='23514';end if;return private.publish_charge_batch(scope,target,expected_revision,request_key,note);end $$;

create function public.charge_batch_feed_v2() returns jsonb language sql security invoker set search_path='' as $$select private.charge_batch_feed()$$;

create or replace function public.charge_batch_feed() returns jsonb language sql security invoker set search_path='' as $$
 with data as(select private.charge_batch_feed() x),a as(select x,coalesce((select jsonb_agg(b) from jsonb_array_elements(x->'batches') b where b->>'publication_model'='sole-owner-v1'),'[]') batches from data),
 c as(select x,batches,coalesce((select jsonb_agg(c) from jsonb_array_elements(x->'charges') c where exists(select 1 from jsonb_array_elements(batches) b where b->>'id'=c->>'batch_id')),'[]') charges from a)
 select x||jsonb_build_object('batches',batches,'charges',charges,
 'parties',coalesce((select jsonb_agg(p) from jsonb_array_elements(x->'parties') p where exists(select 1 from jsonb_array_elements(charges) c where c->>'id'=p->>'charge_id')),'[]'),
 'history',coalesce((select jsonb_agg(h) from jsonb_array_elements(x->'history') h where exists(select 1 from jsonb_array_elements(batches) b where b->>'id'=h->>'target_id')),'[]')) from c
$$;
revoke all on function public.load_charge_batch_inputs_v2(uuid,jsonb),public.save_charge_batch_v2(uuid,uuid,integer,uuid,jsonb,text),
 public.review_charge_batch_v2(uuid,uuid,integer,uuid,jsonb,text),public.publish_charge_batch_v2(uuid,uuid,integer,uuid,text),public.charge_batch_feed_v2() from public,anon,authenticated;
grant execute on function public.load_charge_batch_inputs_v2(uuid,jsonb),public.save_charge_batch_v2(uuid,uuid,integer,uuid,jsonb,text),
 public.review_charge_batch_v2(uuid,uuid,integer,uuid,jsonb,text),public.publish_charge_batch_v2(uuid,uuid,integer,uuid,text),public.charge_batch_feed_v2() to authenticated;

-- Keep the legacy one-party A invariant in addition to N-party B uniqueness.
create function private.guard_charge_party_insert() returns trigger language plpgsql set search_path='' as $$
declare model text;
begin
 select b.publication_model into model from public.charges c join public.charge_batches b on b.id=c.batch_id where c.id=new.charge_id;
 if model='sole-owner-v1' and exists(select 1 from public.obligation_parties where charge_id=new.charge_id) then raise exception 'charge_A_one_party_required' using errcode='23514';end if;
 return new;
end $$;
revoke all on function private.guard_charge_party_insert() from public,anon,authenticated;
create trigger charge_party_insert before insert on public.obligation_parties for each row execute function private.guard_charge_party_insert();
-- Existing authenticated RPC grants are unchanged by CREATE OR REPLACE; internal helpers remain closed.
