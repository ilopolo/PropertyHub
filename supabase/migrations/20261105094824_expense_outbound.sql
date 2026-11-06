-- P4b: document -> explicit reported outgoing -> exactly one movement and whole fund set.
-- No bank operation, balance assertion, historical backfill or Storage authority.
insert into public.role_permissions values('manager','read_expenses'),('cashier','read_expenses'),('controller','read_expenses'),('manager','record_expenses'),('cashier','record_expenses') on conflict do nothing;
create table public.expenses(
 id uuid primary key default gen_random_uuid(),scope_id uuid not null references public.management_units,
 revision integer not null check(revision>0),settlement_revision integer not null default 0 check(settlement_revision>=0),
 data jsonb not null,amount numeric(18,2) not null check(amount>0),currency text not null check(currency='EUR'),
 created_by uuid not null references public.profiles,created_at timestamptz not null default clock_timestamp(),
 updated_by uuid not null references public.profiles,updated_at timestamptz not null default clock_timestamp(),last_reason text not null
);
create index expenses_scope_idx on public.expenses(scope_id,created_at,id);
create table public.expense_versions(
 expense_id uuid not null references public.expenses,revision integer not null,scope_id uuid not null references public.management_units,
 snapshot jsonb not null,recorded_by uuid not null references public.profiles,recorded_at timestamptz not null default clock_timestamp(),reason text not null,
 primary key(expense_id,revision)
);
create index expense_versions_scope_idx on public.expense_versions(scope_id,expense_id,revision);
create table public.expense_payments(
 id uuid primary key default gen_random_uuid(),scope_id uuid not null references public.management_units,
 expense_id uuid not null,expense_revision integer not null,expense_snapshot jsonb not null,
 kind text not null check(kind in('settlement','reversal')),amount numeric(18,2) not null check(amount<>0),currency text not null check(currency='EUR'),
 paid_on date not null,method text not null check(method in('cash','bank_transfer')),payment_reference text not null,
 reversal_of_id uuid unique references public.expense_payments,replaces_id uuid unique references public.expense_payments,
 operation_input jsonb not null,recorded_by uuid not null references public.profiles,recorded_at timestamptz not null default clock_timestamp(),reason text not null,
 foreign key(expense_id,expense_revision) references public.expense_versions,
 check((kind='settlement' and amount>0 and reversal_of_id is null) or(kind='reversal' and amount<0 and reversal_of_id is not null and replaces_id is null))
);
create index expense_payments_expense_idx on public.expense_payments(expense_id,recorded_at,id);
create index expense_payments_scope_idx on public.expense_payments(scope_id,id);
create unique index expense_payment_reference_idx on public.expense_payments(expense_id,payment_reference) where kind='settlement' and replaces_id is null;
create table private.expense_operations(actor_id uuid not null references public.profiles,request_key uuid not null,input jsonb not null,input_hash text not null,result_id uuid not null,primary key(actor_id,request_key));
create index expense_operation_business_idx on private.expense_operations(actor_id,input_hash);
alter table private.expense_operations enable row level security;revoke all on private.expense_operations from public,anon,authenticated;

-- Add a typed expense source, preserving every existing incoming row and API.
alter table public.money_movements alter column payment_id drop not null;
alter table public.money_movements add column expense_payment_id uuid unique references public.expense_payments;
do $$declare c record;n integer:=0;begin
 for c in select conname from pg_constraint where conrelid='public.money_movements'::regclass and contype='c' and
 (conname in('money_movements_policy_check','money_movements_kind_check','money_movements_source_origin_check') or
 (pg_get_constraintdef(oid) like '%source_key%' and pg_get_constraintdef(oid) like '%payment_id%') or
 (pg_get_constraintdef(oid) like '%payment_receipt%' and pg_get_constraintdef(oid) like '%direction%')) loop
 execute format('alter table public.money_movements drop constraint %I',c.conname);n:=n+1;end loop;
 if n<>5 then raise exception 'expense_movement_schema_dependency_changed';end if;
end$$;
alter table public.money_movements add constraint money_source_type check(
 (payment_id is not null and expense_payment_id is null and policy='manual-payment-movement-v1' and source_origin='manual_report_v1' and source_key='payment:'||payment_id::text and
 ((kind='payment_receipt' and direction='in' and reversal_of_id is null and reversal_of_key is null) or(kind='payment_reversal' and direction='out' and reversal_of_id is not null and reversal_of_key is not null and replaces_payment_id is null)))
 or(payment_id is null and expense_payment_id is not null and policy='manual-expense-movement-v1' and source_origin='manual_expense_v1' and source_key='expense-payment:'||expense_payment_id::text and replaces_payment_id is null and
 ((kind='expense_payment' and direction='out' and reversal_of_id is null and reversal_of_key is null) or(kind='expense_reversal' and direction='in' and reversal_of_id is not null and reversal_of_key is not null)))
);
drop trigger money_movement_guard on public.money_movements;
create trigger money_movement_guard before insert on public.money_movements for each row when(new.payment_id is not null) execute function private.guard_money_movement();
alter policy money_movement_read on public.money_movements using(payment_id is not null and private.can_read_payments(scope_id));
do $$declare d text;begin
 d:=pg_get_functiondef('private.manual_payment_feed()'::regprocedure);
 if strpos(d,'from public.money_movements m where private.can_read_payments(m.scope_id)')=0 then raise exception 'expense_inbound_feed_dependency_changed';end if;
 execute replace(d,'from public.money_movements m where private.can_read_payments(m.scope_id)','from public.money_movements m where m.payment_id is not null and private.can_read_payments(m.scope_id)');
