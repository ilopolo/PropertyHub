-- Manual reports only. No bank confirmation, cash balance, ledger or fund movement.
-- payments.id is the stable future money_movements.payment_id source (one posting per receipt).
insert into public.role_permissions values
 ('manager','read_payments'),('cashier','read_payments'),('controller','read_payments'),
 ('manager','record_payments'),('cashier','record_payments') on conflict do nothing;

create table public.payments(
 id uuid primary key default gen_random_uuid(),scope_id uuid not null references public.management_units,
 payer_person_id uuid references public.persons,payer_label text not null,
 amount numeric(18,2) not null,payment_date date not null,method text not null check(method in('cash','bank_transfer')),
 document_reference text not null,purpose text not null,origin text not null default 'manual_report_v1' check(origin='manual_report_v1'),
 kind text not null check(kind in('receipt','reversal')),reversal_of_id uuid unique references public.payments,
 replaces_id uuid unique references public.payments,recorded_by uuid not null references public.profiles,
 recorded_at timestamptz not null default clock_timestamp(),note text not null,
 check((kind='receipt' and amount>0 and reversal_of_id is null) or(kind='reversal' and amount<0 and reversal_of_id is not null and replaces_id is null))
);
create index payments_scope_idx on public.payments(scope_id,recorded_at,id);
create table public.payment_allocations(
 id uuid primary key default gen_random_uuid(),scope_id uuid not null references public.management_units,
 payment_id uuid not null references public.payments,charge_id uuid not null references public.charges,
 obligation_party_id uuid not null references public.obligation_parties,amount numeric(18,2) not null,
 reversal_of_id uuid unique references public.payment_allocations,reversal_payment_id uuid references public.payments,
 recorded_by uuid not null references public.profiles,recorded_at timestamptz not null default clock_timestamp(),note text not null,
 check((amount>0 and reversal_of_id is null and reversal_payment_id is null) or(amount<0 and reversal_of_id is not null and reversal_payment_id is not null))
);
create index payment_allocations_payment_idx on public.payment_allocations(payment_id,id);
create index payment_allocations_party_idx on public.payment_allocations(obligation_party_id,id);
create index payment_allocations_charge_idx on public.payment_allocations(charge_id);
create table private.payment_operations(actor_id uuid not null references public.profiles,request_key uuid not null,input jsonb not null,result_id uuid not null,primary key(actor_id,request_key));
alter table private.payment_operations enable row level security;
revoke all on private.payment_operations from public,anon,authenticated;

