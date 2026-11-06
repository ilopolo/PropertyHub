-- DB-26: manual report + exactly one full posting. Not a bank confirmation or balance.
-- Existing receipts remain unposted legacy history; no backfill or opening balances.
create table public.money_movements(
 id uuid primary key default gen_random_uuid(),scope_id uuid not null references public.management_units,
 payment_id uuid not null unique references public.payments,
 cash_account_id uuid not null references public.cash_accounts,account_revision integer not null,
 account_snapshot jsonb not null,currency text not null check(currency='EUR'),
 policy text not null check(policy='manual-payment-movement-v1'),source_key text not null unique,
 kind text not null check(kind in('payment_receipt','payment_reversal')),
 direction text not null check(direction in('in','out')),amount numeric(18,2) not null check(amount>0),
 movement_date date not null,payment_method text not null check(payment_method in('cash','bank_transfer')),
 source_origin text not null check(source_origin='manual_report_v1'),
 replaces_payment_id uuid references public.payments,
 reversal_of_id uuid unique references public.money_movements,reversal_of_key text references public.money_movements(source_key),
 recorded_by uuid not null references public.profiles,recorded_at timestamptz not null default clock_timestamp(),reason text not null,
 foreign key(cash_account_id,account_revision) references public.cash_account_versions(account_id,revision),
 check(source_key='payment:'||payment_id::text),
 check((kind='payment_receipt' and direction='in' and reversal_of_id is null and reversal_of_key is null)
    or(kind='payment_reversal' and direction='out' and reversal_of_id is not null and reversal_of_key is not null and replaces_payment_id is null))
);
create index money_movements_scope_idx on public.money_movements(scope_id,recorded_at,id);
create table private.inbound_payment_operations(actor_id uuid not null references public.profiles,request_key uuid not null,input jsonb not null,result_id uuid not null references public.payments,primary key(actor_id,request_key));
alter table private.inbound_payment_operations enable row level security;
revoke all on private.inbound_payment_operations from public,anon,authenticated;

create function private.guard_money_movement() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.payments;a public.cash_accounts;o public.money_movements;snapshot jsonb;
begin
 if not private.has_scope_permission(new.scope_id,'record_payments') or new.recorded_by is distinct from private.actor() then raise exception 'payment_record_forbidden' using errcode='42501';end if;
 select * into p from public.payments where id=new.payment_id and scope_id=new.scope_id;
 select * into a from public.cash_accounts where id=new.cash_account_id and scope_id=new.scope_id;
 select v.snapshot into snapshot from public.cash_account_versions v where account_id=new.cash_account_id and revision=new.account_revision and scope_id=new.scope_id;
 if p.id is null or a.id is null or snapshot is null or snapshot<>new.account_snapshot or a.currency<>'EUR'
   or p.recorded_by<>new.recorded_by or p.method<>new.payment_method or p.origin<>new.source_origin
   or new.payment_method<>(case a.account_type when 'cash' then 'cash' else 'bank_transfer' end)
   or new.amount<>abs(p.amount) or length(btrim(new.reason)) not between 1 and 1000
 then raise exception 'payment_movement_source_mismatch' using errcode='23514';end if;
 if new.kind='payment_receipt' then
  if p.kind<>'receipt' or new.movement_date<>p.payment_date or new.replaces_payment_id is distinct from p.replaces_id
   or a.archived_at is not null or a.revision<>new.account_revision then raise exception 'payment_account_changed' using errcode='PT409';end if;
 else
  if not private.has_scope_permission(new.scope_id,'correct_finance') then raise exception 'payment_correction_forbidden' using errcode='42501';end if;
  select * into o from public.money_movements where id=new.reversal_of_id and scope_id=new.scope_id;
  if o.id is null or o.kind<>'payment_receipt' or p.kind<>'reversal' or p.reversal_of_id<>o.payment_id
   or (new.cash_account_id,new.account_revision,new.account_snapshot,new.amount,new.reversal_of_key)
     is distinct from(o.cash_account_id,o.account_revision,o.account_snapshot,o.amount,o.source_key)
   or new.movement_date<o.movement_date then raise exception 'payment_compensation_mismatch' using errcode='23514';end if;
 end if;
 if new.movement_date>(clock_timestamp() at time zone 'Europe/Sofia')::date then raise exception 'payment_movement_date_invalid' using errcode='23514';end if;
 return new;