end$$;

create function private.can_read_expenses(scope uuid) returns boolean language sql stable security definer set search_path='' as $$select private.has_scope_permission(scope,'read_expenses') or private.has_scope_permission(scope,'record_expenses')$$;
create function private.expense_text(p jsonb,k text,lim integer,optional boolean default false) returns text language plpgsql set search_path='' as $$declare v text;begin
 if optional and(p->>k is null or p->>k='') then return null;end if;v:=btrim(p->>k);
 if jsonb_typeof(p->k) is distinct from 'string' or length(v) not between 1 and lim or v~'[[:cntrl:]]' then raise exception 'expense_text_invalid' using errcode='23514';end if;return v;end$$;
create function private.expense_payload(p jsonb,settlement boolean) returns jsonb language plpgsql set search_path='' as $$
declare allowed text[];k text;r jsonb:='{}';d date;lim integer;begin
 allowed:=case when settlement then array['amount','paid_on','method','payment_reference'] else array['amount','currency','supplier_label','document_number','document_date','category_label','description','source_reference','basis_reference'] end;
 if p is null or jsonb_typeof(p)<>'object' or exists(select 1 from jsonb_object_keys(p) x where x<>all(allowed)) then raise exception 'expense_fields_invalid' using errcode='23514';end if;
 if jsonb_typeof(p->'amount') is distinct from 'string' or(p->>'amount')!~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$' or(p->>'amount')::numeric<=0 then raise exception 'expense_amount_invalid' using errcode='23514';end if;
 r:=jsonb_build_object('amount',((p->>'amount')::numeric(18,2))::text);k:=case when settlement then 'paid_on' else 'document_date' end;
 if(p->>k) is null or(p->>k)!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'expense_date_invalid' using errcode='23514';end if;
 begin d:=(p->>k)::date;exception when others then raise exception 'expense_date_invalid' using errcode='23514';end;
 if d<date '0001-01-01' or d>(clock_timestamp() at time zone 'Europe/Sofia')::date then raise exception 'expense_date_invalid' using errcode='23514';end if;r:=r||jsonb_build_object(k,d);
 if settlement then
  if p->>'method' is null or p->>'method' not in('cash','bank_transfer') then raise exception 'expense_method_invalid' using errcode='23514';end if;
  return r||jsonb_build_object('method',p->>'method','payment_reference',private.expense_text(p,'payment_reference',120));
 end if;
 if p->>'currency' is distinct from 'EUR' then raise exception 'expense_currency_invalid' using errcode='23514';end if;r:=r||jsonb_build_object('currency','EUR');
 foreach k in array array['supplier_label','document_number','category_label','description','source_reference','basis_reference'] loop
 lim:=case k when 'supplier_label' then 160 when 'category_label' then 160 when 'document_number' then 120 when 'source_reference' then 500 else 1000 end;
 r:=r||jsonb_build_object(k,private.expense_text(p,k,lim,k='document_number'));end loop;return r;