create function private.immutable_manual_payment() returns trigger language plpgsql set search_path='' as $$begin raise exception 'payment_history_immutable' using errcode='23514';end$$;
create trigger payment_immutable before update or delete on public.payments for each row execute function private.immutable_manual_payment();
create trigger allocation_immutable before update or delete on public.payment_allocations for each row execute function private.immutable_manual_payment();
create function private.can_read_payments(scope uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_scope_permission(scope,'read_payments') or private.has_scope_permission(scope,'record_payments')$$;
alter table public.payments enable row level security;alter table public.payment_allocations enable row level security;
revoke all on public.payments,public.payment_allocations from public,anon,authenticated;
grant select on public.payments,public.payment_allocations to authenticated;
create policy payment_read on public.payments for select to authenticated using(private.can_read_payments(scope_id));
create policy payment_allocation_read on public.payment_allocations for select to authenticated using(private.can_read_payments(scope_id));

create function private.manual_payment_payload(p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare k text;d date;begin
 if p is null or jsonb_typeof(p)<>'object' or p-array['payer_person_id','payer_label','amount','payment_date','method','document_reference','purpose']<>'{}' then raise exception 'payment_fields_invalid' using errcode='23514';end if;
 foreach k in array array['payer_label','amount','payment_date','method','document_reference','purpose'] loop
  if jsonb_typeof(p->k) is distinct from 'string' or length(btrim(p->>k)) not between 1 and 500 then raise exception 'payment_value_required' using errcode='23514';end if;
 end loop;
 if p->>'amount' !~ '^(0|[1-9][0-9]{0,11})\.[0-9]{2}$' or (p->>'amount')::numeric<=0 then raise exception 'payment_exact_positive_amount' using errcode='23514';end if;
 if p->>'method' not in('cash','bank_transfer') then raise exception 'payment_method_invalid' using errcode='23514';end if;
 if p->>'payment_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'payment_date_invalid' using errcode='23514';end if;
 begin d:=(p->>'payment_date')::date;exception when others then raise exception 'payment_date_invalid' using errcode='23514';end;
 if d>(clock_timestamp() at time zone 'Europe/Sofia')::date or d<date '0001-01-01' then raise exception 'payment_date_invalid' using errcode='23514';end if;
 if p->>'payer_person_id' is not null and (jsonb_typeof(p->'payer_person_id')<>'string' or p->>'payer_person_id' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') then raise exception 'payment_payer_invalid' using errcode='23514';end if;
 return jsonb_build_object('payer_person_id',p->>'payer_person_id','payer_label',btrim(p->>'payer_label'),'amount',p->>'amount','payment_date',d,'method',p->>'method','document_reference',btrim(p->>'document_reference'),'purpose',btrim(p->>'purpose'));
end$$;
create function private.manual_payment_state(target uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('revision',1+(select count(*) from public.payment_allocations where payment_id=p.id)+(select count(*) from public.payments where reversal_of_id=p.id),
 'reversed',exists(select 1 from public.payments where reversal_of_id=p.id),
 'allocated',coalesce((select sum(amount) from public.payment_allocations where payment_id=p.id),0)::numeric(18,2)::text,
 'unallocated',(case when exists(select 1 from public.payments where reversal_of_id=p.id) then 0 else p.amount end-coalesce((select sum(amount) from public.payment_allocations where payment_id=p.id),0))::numeric(18,2)::text)
 from public.payments p where id=target$$;

create function private.manual_payment_operation(scope uuid,action text,target uuid,expected_revision integer,request_key uuid,payload jsonb,note text) returns uuid language plpgsql security definer set search_path='' as $$
declare input jsonb;receipt private.payment_operations;p public.payments;party public.obligation_parties;c public.charges;b public.charge_batches;
 state jsonb;data jsonb;result uuid;reverse_id uuid;row public.payment_allocations;value numeric;remaining numeric;
begin
 if not private.has_scope_permission(scope,'record_payments') then raise exception 'payment_record_forbidden' using errcode='42501';end if;
 if action is null or action not in('record','allocate','reverse','replace') or request_key is null or note is null or length(btrim(note)) not between 1 and 1000 then raise exception 'payment_request_required' using errcode='23514';end if;
 if(action='record' and(target is not null or expected_revision is not null)) or(action<>'record' and(target is null or expected_revision is null or expected_revision<1)) then raise exception 'payment_target_revision_required' using errcode='23514';end if;
 input:=jsonb_build_object('scope',scope,'action',action,'target',target,'revision',expected_revision,'payload',payload,'note',btrim(note));
 perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||':payment:'||request_key::text,0));
 -- Shared with publish/correction. All payment writers use the same lock order.
 perform pg_advisory_xact_lock(hashtextextended(scope::text||':charge-publication',0));
 if not private.has_scope_permission(scope,'record_payments') or(action in('reverse','replace') and not private.has_scope_permission(scope,'correct_finance')) then raise exception 'payment_operation_forbidden' using errcode='42501';end if;
 select * into receipt from private.payment_operations where actor_id=private.actor() and payment_operations.request_key=manual_payment_operation.request_key;
 if found then if receipt.input<>input then raise exception 'payment_request_changed' using errcode='PT409';end if;return receipt.result_id;end if;
 if action<>'record' then
  select * into p from public.payments where id=target and scope_id=scope for update;
  if p.id is null or p.kind<>'receipt' then raise exception 'payment_unavailable' using errcode='42501';end if;
  state:=private.manual_payment_state(p.id);
  if (state->>'revision')::integer is distinct from expected_revision or (state->>'reversed')::boolean then raise exception 'payment_revision_changed' using errcode='PT409';end if;
 end if;
 if action in('record','replace') then
  data:=private.manual_payment_payload(payload);
  if data->>'payer_person_id' is not null and not exists(select 1 from public.persons where id=(data->>'payer_person_id')::uuid and scope_id=scope) then raise exception 'payment_payer_unavailable' using errcode='42501';end if;
 end if;
 if action='allocate' then
  if payload is null or jsonb_typeof(payload)<>'object' or payload-array['obligation_party_id','amount']<>'{}' or jsonb_typeof(payload->'amount') is distinct from 'string' or payload->>'amount' !~ '^(0|[1-9][0-9]{0,11})\.[0-9]{2}$' then raise exception 'payment_allocation_fields_invalid' using errcode='23514';end if;
  value:=(payload->>'amount')::numeric;if value<=0 then raise exception 'payment_exact_positive_amount' using errcode='23514';end if;
  select * into party from public.obligation_parties where id=(payload->>'obligation_party_id')::uuid and scope_id=scope;
  if party.id is null then raise exception 'payment_party_unavailable' using errcode='42501';end if;
  select * into c from public.charges where id=party.charge_id and scope_id=scope;
  select * into b from public.charge_batches where id=c.batch_id and scope_id=scope;
  if b.id is null or b.status<>'published' or b.kind='reversal' or c.amount<=0 or party.assessed_amount<=0 or exists(select 1 from public.charge_batches where reverses_id=b.id) then raise exception 'payment_obligation_not_current' using errcode='PT409';end if;
  remaining:=party.assessed_amount-coalesce((select sum(amount) from public.payment_allocations where obligation_party_id=party.id),0);
  if value>remaining or value>(state->>'unallocated')::numeric then raise exception 'payment_remaining_exceeded' using errcode='PT409';end if;
  insert into public.payment_allocations(scope_id,payment_id,charge_id,obligation_party_id,amount,recorded_by,note) values(scope,p.id,c.id,party.id,value,private.actor(),btrim(note)) returning id into result;
 end if;
 if action in('reverse','replace') then
  insert into public.payments(scope_id,payer_person_id,payer_label,amount,payment_date,method,document_reference,purpose,kind,reversal_of_id,recorded_by,note)
  values(scope,p.payer_person_id,p.payer_label,-p.amount,p.payment_date,p.method,p.document_reference,p.purpose,'reversal',p.id,private.actor(),btrim(note)) returning id into reverse_id;
  for row in select * from public.payment_allocations where payment_id=p.id and amount>0 loop
   insert into public.payment_allocations(scope_id,payment_id,charge_id,obligation_party_id,amount,reversal_of_id,reversal_payment_id,recorded_by,note)
   values(scope,p.id,row.charge_id,row.obligation_party_id,-row.amount,row.id,reverse_id,private.actor(),btrim(note));
  end loop;result:=reverse_id;
 end if;
 if action in('record','replace') then
  insert into public.payments(scope_id,payer_person_id,payer_label,amount,payment_date,method,document_reference,purpose,kind,replaces_id,recorded_by,note)
  values(scope,(data->>'payer_person_id')::uuid,data->>'payer_label',(data->>'amount')::numeric,(data->>'payment_date')::date,data->>'method',data->>'document_reference',data->>'purpose','receipt',case when action='replace' then p.id end,private.actor(),btrim(note)) returning id into result;
 end if;
 insert into private.payment_operations values(private.actor(),request_key,input,result);
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta)
 values(scope,private.actor(),'manual_payment_'||action,'payment',coalesce(target,result),btrim(note),jsonb_build_object('result_id',result,'reversal_id',reverse_id,'request_key',request_key,'input',input,'previous_state',state));
 return result;
end$$;

create function private.manual_payment_feed() returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object(
 'scopes',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'can_record',private.has_scope_permission(id,'record_payments'),'can_correct',private.has_scope_permission(id,'record_payments') and private.has_scope_permission(id,'correct_finance')) order by label),'[]') from public.management_units where private.can_read_payments(id)),
 'payments',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('amount',p.amount::text,'state',private.manual_payment_state(p.id)) order by recorded_at,id),'[]') from public.payments p where private.can_read_payments(scope_id)),
 'allocations',(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('amount',a.amount::text) order by recorded_at,id),'[]') from public.payment_allocations a where private.can_read_payments(scope_id)),
 'obligations',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'scope_id',p.scope_id,'charge_id',c.id,'unit_id',c.unit_id,'unit_label',c.unit_snapshot->>'unit_number','person_id',p.person_id,'debtor_label',p.person_snapshot->>'label','amount',p.assessed_amount::text,'due_date',c.due_date,'remaining',(p.assessed_amount-coalesce((select sum(a.amount) from public.payment_allocations a where a.obligation_party_id=p.id),0))::numeric(18,2)::text) order by p.id),'[]') from public.obligation_parties p join public.charges c on c.id=p.charge_id join public.charge_batches b on b.id=c.batch_id where private.can_read_payments(p.scope_id) and b.status='published' and b.kind<>'reversal' and p.assessed_amount>=0 and not exists(select 1 from public.charge_batches where reverses_id=b.id)),
 'history',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'scope_id',scope_id,'target_id',target_id,'action',action,'at',happened_at,'actor',actor_profile_id,'reason',reason,'change',safe_delta) order by happened_at,id),'[]') from public.audit_events where action like 'manual_payment_%' and private.can_read_payments(scope_id)))$$;