end$$;
create trigger money_movement_guard before insert on public.money_movements for each row execute function private.guard_money_movement();
create trigger money_movement_immutable before update or delete on public.money_movements for each row execute function private.immutable_manual_payment();
create function private.require_payment_movement() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.money_movements where payment_id=new.id) then raise exception 'payment_atomic_posting_required' using errcode='23514';end if;
 return null;
end$$;
create constraint trigger payment_requires_movement after insert on public.payments deferrable initially deferred for each row execute function private.require_payment_movement();

-- Keep the proven allocation/reversal bookkeeping as an internal implementation only.
alter function private.manual_payment_operation(uuid,text,uuid,integer,uuid,jsonb,text) rename to manual_payment_operation_before_inbound;
-- The retained body qualifies one argument with its original function name.
-- Rebind that qualifier in this NEW migration; never edit the prior SQL file.
do $$declare definition text;begin
 definition:=pg_get_functiondef('private.manual_payment_operation_before_inbound(uuid,text,uuid,integer,uuid,jsonb,text)'::regprocedure);
 if strpos(definition,'manual_payment_operation.request_key')=0 then raise exception 'payment_legacy_body_dependency_changed';end if;
 execute replace(definition,'manual_payment_operation.request_key','manual_payment_operation_before_inbound.request_key');
end$$;
revoke all on function private.manual_payment_operation_before_inbound(uuid,text,uuid,integer,uuid,jsonb,text) from public,anon,authenticated;
create function private.manual_payment_operation(scope uuid,action text,target uuid,expected_revision integer,request_key uuid,payload jsonb,note text) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not private.has_scope_permission(scope,'record_payments') then raise exception 'payment_record_forbidden' using errcode='42501';end if;
 if action in('reverse','replace') and not private.has_scope_permission(scope,'correct_finance') then raise exception 'payment_correction_forbidden' using errcode='42501';end if;
 if action is distinct from 'allocate' then raise exception 'payment_explicit_account_and_compensation_api_required' using errcode='23514';end if;
 return private.manual_payment_operation_before_inbound(scope,action,target,expected_revision,request_key,payload,note);
end$$;