end$$;
create function private.expense_state(target uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('revision',e.revision,'settlement_revision',e.settlement_revision,'paid',x.paid::numeric(18,2)::text,'remaining',(e.amount-x.paid)::numeric(18,2)::text,'status',case when x.paid=0 then 'unpaid' when x.paid=e.amount then 'paid' else 'partial' end)
 from public.expenses e cross join lateral(select coalesce(sum(amount),0) paid from public.expense_payments where expense_id=e.id) x where e.id=target$$;
create function private.guard_expense() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='DELETE' then raise exception 'expense_history_immutable' using errcode='23514';end if;
 if not private.has_scope_permission(new.scope_id,'record_expenses') then raise exception 'expense_record_forbidden' using errcode='42501';end if;
 if tg_op='UPDATE' and(to_jsonb(new)-'settlement_revision')=(to_jsonb(old)-'settlement_revision') and new.settlement_revision=old.settlement_revision+1 then return new;end if;
 if new.updated_by is distinct from private.actor() or private.expense_payload(new.data,false)<>new.data or new.currency<>'EUR' or new.amount<>(new.data->>'amount')::numeric then raise exception 'expense_source_invalid' using errcode='23514';end if;
 if tg_op='INSERT' then if new.revision<>1 or new.settlement_revision<>0 or new.created_by<>private.actor() then raise exception 'expense_revision_invalid' using errcode='23514';end if;
 else
  if not private.has_scope_permission(new.scope_id,'correct_finance') then raise exception 'expense_correction_forbidden' using errcode='42501';end if;
  if(new.id,new.scope_id,new.created_by,new.created_at,new.settlement_revision) is distinct from(old.id,old.scope_id,old.created_by,old.created_at,old.settlement_revision) or new.revision<>old.revision+1 then raise exception 'expense_revision_changed' using errcode='PT409';end if;
  if(private.expense_state(old.id)->>'paid')::numeric<>0 then raise exception 'expense_has_effective_payments' using errcode='PT409';end if;
  if new.data=old.data then raise exception 'expense_no_changes' using errcode='23514';end if;
 end if;
 if length(btrim(new.last_reason)) not between 1 and 1000 then raise exception 'expense_reason_required' using errcode='23514';end if;return new;
end$$;
create trigger expense_guard before insert or update or delete on public.expenses for each row execute function private.guard_expense();
create function private.audit_expense() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='UPDATE' and new.revision=old.revision then return null;end if;
 insert into public.expense_versions values(new.id,new.revision,new.scope_id,(to_jsonb(new)-'settlement_revision')||jsonb_build_object('amount',new.amount::text),private.actor(),clock_timestamp(),new.last_reason);
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta) values(new.scope_id,private.actor(),'expense_document','expense',new.id,new.last_reason,jsonb_build_object('revision',new.revision,'data',new.data));return null;end$$;
create trigger expense_audit after insert or update on public.expenses for each row execute function private.audit_expense();
create trigger expense_versions_immutable before update or delete on public.expense_versions for each row execute function private.immutable_manual_payment();
create trigger expense_payments_immutable before update or delete on public.expense_payments for each row execute function private.immutable_manual_payment();

create function private.guard_expense_payment() returns trigger language plpgsql security definer set search_path='' as $$
declare e public.expenses;o public.expense_payments;snapshot jsonb;begin
 if not private.has_scope_permission(new.scope_id,'record_expenses') or new.recorded_by is distinct from private.actor() then raise exception 'expense_record_forbidden' using errcode='42501';end if;
 select * into e from public.expenses where id=new.expense_id and scope_id=new.scope_id for update;
 select v.snapshot into snapshot from public.expense_versions v where v.expense_id=new.expense_id and v.revision=new.expense_revision and v.scope_id=new.scope_id;
 if e.id is null or snapshot is null or snapshot<>new.expense_snapshot or new.currency<>'EUR' or length(btrim(new.reason)) not between 1 and 1000 or new.paid_on>(clock_timestamp() at time zone 'Europe/Sofia')::date then raise exception 'expense_payment_source_invalid' using errcode='23514';end if;
 if new.kind='settlement' then
  if new.operation_input->>'action' not in('pay','replace') or(new.amount,new.paid_on,new.method,new.payment_reference) is distinct from((new.operation_input->'payload'->>'amount')::numeric,(new.operation_input->'payload'->>'paid_on')::date,new.operation_input->'payload'->>'method',new.operation_input->'payload'->>'payment_reference') then raise exception 'expense_payment_source_invalid' using errcode='23514';end if;
  if new.expense_revision<>e.revision then raise exception 'expense_revision_changed' using errcode='PT409';end if;
  if new.amount>(private.expense_state(e.id)->>'remaining')::numeric then raise exception 'expense_overpayment' using errcode='PT409';end if;
 else
  if not private.has_scope_permission(new.scope_id,'correct_finance') then raise exception 'expense_correction_forbidden' using errcode='42501';end if;
  select * into o from public.expense_payments where id=new.reversal_of_id and scope_id=new.scope_id;
  if o.id is null or o.kind<>'settlement' or(new.expense_id,new.expense_revision,new.expense_snapshot,new.amount,new.method,new.payment_reference) is distinct from(o.expense_id,o.expense_revision,o.expense_snapshot,-o.amount,o.method,o.payment_reference) or new.paid_on<o.paid_on then raise exception 'expense_compensation_mismatch' using errcode='23514';end if;
 end if;return new;