create function public.manual_payment_feed() returns jsonb language sql security invoker set search_path='' as $$select private.manual_payment_feed()$$;
create function public.record_manual_payment(scope uuid,payload jsonb,request_key uuid,note text) returns uuid language sql security invoker set search_path='' as $$select private.manual_payment_operation(scope,'record',null,null,request_key,payload,note)$$;
create function public.allocate_manual_payment(scope uuid,payment_id uuid,expected_revision integer,obligation_party_id uuid,amount text,request_key uuid,note text) returns uuid language sql security invoker set search_path='' as $$select private.manual_payment_operation(scope,'allocate',payment_id,expected_revision,request_key,jsonb_build_object('obligation_party_id',obligation_party_id,'amount',amount),note)$$;
create function public.reverse_manual_payment(scope uuid,target uuid,expected_revision integer,request_key uuid,note text) returns uuid language sql security invoker set search_path='' as $$select private.manual_payment_operation(scope,'reverse',target,expected_revision,request_key,'{}',note)$$;
create function public.replace_manual_payment(scope uuid,target uuid,expected_revision integer,payload jsonb,request_key uuid,note text) returns uuid language sql security invoker set search_path='' as $$select private.manual_payment_operation(scope,'replace',target,expected_revision,request_key,payload,note)$$;
revoke all on function private.immutable_manual_payment(),private.manual_payment_state(uuid),private.manual_payment_payload(jsonb),private.can_read_payments(uuid),private.manual_payment_operation(uuid,text,uuid,integer,uuid,jsonb,text),private.manual_payment_feed(),public.manual_payment_feed(),public.record_manual_payment(uuid,jsonb,uuid,text),public.allocate_manual_payment(uuid,uuid,integer,uuid,text,uuid,text),public.reverse_manual_payment(uuid,uuid,integer,uuid,text),public.replace_manual_payment(uuid,uuid,integer,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function private.can_read_payments(uuid),private.manual_payment_operation(uuid,text,uuid,integer,uuid,jsonb,text),private.manual_payment_feed(),public.manual_payment_feed(),public.record_manual_payment(uuid,jsonb,uuid,text),public.allocate_manual_payment(uuid,uuid,integer,uuid,text,uuid,text),public.reverse_manual_payment(uuid,uuid,integer,uuid,text),public.replace_manual_payment(uuid,uuid,integer,jsonb,uuid,text) to authenticated;

-- Payment-aware replacement of the previous fail-closed blanket guard.
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
  -- Share the scope publication lock with payment allocations. Even reversed payment
  -- history remains outside the unpaid correction template; never erase paid history.
  if exists(select 1 from public.payment_allocations a join public.charges c on c.id=a.charge_id where c.batch_id=b.replaces_id) then raise exception 'charge_allocated_correction_forbidden' using errcode='PT409';end if;
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