create function private.inbound_payment_operation(scope uuid,action text,target uuid,expected_revision integer,request_key uuid,payload jsonb,note text,account_id uuid,account_revision integer,compensation_date date,account_change_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare input jsonb;receipt private.inbound_payment_operations;p public.payments;o public.money_movements;
 a public.cash_accounts;snapshot jsonb;result uuid;reversed public.payments;fresh public.payments;
begin
 if not private.has_scope_permission(scope,'record_payments') then raise exception 'payment_record_forbidden' using errcode='42501';end if;
 if action is null or action not in('record','reverse','replace') or request_key is null or note is null or length(btrim(note)) not between 1 and 1000 then raise exception 'payment_request_required' using errcode='23514';end if;
 if action in('reverse','replace') and not private.has_scope_permission(scope,'correct_finance') then raise exception 'payment_correction_forbidden' using errcode='42501';end if;
 input:=jsonb_build_object('scope',scope,'action',action,'target',target,'revision',expected_revision,'payload',payload,'note',btrim(note),'account_id',account_id,'account_revision',account_revision,'compensation_date',compensation_date,'account_change_reason',account_change_reason);
 perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||':payment:'||request_key::text,0));
 perform pg_advisory_xact_lock(hashtextextended(scope::text||':charge-publication',0));
 perform pg_advisory_xact_lock(hashtextextended(scope::text||':cash-account-configuration',0));
 if not private.has_scope_permission(scope,'record_payments') or(action in('reverse','replace') and not private.has_scope_permission(scope,'correct_finance')) then raise exception 'payment_operation_forbidden' using errcode='42501';end if;
 select * into receipt from private.inbound_payment_operations where actor_id=private.actor() and inbound_payment_operations.request_key=inbound_payment_operation.request_key;
 if found then if receipt.input<>input then raise exception 'payment_request_changed' using errcode='PT409';end if;return receipt.result_id;end if;
 if exists(select 1 from private.payment_operations where actor_id=private.actor() and payment_operations.request_key=inbound_payment_operation.request_key) then raise exception 'payment_request_changed' using errcode='PT409';end if;
 if account_change_reason is not null and length(btrim(account_change_reason)) not between 1 and 1000 then raise exception 'payment_account_correction_reason_required' using errcode='23514';end if;
 if action='record' and(compensation_date is not null or account_change_reason is not null) then raise exception 'payment_unexpected_correction_fields' using errcode='23514';end if;
 if action='reverse' and(account_id is not null or account_revision is not null or account_change_reason is not null or payload is distinct from '{}'::jsonb) then raise exception 'payment_compensation_source_is_server_derived' using errcode='23514';end if;
 if action in('reverse','replace') then
  select * into p from public.payments where id=target and scope_id=scope for update;
  if p.id is null or p.kind<>'receipt' then raise exception 'payment_unavailable' using errcode='42501';end if;
  select * into o from public.money_movements where payment_id=p.id and kind='payment_receipt' for update;
  if o.id is null then raise exception 'payment_legacy_transition_required' using errcode='23514';end if;
  if compensation_date is null or compensation_date<o.movement_date or compensation_date>(clock_timestamp() at time zone 'Europe/Sofia')::date then raise exception 'payment_compensation_date_invalid' using errcode='23514';end if;
 end if;
 if action in('record','replace') then
  if account_id is null or account_revision is null then raise exception 'payment_explicit_active_account_required' using errcode='23514';end if;
  select * into a from public.cash_accounts where id=account_id and scope_id=scope for share;
  if a.id is null then raise exception 'payment_account_unavailable' using errcode='42501';end if;
  if a.archived_at is not null or a.revision<>account_revision then raise exception 'payment_account_changed' using errcode='PT409';end if;
  if a.currency<>'EUR' or a.account_type is distinct from (case payload->>'method' when 'cash' then 'cash' when 'bank_transfer' then 'bank' end) then raise exception 'payment_account_method_currency_mismatch' using errcode='23514';end if;
  select v.snapshot into snapshot from public.cash_account_versions v where v.account_id=a.id and v.revision=a.revision;
  if action='replace' and a.id<>o.cash_account_id and account_change_reason is null then raise exception 'payment_account_correction_reason_required' using errcode='23514';end if;
 end if;
 result:=private.manual_payment_operation_before_inbound(scope,action,target,expected_revision,request_key,payload,note);
 if action in('reverse','replace') then
  select * into reversed from public.payments where reversal_of_id=target;
  insert into public.money_movements(scope_id,payment_id,cash_account_id,account_revision,account_snapshot,currency,policy,source_key,kind,direction,amount,movement_date,payment_method,source_origin,reversal_of_id,reversal_of_key,recorded_by,reason)
  values(scope,reversed.id,o.cash_account_id,o.account_revision,o.account_snapshot,'EUR','manual-payment-movement-v1','payment:'||reversed.id::text,'payment_reversal','out',o.amount,compensation_date,o.payment_method,o.source_origin,o.id,o.source_key,private.actor(),btrim(note));
 end if;
 if action in('record','replace') then
  select * into fresh from public.payments where id=result;
  insert into public.money_movements(scope_id,payment_id,cash_account_id,account_revision,account_snapshot,currency,policy,source_key,kind,direction,amount,movement_date,payment_method,source_origin,replaces_payment_id,recorded_by,reason)
  values(scope,fresh.id,a.id,a.revision,snapshot,'EUR','manual-payment-movement-v1','payment:'||fresh.id::text,'payment_receipt','in',fresh.amount,fresh.payment_date,fresh.method,fresh.origin,fresh.replaces_id,private.actor(),btrim(note));
 end if;
 if not private.has_scope_permission(scope,'record_payments') or(action in('reverse','replace') and not private.has_scope_permission(scope,'correct_finance')) then raise exception 'payment_operation_forbidden' using errcode='42501';end if;
 insert into private.inbound_payment_operations values(private.actor(),request_key,input,result);
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta)
 values(scope,private.actor(),'manual_payment_posting','payment',result,btrim(note),jsonb_build_object('result_id',result,'original_payment_id',target,'reversal_payment_id',reversed.id,'account_change_reason',account_change_reason,'input',input));
 return result;