end$$;
create trigger expense_payment_guard before insert on public.expense_payments for each row execute function private.guard_expense_payment();
create function private.guard_expense_movement() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.expense_payments;a public.cash_accounts;o public.money_movements;snapshot jsonb;begin
 if not private.has_scope_permission(new.scope_id,'record_expenses') or new.recorded_by is distinct from private.actor() then raise exception 'expense_record_forbidden' using errcode='42501';end if;
 select * into p from public.expense_payments where id=new.expense_payment_id and scope_id=new.scope_id;
 select * into a from public.cash_accounts where id=new.cash_account_id and scope_id=new.scope_id;
 select v.snapshot into snapshot from public.cash_account_versions v where v.account_id=a.id and v.revision=new.account_revision and v.scope_id=new.scope_id;
 if p.id is null or snapshot is null or snapshot<>new.account_snapshot or p.recorded_by<>new.recorded_by or new.amount<>abs(p.amount) or new.payment_method<>p.method or new.movement_date<>p.paid_on or new.payment_method<>(case a.account_type when 'cash' then 'cash' else 'bank_transfer' end) then raise exception 'expense_movement_source_invalid' using errcode='23514';end if;
 if p.kind='settlement' then
  if new.kind<>'expense_payment' or a.archived_at is not null or a.revision<>new.account_revision or(new.cash_account_id,new.account_revision) is distinct from((p.operation_input->>'account_id')::uuid,(p.operation_input->>'account_revision')::integer) then raise exception 'expense_account_changed' using errcode='PT409';end if;
 else
  if not private.has_scope_permission(new.scope_id,'correct_finance') then raise exception 'expense_correction_forbidden' using errcode='42501';end if;
  select * into o from public.money_movements where expense_payment_id=p.reversal_of_id;
  if o.id is null or new.kind<>'expense_reversal' or(new.reversal_of_id,new.cash_account_id,new.account_revision,new.account_snapshot,new.amount,new.reversal_of_key) is distinct from(o.id,o.cash_account_id,o.account_revision,o.account_snapshot,o.amount,o.source_key) then raise exception 'expense_compensation_mismatch' using errcode='23514';end if;
 end if;return new;
end$$;
create trigger expense_movement_guard before insert on public.money_movements for each row when(new.expense_payment_id is not null) execute function private.guard_expense_movement();

create function private.guard_expense_classification(c public.fund_classifications) returns public.fund_classifications language plpgsql security definer set search_path='' as $$
declare m public.money_movements;o public.fund_classifications;begin
 if not private.has_scope_permission(c.scope_id,'record_expenses') or c.recorded_by is distinct from private.actor() then raise exception 'expense_record_forbidden' using errcode='42501';end if;
 select * into m from public.money_movements where id=c.movement_id and scope_id=c.scope_id and expense_payment_id is not null;
 if m.id is null or c.movement_snapshot<>private.fund_source(m) or c.revision<>1 or c.previous_id is not null or length(btrim(c.reason)) not between 1 and 1000 then raise exception 'expense_fund_source_invalid' using errcode='23514';end if;
 if m.kind='expense_payment' then
  if c.mirror_of_id is not null or exists(select 1 from public.money_movements where reversal_of_id=m.id) then raise exception 'expense_fund_source_invalid' using errcode='23514';end if;
 else
  select * into o from public.fund_classifications where movement_id=m.reversal_of_id;
  if not private.has_scope_permission(c.scope_id,'correct_finance') or m.kind<>'expense_reversal' or o.id is null or c.mirror_of_id is distinct from o.id then raise exception 'expense_fund_mirror_invalid' using errcode='23514';end if;
 end if;return c;
end$$;
create function private.guard_expense_fund_line(l public.fund_movement_lines) returns public.fund_movement_lines language plpgsql security definer set search_path='' as $$
declare c public.fund_classifications;m public.money_movements;f public.funds;snapshot jsonb;begin
 if not private.has_scope_permission(l.scope_id,'record_expenses') then raise exception 'expense_record_forbidden' using errcode='42501';end if;
 select * into c from public.fund_classifications where id=l.classification_id and scope_id=l.scope_id;
 select * into m from public.money_movements where id=c.movement_id and scope_id=l.scope_id;
 select v.snapshot into snapshot from public.fund_versions v where v.fund_id=l.fund_id and v.revision=l.fund_revision and v.scope_id=l.scope_id;
 if c.id is null or c.recorded_by<>private.actor() or m.expense_payment_id is null or snapshot is null or snapshot<>l.fund_snapshot then raise exception 'expense_fund_source_invalid' using errcode='23514';end if;
 if c.mirror_of_id is null then
  select * into f from public.funds where id=l.fund_id and scope_id=l.scope_id;
  if f.archived_at is not null or f.revision<>l.fund_revision then raise exception 'expense_fund_changed' using errcode='PT409';end if;
  if f.account_id is not null and(f.account_id,f.account_revision) is distinct from(m.cash_account_id,m.account_revision) then raise exception 'expense_fund_account_incompatible' using errcode='23514';end if;
 else
  if not exists(select 1 from public.fund_movement_lines o where o.classification_id=c.mirror_of_id and(o.fund_id,o.fund_revision,o.amount,o.fund_snapshot)=(l.fund_id,l.fund_revision,l.amount,l.fund_snapshot)) then raise exception 'expense_fund_mirror_invalid' using errcode='23514';end if;
 end if;return l;