end$$;

create function public.record_manual_payment_inbound(scope uuid,account_id uuid,account_revision integer,payload jsonb,request_key uuid,note text) returns uuid language sql security invoker set search_path='' as $$select private.inbound_payment_operation(scope,'record',null,null,request_key,payload,note,account_id,account_revision,null,null)$$;
create function public.reverse_manual_payment_inbound(scope uuid,target uuid,expected_revision integer,compensation_date date,request_key uuid,note text) returns uuid language sql security invoker set search_path='' as $$select private.inbound_payment_operation(scope,'reverse',target,expected_revision,request_key,'{}',note,null,null,compensation_date,null)$$;
create function public.replace_manual_payment_inbound(scope uuid,target uuid,expected_revision integer,account_id uuid,account_revision integer,compensation_date date,account_change_reason text,payload jsonb,request_key uuid,note text) returns uuid language sql security invoker set search_path='' as $$select private.inbound_payment_operation(scope,'replace',target,expected_revision,request_key,payload,note,account_id,account_revision,compensation_date,account_change_reason)$$;

alter function private.manual_payment_feed() rename to manual_payment_feed_before_inbound;
revoke all on function private.manual_payment_feed_before_inbound() from public,anon,authenticated;
create function private.manual_payment_feed() returns jsonb language sql stable security definer set search_path='' as $$
 select private.manual_payment_feed_before_inbound()||jsonb_build_object('inbound_required',true,
 'cash_accounts',(select coalesce(jsonb_agg(to_jsonb(a) order by a.label,a.id),'[]') from public.cash_accounts a where private.can_read_payments(a.scope_id)),
 'movements',(select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('amount',m.amount::text,'amount_cents',(m.amount*100)::bigint::text) order by m.recorded_at,m.id),'[]') from public.money_movements m where private.can_read_payments(m.scope_id)))$$;
alter table public.money_movements enable row level security;
revoke all on public.money_movements from public,anon,authenticated;
grant select on public.money_movements to authenticated;
create policy money_movement_read on public.money_movements for select to authenticated using(private.can_read_payments(scope_id));
revoke all on function private.guard_money_movement(),private.require_payment_movement(),private.manual_payment_operation(uuid,text,uuid,integer,uuid,jsonb,text),private.inbound_payment_operation(uuid,text,uuid,integer,uuid,jsonb,text,uuid,integer,date,text),private.manual_payment_feed(),public.record_manual_payment_inbound(uuid,uuid,integer,jsonb,uuid,text),public.reverse_manual_payment_inbound(uuid,uuid,integer,date,uuid,text),public.replace_manual_payment_inbound(uuid,uuid,integer,uuid,integer,date,text,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function private.manual_payment_operation(uuid,text,uuid,integer,uuid,jsonb,text),private.inbound_payment_operation(uuid,text,uuid,integer,uuid,jsonb,text,uuid,integer,date,text),private.manual_payment_feed(),public.record_manual_payment_inbound(uuid,uuid,integer,jsonb,uuid,text),public.reverse_manual_payment_inbound(uuid,uuid,integer,date,uuid,text),public.replace_manual_payment_inbound(uuid,uuid,integer,uuid,integer,date,text,jsonb,uuid,text) to authenticated;