end$$;
-- Keep the entire proven incoming guards; route only the new typed expense sources.
do $$declare d text;p integer;begin
 d:=pg_get_functiondef('private.fund_classification_guard()'::regprocedure);p:=strpos(d,'begin');if p=0 then raise exception 'expense_fund_guard_dependency_changed';end if;
 execute overlay(d placing 'begin if exists(select 1 from public.money_movements expense_guard_source where expense_guard_source.id=new.movement_id and expense_guard_source.expense_payment_id is not null) then return private.guard_expense_classification(new);end if;' from p for 5);
 d:=pg_get_functiondef('private.fund_line_guard()'::regprocedure);p:=strpos(d,'begin');if p=0 then raise exception 'expense_fund_guard_dependency_changed';end if;
 execute overlay(d placing 'begin if exists(select 1 from public.fund_classifications expense_guard_class join public.money_movements expense_guard_move on expense_guard_move.id=expense_guard_class.movement_id where expense_guard_class.id=new.classification_id and expense_guard_move.expense_payment_id is not null) then return private.guard_expense_fund_line(new);end if;' from p for 5);
end$$;

create function private.post_expense_payment() returns trigger language plpgsql security definer set search_path='' as $$
declare a public.cash_accounts;o public.money_movements;original public.fund_classifications;m public.money_movements;c uuid;begin
 if new.kind='settlement' then
  select * into a from public.cash_accounts where id=(new.operation_input->>'account_id')::uuid and scope_id=new.scope_id;
  insert into public.money_movements(scope_id,expense_payment_id,cash_account_id,account_revision,account_snapshot,currency,policy,source_key,kind,direction,amount,movement_date,payment_method,source_origin,recorded_by,reason)
  select new.scope_id,new.id,a.id,a.revision,v.snapshot,'EUR','manual-expense-movement-v1','expense-payment:'||new.id,'expense_payment','out',new.amount,new.paid_on,new.method,'manual_expense_v1',private.actor(),new.reason from public.cash_account_versions v where v.account_id=a.id and v.revision=a.revision returning * into m;
  insert into public.fund_classifications(scope_id,movement_id,revision,movement_snapshot,recorded_by,reason) values(new.scope_id,m.id,1,private.fund_source(m),private.actor(),new.reason) returning id into c;
  insert into public.fund_movement_lines(classification_id,fund_id,fund_revision,scope_id,amount,fund_snapshot)
  select c,(l->>'fund_id')::uuid,(l->>'fund_revision')::integer,new.scope_id,(l->>'amount')::numeric,v.snapshot from jsonb_array_elements(new.operation_input->'lines') l join public.fund_versions v on v.fund_id=(l->>'fund_id')::uuid and v.revision=(l->>'fund_revision')::integer and v.scope_id=new.scope_id;
  if(select count(*) from public.fund_movement_lines where classification_id=c)<>jsonb_array_length(new.operation_input->'lines') then raise exception 'expense_fund_unavailable' using errcode='42501';end if;
 else
  select * into o from public.money_movements where expense_payment_id=new.reversal_of_id;
  select * into original from public.fund_classifications where movement_id=o.id;
  insert into public.money_movements(scope_id,expense_payment_id,cash_account_id,account_revision,account_snapshot,currency,policy,source_key,kind,direction,amount,movement_date,payment_method,source_origin,reversal_of_id,reversal_of_key,recorded_by,reason)
  values(new.scope_id,new.id,o.cash_account_id,o.account_revision,o.account_snapshot,'EUR','manual-expense-movement-v1','expense-payment:'||new.id,'expense_reversal','in',o.amount,new.paid_on,new.method,'manual_expense_v1',o.id,o.source_key,private.actor(),new.reason) returning * into m;
  if original.id is null then raise exception 'expense_original_analytics_missing' using errcode='23514';end if;
  insert into public.fund_classifications(scope_id,movement_id,revision,mirror_of_id,movement_snapshot,recorded_by,reason) values(new.scope_id,m.id,1,original.id,private.fund_source(m),private.actor(),new.reason) returning id into c;
  insert into public.fund_movement_lines select c,fund_id,fund_revision,scope_id,amount,fund_snapshot from public.fund_movement_lines where classification_id=original.id;
 end if;
 update public.expenses set settlement_revision=settlement_revision+1 where id=new.expense_id;
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta) values(new.scope_id,private.actor(),'expense_payment','expense_payment',new.id,new.reason,jsonb_build_object('expense_id',new.expense_id,'kind',new.kind,'amount',new.amount::text,'movement_id',m.id,'reversal_of_id',new.reversal_of_id,'replaces_id',new.replaces_id));return null;
end$$;
create trigger expense_payment_posting after insert on public.expense_payments for each row execute function private.post_expense_payment();
create function private.require_expense_posting() returns trigger language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from public.money_movements m join public.fund_classifications c on c.movement_id=m.id where m.expense_payment_id=new.id and m.amount=abs(new.amount)) then raise exception 'expense_atomic_posting_required' using errcode='23514';end if;return null;end$$;
create constraint trigger expense_requires_posting after insert on public.expense_payments deferrable initially deferred for each row execute function private.require_expense_posting();

create function private.expense_lines(lines jsonb,amount numeric) returns jsonb language plpgsql set search_path='' as $$declare l jsonb;total numeric:=0;result jsonb;begin
 if jsonb_typeof(lines) is distinct from 'array' or jsonb_array_length(lines) not between 1 and 100 then raise exception 'expense_lines_required' using errcode='23514';end if;
 foreach l in array array(select value from jsonb_array_elements(lines)) loop
  if jsonb_typeof(l)<>'object' or exists(select 1 from jsonb_object_keys(l) x where x not in('fund_id','fund_revision','amount')) or(l->>'fund_id') is null or(l->>'fund_id')!~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' or(l->>'fund_revision') is null or(l->>'fund_revision')!~'^[1-9][0-9]{0,8}$' or jsonb_typeof(l->'amount') is distinct from 'string' or(l->>'amount')!~'^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$' or(l->>'amount')::numeric<=0 then raise exception 'expense_line_invalid' using errcode='23514';end if;
  total:=total+(l->>'amount')::numeric;end loop;
 if total<>amount or(select count(distinct(value->>'fund_id')::uuid) from jsonb_array_elements(lines))<>jsonb_array_length(lines) then raise exception 'expense_whole_split_required' using errcode='23514';end if;
 select jsonb_agg(jsonb_build_object('fund_id',(value->>'fund_id')::uuid,'fund_revision',(value->>'fund_revision')::integer,'amount',((value->>'amount')::numeric(18,2))::text) order by(value->>'fund_id')::uuid) into result from jsonb_array_elements(lines);return result;
end$$;
create function private.expense_operation(scope uuid,action text,target uuid,expected_revision integer,expected_settlement_revision integer,request_key uuid,payload jsonb,note text,account_id uuid,account_revision integer,lines jsonb,compensation_date date,account_change_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare input jsonb;receipt private.expense_operations;e public.expenses;p public.expense_payments;a public.cash_accounts;o public.money_movements;v jsonb;expense_data jsonb;canonical jsonb;result uuid;rid uuid;business_hash text;begin
 if not private.has_scope_permission(scope,'record_expenses') then raise exception 'expense_record_forbidden' using errcode='42501';end if;
 if action not in('save','pay','reverse','replace') or action is null or request_key is null or note is null or length(btrim(note)) not between 1 and 1000 or note~'[[:cntrl:]]' or expected_revision is null or expected_revision<0 or expected_settlement_revision is null or expected_settlement_revision<0 then raise exception 'expense_request_invalid' using errcode='23514';end if;
 if(action in('reverse','replace') or(action='save' and target is not null)) and not private.has_scope_permission(scope,'correct_finance') then raise exception 'expense_correction_forbidden' using errcode='42501';end if;
 if action in('save','pay','replace') then expense_data:=private.expense_payload(payload,action<>'save');else if payload<>'{}'::jsonb then raise exception 'expense_fields_invalid' using errcode='23514';end if;expense_data:='{}';end if;
 if action in('pay','replace') then
  if account_id is null or account_revision is null or account_revision<1 then raise exception 'expense_explicit_account_required' using errcode='23514';end if;canonical:=private.expense_lines(lines,(expense_data->>'amount')::numeric);
 else if account_id is not null or account_revision is not null or lines is not null then raise exception 'expense_fields_invalid' using errcode='23514';end if;end if;
 if action in('save','pay') and(compensation_date is not null or account_change_reason is not null) then raise exception 'expense_fields_invalid' using errcode='23514';end if;
 if action='reverse' and account_change_reason is not null then raise exception 'expense_fields_invalid' using errcode='23514';end if;
 if account_change_reason is not null and(length(btrim(account_change_reason)) not between 1 and 1000 or account_change_reason~'[[:cntrl:]]') then raise exception 'expense_account_reason_required' using errcode='23514';end if;
 input:=jsonb_build_object('scope',scope,'action',action,'target',target,'revision',expected_revision,'settlement_revision',expected_settlement_revision,'payload',expense_data,'note',btrim(note),'account_id',account_id,'account_revision',account_revision,'lines',canonical,'compensation_date',compensation_date,'account_change_reason',case when account_change_reason is not null then btrim(account_change_reason) end);business_hash:=md5(input::text);
 perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||':expense:'||request_key,0));
 perform pg_advisory_xact_lock(hashtextextended(scope::text||':charge-publication',0));
 perform pg_advisory_xact_lock(hashtextextended(scope::text||':cash-account-configuration',0));
 perform pg_advisory_xact_lock(hashtextextended(scope::text||':fund-configuration',0));
 if not private.has_scope_permission(scope,'record_expenses') or((action in('reverse','replace') or(action='save' and target is not null)) and not private.has_scope_permission(scope,'correct_finance')) then raise exception 'expense_current_rights_changed' using errcode='42501';end if;
 select * into receipt from private.expense_operations where actor_id=private.actor() and expense_operations.request_key=expense_operation.request_key;
 if found then if receipt.input<>input then raise exception 'expense_request_changed' using errcode='PT409';end if;return receipt.result_id;end if;
 select * into receipt from private.expense_operations where actor_id=private.actor() and input_hash=business_hash limit 1;
 if found and(action<>'save' or target is not null) then if receipt.input<>input then raise exception 'expense_request_changed' using errcode='PT409';end if;insert into private.expense_operations values(private.actor(),request_key,input,business_hash,receipt.result_id);return receipt.result_id;end if;
 if action='save' then
  if target is null then
   if expected_revision<>0 or expected_settlement_revision<>0 then raise exception 'expense_revision_changed' using errcode='PT409';end if;
   insert into public.expenses(scope_id,revision,data,amount,currency,created_by,updated_by,last_reason) values(scope,1,expense_data,(expense_data->>'amount')::numeric,'EUR',private.actor(),private.actor(),btrim(note)) returning id into result;
  else
   select * into e from public.expenses where id=target and scope_id=scope for update;
   if e.id is null then raise exception 'expense_unavailable' using errcode='42501';end if;
   if e.revision<>expected_revision or e.settlement_revision<>expected_settlement_revision then raise exception 'expense_revision_changed' using errcode='PT409';end if;
   update public.expenses set revision=revision+1,data=expense_data,amount=(expense_data->>'amount')::numeric,updated_by=private.actor(),updated_at=clock_timestamp(),last_reason=btrim(note) where id=e.id returning id into result;
  end if;
 else
  if action in('reverse','replace') then
   select * into p from public.expense_payments where id=target and scope_id=scope;
   if p.id is null or p.kind<>'settlement' then raise exception 'expense_payment_unavailable' using errcode='42501';end if;
   select * into e from public.expenses where id=p.expense_id and scope_id=scope for update;
   if expected_revision<>1 or exists(select 1 from public.expense_payments where reversal_of_id=p.id) then raise exception 'expense_payment_changed' using errcode='PT409';end if;
   if compensation_date is null or compensation_date<p.paid_on or compensation_date>(clock_timestamp() at time zone 'Europe/Sofia')::date then raise exception 'expense_compensation_date_invalid' using errcode='23514';end if;
   select * into o from public.money_movements where expense_payment_id=p.id;
  else
   select * into e from public.expenses where id=target and scope_id=scope for update;
  end if;
  if e.id is null then raise exception 'expense_unavailable' using errcode='42501';end if;
  if e.settlement_revision<>expected_settlement_revision or(action='pay' and e.revision<>expected_revision) then raise exception 'expense_revision_changed' using errcode='PT409';end if;
  if action in('pay','replace') then
   select * into a from public.cash_accounts where id=account_id and scope_id=scope for share;
   if a.id is null then raise exception 'expense_account_unavailable' using errcode='42501';end if;
   if a.archived_at is not null or a.revision<>account_revision then raise exception 'expense_account_changed' using errcode='PT409';end if;
   if a.currency<>'EUR' or a.account_type is distinct from(case expense_data->>'method' when 'cash' then 'cash' when 'bank_transfer' then 'bank' end) then raise exception 'expense_account_method_invalid' using errcode='23514';end if;
   if action='replace' and a.id<>o.cash_account_id and account_change_reason is null then raise exception 'expense_account_reason_required' using errcode='23514';end if;
   if action='pay' and exists(select 1 from public.expense_payments where expense_id=e.id and kind='settlement' and replaces_id is null and payment_reference=expense_data->>'payment_reference') then raise exception 'expense_payment_reference_exists' using errcode='PT409';end if;
  end if;
  if action in('reverse','replace') then
   insert into public.expense_payments(scope_id,expense_id,expense_revision,expense_snapshot,kind,amount,currency,paid_on,method,payment_reference,reversal_of_id,operation_input,recorded_by,reason)
   values(scope,e.id,p.expense_revision,p.expense_snapshot,'reversal',-p.amount,'EUR',compensation_date,p.method,p.payment_reference,p.id,input,private.actor(),btrim(note)) returning id into rid;result:=rid;
  end if;
  if action in('pay','replace') then
   select snapshot into v from public.expense_versions where expense_id=e.id and revision=e.revision;
   insert into public.expense_payments(scope_id,expense_id,expense_revision,expense_snapshot,kind,amount,currency,paid_on,method,payment_reference,replaces_id,operation_input,recorded_by,reason)
   values(scope,e.id,e.revision,v,'settlement',(expense_data->>'amount')::numeric,'EUR',(expense_data->>'paid_on')::date,expense_data->>'method',expense_data->>'payment_reference',case when action='replace' then p.id end,input,private.actor(),btrim(note)) returning id into result;
  end if;
 end if;
 insert into private.expense_operations values(private.actor(),request_key,input,business_hash,result);return result;
end$$;

create function private.expense_feed() returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object(
 'scopes',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'label',s.label,'can_record',private.has_scope_permission(s.id,'record_expenses'),'can_correct',private.has_scope_permission(s.id,'record_expenses') and private.has_scope_permission(s.id,'correct_finance')) order by s.label,s.id),'[]') from public.management_units s where private.can_read_expenses(s.id)),
 'expenses',(select coalesce(jsonb_agg(e.data||jsonb_build_object('id',e.id,'scope_id',e.scope_id,'revision',e.revision,'settlement_revision',e.settlement_revision,'amount',e.amount::text,'state',private.expense_state(e.id)) order by e.created_at,e.id),'[]') from public.expenses e where private.can_read_expenses(e.scope_id)),
 'history',(select coalesce(jsonb_agg(to_jsonb(v) order by expense_id,revision),'[]') from public.expense_versions v where private.can_read_expenses(v.scope_id)),
 'payments',(select coalesce(jsonb_agg((to_jsonb(p)-'operation_input'-'expense_snapshot')||jsonb_build_object('amount',p.amount::text,'supplier_label',p.expense_snapshot->'data'->>'supplier_label','is_reversed',exists(select 1 from public.expense_payments where reversal_of_id=p.id),'payment_revision',case when exists(select 1 from public.expense_payments where reversal_of_id=p.id) then 2 else 1 end,'movement',jsonb_build_object('id',m.id,'direction',m.direction,'amount',m.amount::text,'cash_account_id',m.cash_account_id,'account_revision',m.account_revision,'account_label',m.account_snapshot->>'label'),'classification_id',c.id,'lines',(select jsonb_agg(jsonb_build_object('fund_id',l.fund_id,'fund_revision',l.fund_revision,'amount',l.amount::text,'label',l.fund_snapshot->>'label') order by fund_id) from public.fund_movement_lines l where classification_id=c.id)) order by p.recorded_at,p.id),'[]') from public.expense_payments p join public.money_movements m on m.expense_payment_id=p.id join public.fund_classifications c on c.movement_id=m.id where private.can_read_expenses(p.scope_id)),
 'accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'scope_id',a.scope_id,'label',a.label,'revision',a.revision,'currency',a.currency,'account_type',a.account_type,'archived_at',a.archived_at) order by a.label,a.id),'[]') from public.cash_accounts a where private.has_scope_permission(a.scope_id,'record_expenses')),
 'funds',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'scope_id',f.scope_id,'label',f.label,'revision',f.revision,'currency',f.currency,'account_id',f.account_id,'account_revision',f.account_revision,'archived_at',f.archived_at) order by f.code,f.id),'[]') from public.funds f where private.has_scope_permission(f.scope_id,'record_expenses'))
)$$;
create function public.expense_feed() returns jsonb language sql security invoker set search_path='' as $$select private.expense_feed()$$;
create function public.save_expense(scope uuid,target uuid,expected_revision integer,expected_settlement_revision integer,request_key uuid,payload jsonb,note text) returns uuid language sql security invoker set search_path='' as $$select private.expense_operation(scope,'save',target,expected_revision,expected_settlement_revision,request_key,payload,note,null,null,null,null,null)$$;
create function public.pay_expense(scope uuid,target uuid,expected_revision integer,expected_settlement_revision integer,account_id uuid,account_revision integer,lines jsonb,request_key uuid,payload jsonb,note text) returns uuid language sql security invoker set search_path='' as $$select private.expense_operation(scope,'pay',target,expected_revision,expected_settlement_revision,request_key,payload,note,account_id,account_revision,lines,null,null)$$;
create function public.reverse_expense_payment(scope uuid,target uuid,expected_revision integer,expected_settlement_revision integer,compensation_date date,request_key uuid,note text) returns uuid language sql security invoker set search_path='' as $$select private.expense_operation(scope,'reverse',target,expected_revision,expected_settlement_revision,request_key,'{}',note,null,null,null,compensation_date,null)$$;
create function public.replace_expense_payment(scope uuid,target uuid,expected_revision integer,expected_settlement_revision integer,compensation_date date,account_id uuid,account_revision integer,account_change_reason text,lines jsonb,request_key uuid,payload jsonb,note text) returns uuid language sql security invoker set search_path='' as $$select private.expense_operation(scope,'replace',target,expected_revision,expected_settlement_revision,request_key,payload,note,account_id,account_revision,lines,compensation_date,account_change_reason)$$;

alter table public.expenses enable row level security;alter table public.expense_versions enable row level security;alter table public.expense_payments enable row level security;
revoke all on public.expenses,public.expense_versions,public.expense_payments from public,anon,authenticated;
grant select on public.expenses,public.expense_versions,public.expense_payments to authenticated;
create policy expense_read on public.expenses for select to authenticated using(private.can_read_expenses(scope_id));
create policy expense_version_read on public.expense_versions for select to authenticated using(private.can_read_expenses(scope_id));
create policy expense_payment_read on public.expense_payments for select to authenticated using(private.can_read_expenses(scope_id));
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and(p.proname like 'expense_%' or p.proname like 'guard_expense%' or p.proname in('can_read_expenses','audit_expense','post_expense_payment','require_expense_posting')) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('expense_feed','save_expense','pay_expense','reverse_expense_payment','replace_expense_payment') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to authenticated',f.signature);end loop;
end$$;
grant execute on function private.can_read_expenses(uuid),private.expense_feed(),private.expense_operation(uuid,text,uuid,integer,integer,uuid,jsonb,text,uuid,integer,jsonb,date,text) to authenticated;
