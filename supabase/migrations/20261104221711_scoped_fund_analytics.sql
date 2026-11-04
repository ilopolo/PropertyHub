-- P4a: optional fund analytics of existing cash flows, not new money or a balance.
insert into public.role_permissions values ('manager','read_funds'),('cashier','read_funds'),('controller','read_funds'),('manager','manage_funds'),('cashier','manage_funds') on conflict do nothing;
create table public.funds(
 id uuid primary key default gen_random_uuid(),scope_id uuid not null references public.management_units,
 code text not null check(code~'^[a-z][a-z0-9_]{0,39}$'),kind text not null check(kind in('general','repair_renewal')),
 currency text not null check(currency='EUR'),label text not null,purpose text not null,basis_reference text not null,
 account_id uuid references public.cash_accounts,account_revision integer,
 revision integer not null check(revision>0),archived_at timestamptz,
 created_by uuid not null references public.profiles,created_at timestamptz not null,
 updated_by uuid not null references public.profiles,updated_at timestamptz not null,last_reason text not null,
 unique(scope_id,code),foreign key(account_id,account_revision) references public.cash_account_versions(account_id,revision),
 check((account_id is null)=(account_revision is null)),check(kind<>'repair_renewal' or account_id is not null)
);
create table public.fund_versions(
 fund_id uuid not null references public.funds,revision integer not null,scope_id uuid not null references public.management_units,
 snapshot jsonb not null,recorded_by uuid not null references public.profiles,recorded_at timestamptz not null,reason text not null,
 primary key(fund_id,revision)
);
create table public.fund_classifications(
 id uuid primary key default gen_random_uuid(),scope_id uuid not null references public.management_units,
 movement_id uuid not null references public.money_movements,revision integer not null check(revision>0),
 previous_id uuid references public.fund_classifications,mirror_of_id uuid unique references public.fund_classifications,
 movement_snapshot jsonb not null,recorded_by uuid not null references public.profiles,recorded_at timestamptz not null default clock_timestamp(),reason text not null,
 unique(movement_id,revision)
);
create table public.fund_movement_lines(
 classification_id uuid not null references public.fund_classifications,fund_id uuid not null,fund_revision integer not null,
 scope_id uuid not null references public.management_units,amount numeric(18,2) not null check(amount>0),
 fund_snapshot jsonb not null,primary key(classification_id,fund_id),foreign key(fund_id,fund_revision) references public.fund_versions
);
create index fund_versions_scope_idx on public.fund_versions(scope_id,fund_id,revision);
create index fund_classifications_scope_idx on public.fund_classifications(scope_id,movement_id,revision);
create index fund_lines_scope_idx on public.fund_movement_lines(scope_id,fund_id,classification_id);
create table private.fund_operations(actor_id uuid not null references public.profiles,request_key uuid not null,input jsonb not null,result_id uuid not null,primary key(actor_id,request_key));
alter table private.fund_operations enable row level security;revoke all on private.fund_operations from public,anon,authenticated;

create function private.can_read_funds(scope uuid) returns boolean language sql stable security definer set search_path='' as $$select private.has_scope_permission(scope,'read_funds') or private.has_scope_permission(scope,'manage_funds')$$;
create function private.can_use_funds(scope uuid) returns boolean language sql stable security definer set search_path='' as $$select private.can_read_funds(scope) or private.has_scope_permission(scope,'record_payments')$$;
create function private.fund_source(m public.money_movements) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('id',m.id,'scope_id',m.scope_id,'amount',m.amount::text,'currency',m.currency,'direction',m.direction,'movement_date',m.movement_date,'cash_account_id',m.cash_account_id,'account_revision',m.account_revision)
$$;
create function private.fund_payload(p jsonb,creating boolean) returns jsonb language plpgsql set search_path='' as $$
declare k text;allowed text[]:=array['label','purpose','basis_reference','account_id','account_revision'];result jsonb:='{}';
begin
 if creating then allowed:=allowed||array['code','kind','currency'];end if;
 if p is null or jsonb_typeof(p)<>'object' or exists(select 1 from jsonb_object_keys(p) x where x<>all(allowed)) then raise exception 'fund_fields_invalid' using errcode='23514';end if;
 foreach k in array array['label','purpose','basis_reference'] loop
  if jsonb_typeof(p->k) is distinct from 'string' or length(btrim(p->>k)) not between 1 and (case k when 'label' then 160 when 'purpose' then 500 else 1000 end) or(p->>k)~'[[:cntrl:]]' then raise exception 'fund_text_required' using errcode='23514';end if;
  result:=result||jsonb_build_object(k,btrim(p->>k));
 end loop;
 if not p?'account_id' or not p?'account_revision' or (p->>'account_id' is null)<>(p->>'account_revision' is null) then raise exception 'fund_account_explicit_required' using errcode='23514';end if;
 if p->>'account_id' is not null and((p->>'account_id')!~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' or(p->>'account_revision')!~'^[1-9][0-9]{0,8}$') then raise exception 'fund_account_invalid' using errcode='23514';end if;
 result:=result||jsonb_build_object('account_id',p->>'account_id','account_revision',(p->>'account_revision')::integer);
 if creating then
  if p->>'currency' is distinct from 'EUR' or p->>'kind' is null or p->>'kind' not in('general','repair_renewal') or(p->>'code') is null or(p->>'code')!~'^[a-z][a-z0-9_]{0,39}$' then raise exception 'fund_identity_invalid' using errcode='23514';end if;
  result:=result||jsonb_build_object('code',p->>'code','kind',p->>'kind','currency','EUR');
 end if;return result;
end$$;
create function private.guard_fund() returns trigger language plpgsql security definer set search_path='' as $$
declare a public.cash_accounts;
begin
 if tg_op='DELETE' then raise exception 'fund_delete_forbidden' using errcode='23514';end if;
 if not private.has_scope_permission(new.scope_id,'manage_funds') or new.updated_by is distinct from private.actor() then raise exception 'fund_manage_forbidden' using errcode='42501';end if;
 perform private.fund_payload(jsonb_build_object('code',new.code,'kind',new.kind,'currency',new.currency,'label',new.label,'purpose',new.purpose,'basis_reference',new.basis_reference,'account_id',new.account_id,'account_revision',new.account_revision),true);
 if tg_op='INSERT' then
  if new.revision<>1 or new.archived_at is not null or new.created_by<>private.actor() then raise exception 'fund_initial_invalid' using errcode='23514';end if;
 else
  if old.archived_at is not null or(new.id,new.scope_id,new.code,new.kind,new.currency,new.created_by,new.created_at) is distinct from(old.id,old.scope_id,old.code,old.kind,old.currency,old.created_by,old.created_at) or new.revision<>old.revision+1 then raise exception 'fund_identity_immutable' using errcode='23514';end if;
 end if;
 if new.archived_at is null and new.account_id is not null then
  select * into a from public.cash_accounts where id=new.account_id and scope_id=new.scope_id;
  if a.id is null or a.currency<>'EUR' then raise exception 'fund_account_unavailable' using errcode='42501';end if;
  if a.archived_at is not null or a.revision<>new.account_revision then raise exception 'fund_account_changed' using errcode='PT409';end if;
  if new.kind='repair_renewal' and a.account_type<>'bank' then raise exception 'fund_special_bank_required' using errcode='23514';end if;
 end if;
 if length(btrim(new.last_reason)) not between 1 and 1000 then raise exception 'fund_reason_required' using errcode='23514';end if;return new;
end$$;
create trigger fund_guard before insert or update or delete on public.funds for each row execute function private.guard_fund();
create function private.audit_fund() returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into public.fund_versions values(new.id,new.revision,new.scope_id,to_jsonb(new),private.actor(),new.updated_at,new.last_reason);
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta) values(new.scope_id,private.actor(),'fund_configuration','fund',new.id,new.last_reason,jsonb_build_object('before',case when tg_op='UPDATE' then to_jsonb(old) else null end,'after',to_jsonb(new)));
 return new;
end$$;
create trigger fund_audit after insert or update on public.funds for each row execute function private.audit_fund();
create trigger fund_versions_immutable before update or delete on public.fund_versions for each row execute function private.immutable_manual_payment();
create trigger fund_classifications_immutable before update or delete on public.fund_classifications for each row execute function private.immutable_manual_payment();
create trigger fund_lines_immutable before update or delete on public.fund_movement_lines for each row execute function private.immutable_manual_payment();

create function private.fund_operation(scope uuid,target uuid,expected_revision integer,request_key uuid,payload jsonb,note text,deactivating boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare input jsonb;receipt private.fund_operations;old public.funds;data jsonb;result uuid;stamp timestamptz;
begin
 if not private.has_scope_permission(scope,'manage_funds') then raise exception 'fund_manage_forbidden' using errcode='42501';end if;
 if request_key is null or note is null or length(btrim(note)) not between 1 and 1000 or deactivating is null then raise exception 'fund_request_required' using errcode='23514';end if;
 input:=jsonb_build_object('operation','config','scope',scope,'target',target,'revision',expected_revision,'payload',payload,'note',btrim(note),'deactivate',deactivating);
 perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||':fund:'||request_key::text,0));
 perform pg_advisory_xact_lock(hashtextextended(scope::text||':cash-account-configuration',0));
 perform pg_advisory_xact_lock(hashtextextended(scope::text||':fund-configuration',0));
 if not private.has_scope_permission(scope,'manage_funds') then raise exception 'fund_manage_forbidden' using errcode='42501';end if;
 select * into receipt from private.fund_operations where actor_id=private.actor() and fund_operations.request_key=fund_operation.request_key;
 if found then if receipt.input<>input then raise exception 'fund_request_changed' using errcode='PT409';end if;return receipt.result_id;end if;
 if target is null then
  if deactivating or expected_revision is distinct from 0 then raise exception 'fund_initial_invalid' using errcode='23514';end if;
  data:=private.fund_payload(payload,true);stamp:=clock_timestamp();
  if exists(select 1 from public.funds f where f.scope_id=scope and f.code=data->>'code') then raise exception 'fund_code_exists' using errcode='PT409';end if;
  insert into public.funds(scope_id,code,kind,currency,label,purpose,basis_reference,account_id,account_revision,revision,created_by,created_at,updated_by,updated_at,last_reason)
  values(scope,data->>'code',data->>'kind','EUR',data->>'label',data->>'purpose',data->>'basis_reference',(data->>'account_id')::uuid,(data->>'account_revision')::integer,1,private.actor(),stamp,private.actor(),stamp,btrim(note)) returning id into result;
 else
  select * into old from public.funds where id=target and scope_id=scope for update;
  if old.id is null then raise exception 'fund_unavailable' using errcode='42501';end if;
  if old.archived_at is not null or old.revision is distinct from expected_revision then raise exception 'fund_revision_changed' using errcode='PT409';end if;
  stamp:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
  if deactivating then
   if payload is distinct from '{}'::jsonb then raise exception 'fund_fields_invalid' using errcode='23514';end if;
   update public.funds set archived_at=stamp,revision=revision+1,updated_by=private.actor(),updated_at=stamp,last_reason=btrim(note) where id=target;
  else
   data:=private.fund_payload(payload,false);
   if(old.label,old.purpose,old.basis_reference,old.account_id,old.account_revision) is not distinct from(data->>'label',data->>'purpose',data->>'basis_reference',(data->>'account_id')::uuid,(data->>'account_revision')::integer) then raise exception 'fund_no_changes' using errcode='23514';end if;
   update public.funds set label=data->>'label',purpose=data->>'purpose',basis_reference=data->>'basis_reference',account_id=(data->>'account_id')::uuid,account_revision=(data->>'account_revision')::integer,revision=revision+1,updated_by=private.actor(),updated_at=stamp,last_reason=btrim(note) where id=target;
  end if;result:=target;
 end if;
 insert into private.fund_operations values(private.actor(),request_key,input,result);return result;
end$$;

create function private.fund_classification_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare m public.money_movements;previous public.fund_classifications;original public.fund_classifications;
begin
 if not private.has_scope_permission(new.scope_id,'record_payments') or new.recorded_by is distinct from private.actor() then raise exception 'fund_classify_forbidden' using errcode='42501';end if;
 select * into m from public.money_movements where id=new.movement_id and scope_id=new.scope_id;
 if m.id is null or new.movement_snapshot is distinct from private.fund_source(m) or length(btrim(new.reason)) not between 1 and 1000 then raise exception 'fund_source_invalid' using errcode='23514';end if;
 if new.mirror_of_id is null then
  if m.kind<>'payment_receipt' or exists(select 1 from public.money_movements where reversal_of_id=m.id) then raise exception 'fund_source_reversed' using errcode='PT409';end if;
  select * into previous from public.fund_classifications where movement_id=m.id order by revision desc limit 1;
  if new.revision<>coalesce(previous.revision,0)+1 or new.previous_id is distinct from previous.id then raise exception 'fund_revision_changed' using errcode='PT409';end if;
  if previous.id is not null and not private.has_scope_permission(new.scope_id,'correct_finance') then raise exception 'fund_correction_forbidden' using errcode='42501';end if;
 else
  select * into original from public.fund_classifications where id=new.mirror_of_id and scope_id=new.scope_id;
  if not private.has_scope_permission(new.scope_id,'correct_finance') or m.kind<>'payment_reversal' or original.id is null or original.movement_id<>m.reversal_of_id or new.revision<>1 or new.previous_id is not null or exists(select 1 from public.fund_classifications where movement_id=original.movement_id and revision>original.revision) then raise exception 'fund_mirror_invalid' using errcode='23514';end if;
 end if;return new;
end$$;
create trigger fund_classification_guard before insert on public.fund_classifications for each row execute function private.fund_classification_guard();
create function private.fund_line_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.fund_classifications;m public.money_movements;f public.funds;snapshot jsonb;
begin
 select * into c from public.fund_classifications where id=new.classification_id and scope_id=new.scope_id;
 if c.id is null or c.recorded_by is distinct from private.actor() or not private.has_scope_permission(new.scope_id,'record_payments') then raise exception 'fund_classify_forbidden' using errcode='42501';end if;
 select * into m from public.money_movements where id=c.movement_id;
 select v.snapshot into snapshot from public.fund_versions v where v.fund_id=new.fund_id and v.revision=new.fund_revision and v.scope_id=new.scope_id;
 if snapshot is null or snapshot is distinct from new.fund_snapshot then raise exception 'fund_snapshot_invalid' using errcode='23514';end if;
 if c.mirror_of_id is null then
  select * into f from public.funds where id=new.fund_id and scope_id=new.scope_id;
  if f.id is null then raise exception 'fund_unavailable' using errcode='42501';end if;
  if f.archived_at is not null or f.revision<>new.fund_revision then raise exception 'fund_revision_changed' using errcode='PT409';end if;
  if f.account_id is not null and(f.account_id,f.account_revision) is distinct from(m.cash_account_id,m.account_revision) then raise exception 'fund_account_incompatible' using errcode='23514';end if;
 else
  if not exists(select 1 from public.fund_movement_lines l where l.classification_id=c.mirror_of_id and(l.fund_id,l.fund_revision,l.amount,l.fund_snapshot)=(new.fund_id,new.fund_revision,new.amount,new.fund_snapshot)) then raise exception 'fund_mirror_line_invalid' using errcode='23514';end if;
 end if;return new;
end$$;
create trigger fund_line_guard before insert on public.fund_movement_lines for each row execute function private.fund_line_guard();
create function private.require_fund_split() returns trigger language plpgsql security definer set search_path='' as $$
declare total numeric;amount numeric;begin
 select coalesce(sum(l.amount),0) into total from public.fund_movement_lines l where l.classification_id=new.id;
 select m.amount into amount from public.money_movements m where m.id=new.movement_id;
 if total<>amount then raise exception 'fund_full_split_required' using errcode='23514';end if;return null;
end$$;
create constraint trigger fund_full_split after insert on public.fund_classifications deferrable initially deferred for each row execute function private.require_fund_split();

create function private.classify_fund_movement(scope uuid,movement uuid,expected_revision integer,request_key uuid,lines jsonb,note text) returns uuid language plpgsql security definer set search_path='' as $$
declare m public.money_movements;c public.fund_classifications;receipt private.fund_operations;l jsonb;canonical jsonb;existing jsonb;input jsonb;total numeric:=0;result uuid;
begin
 if not private.has_scope_permission(scope,'record_payments') or(expected_revision>0 and not private.has_scope_permission(scope,'correct_finance')) then raise exception 'fund_classify_forbidden' using errcode='42501';end if;
 if expected_revision is null or expected_revision<0 or request_key is null or note is null or length(btrim(note)) not between 1 and 1000 or jsonb_typeof(lines) is distinct from 'array' then raise exception 'fund_request_invalid' using errcode='23514';end if;
 if jsonb_array_length(lines) not between 1 and 100 then raise exception 'fund_lines_required' using errcode='23514';end if;
 foreach l in array array(select value from jsonb_array_elements(lines)) loop
  if jsonb_typeof(l)<>'object' or exists(select 1 from jsonb_object_keys(l) x where x not in('fund_id','fund_revision','amount')) or(l->>'fund_id') is null or(l->>'fund_id')!~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' or(l->>'fund_revision') is null or(l->>'fund_revision')!~'^[1-9][0-9]{0,8}$' or jsonb_typeof(l->'amount') is distinct from 'string' or(l->>'amount')!~'^[0-9]{1,16}(\.[0-9]{1,2})?$' or(l->>'amount')::numeric<=0 then raise exception 'fund_line_invalid' using errcode='23514';end if;
  total:=total+(l->>'amount')::numeric;
 end loop;
 if(select count(distinct (value->>'fund_id')::uuid) from jsonb_array_elements(lines))<>jsonb_array_length(lines) then raise exception 'fund_duplicate_line' using errcode='23514';end if;
 select jsonb_agg(jsonb_build_object('fund_id',(value->>'fund_id')::uuid,'fund_revision',(value->>'fund_revision')::integer,'amount',((value->>'amount')::numeric(18,2))::text) order by(value->>'fund_id')::uuid) into canonical from jsonb_array_elements(lines);
 input:=jsonb_build_object('operation','classify','scope',scope,'movement',movement,'revision',expected_revision,'lines',canonical,'note',btrim(note));
 perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||':fund:'||request_key::text,0));
 perform pg_advisory_xact_lock(hashtextextended(scope::text||':charge-publication',0));
 perform pg_advisory_xact_lock(hashtextextended(scope::text||':cash-account-configuration',0));
 perform pg_advisory_xact_lock(hashtextextended(scope::text||':fund-configuration',0));
 if not private.has_scope_permission(scope,'record_payments') or(expected_revision>0 and not private.has_scope_permission(scope,'correct_finance')) then raise exception 'fund_classify_forbidden' using errcode='42501';end if;
 perform 1 from public.payments where id=(select payment_id from public.money_movements where id=movement and scope_id=scope) for update;
 select * into m from public.money_movements where id=movement and scope_id=scope for update;
 if m.id is null then raise exception 'fund_movement_unavailable' using errcode='42501';end if;
 if m.kind<>'payment_receipt' or exists(select 1 from public.money_movements where reversal_of_id=m.id) then raise exception 'fund_source_reversed' using errcode='PT409';end if;
 if total<>m.amount then raise exception 'fund_full_split_required' using errcode='23514';end if;
 select * into receipt from private.fund_operations where actor_id=private.actor() and fund_operations.request_key=classify_fund_movement.request_key;
 if found then if receipt.input<>input then raise exception 'fund_request_changed' using errcode='PT409';end if;return receipt.result_id;end if;
 select * into c from public.fund_classifications where movement_id=movement order by revision desc limit 1;
 select jsonb_agg(jsonb_build_object('fund_id',l.fund_id,'fund_revision',l.fund_revision,'amount',l.amount::text) order by l.fund_id) into existing from public.fund_movement_lines l where l.classification_id=c.id;
 if c.id is not null and c.revision=expected_revision+1 and existing=canonical and c.reason=btrim(note) then
  insert into private.fund_operations values(private.actor(),request_key,input,c.id);return c.id;
 end if;
 if coalesce(c.revision,0)<>expected_revision then raise exception 'fund_revision_changed' using errcode='PT409';end if;
 if existing=canonical then raise exception 'fund_no_changes' using errcode='23514';end if;
 insert into public.fund_classifications(scope_id,movement_id,revision,previous_id,movement_snapshot,recorded_by,reason)
 values(scope,m.id,expected_revision+1,c.id,private.fund_source(m),private.actor(),btrim(note)) returning id into result;
 insert into public.fund_movement_lines(classification_id,fund_id,fund_revision,scope_id,amount,fund_snapshot)
 select result,(v->>'fund_id')::uuid,(v->>'fund_revision')::integer,scope,(v->>'amount')::numeric,f.snapshot from jsonb_array_elements(canonical) v
 join public.fund_versions f on f.fund_id=(v->>'fund_id')::uuid and f.revision=(v->>'fund_revision')::integer and f.scope_id=scope;
 if(select count(*) from public.fund_movement_lines where classification_id=result)<>jsonb_array_length(canonical) then raise exception 'fund_unavailable' using errcode='42501';end if;
 insert into private.fund_operations values(private.actor(),request_key,input,result);
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta) values(scope,private.actor(),'fund_classify','fund_classification',result,btrim(note),jsonb_build_object('movement_id',m.id,'revision',expected_revision+1,'previous_id',c.id));
 return result;
end$$;

-- Hook the immutable posting boundary, so every successful compensation gets its mirror.
create function private.mirror_fund_compensation() returns trigger language plpgsql security definer set search_path='' as $$
declare original public.fund_classifications;result uuid;
begin
 if new.kind<>'payment_reversal' then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended(new.scope_id::text||':charge-publication',0));
 perform pg_advisory_xact_lock(hashtextextended(new.scope_id::text||':cash-account-configuration',0));
 perform pg_advisory_xact_lock(hashtextextended(new.scope_id::text||':fund-configuration',0));
 perform 1 from public.money_movements where id=new.reversal_of_id for update;
 select * into original from public.fund_classifications where movement_id=new.reversal_of_id order by revision desc limit 1;
 if original.id is null then return new;end if;
 insert into public.fund_classifications(scope_id,movement_id,revision,mirror_of_id,movement_snapshot,recorded_by,reason)
 values(new.scope_id,new.id,1,original.id,private.fund_source(new),private.actor(),new.reason) returning id into result;
 insert into public.fund_movement_lines(classification_id,fund_id,fund_revision,scope_id,amount,fund_snapshot)
 select result,fund_id,fund_revision,scope_id,amount,fund_snapshot from public.fund_movement_lines where classification_id=original.id;
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta) values(new.scope_id,private.actor(),'fund_compensate','fund_classification',result,new.reason,jsonb_build_object('movement_id',new.id,'mirror_of_id',original.id));
 return new;
end$$;
create trigger fund_compensation after insert on public.money_movements for each row execute function private.mirror_fund_compensation();

create function private.fund_feed() returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object(
 'scopes',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'label',s.label,'can_manage',private.has_scope_permission(s.id,'manage_funds'),'can_classify',private.has_scope_permission(s.id,'record_payments'),'can_correct',private.has_scope_permission(s.id,'record_payments') and private.has_scope_permission(s.id,'correct_finance'),'can_read_analytics',private.has_scope_permission(s.id,'read_funds') or private.has_scope_permission(s.id,'record_payments')) order by s.label,s.id),'[]') from public.management_units s where private.can_use_funds(s.id)),
 'funds',(select coalesce(jsonb_agg(case when private.can_read_funds(f.scope_id) then to_jsonb(f) else jsonb_build_object('id',f.id,'scope_id',f.scope_id,'code',f.code,'kind',f.kind,'currency',f.currency,'label',f.label,'purpose',f.purpose,'basis_reference',f.basis_reference,'account_id',f.account_id,'account_revision',f.account_revision,'revision',f.revision,'archived_at',f.archived_at) end order by f.code,f.id),'[]') from public.funds f where private.can_use_funds(f.scope_id)),
 'accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'scope_id',a.scope_id,'label',a.label,'account_type',a.account_type,'currency',a.currency,'revision',a.revision,'archived_at',a.archived_at) order by a.label,a.id),'[]') from public.cash_accounts a where private.has_scope_permission(a.scope_id,'manage_funds')),
 'history',(select coalesce(jsonb_agg(to_jsonb(v) order by v.fund_id,v.revision),'[]') from public.fund_versions v where private.can_read_funds(v.scope_id)),
 'movements',(select coalesce(jsonb_agg(private.fund_source(m)||jsonb_build_object('kind',m.kind,'reversal_of_id',m.reversal_of_id,'is_reversed',exists(select 1 from public.money_movements r where r.reversal_of_id=m.id),'classification_revision',coalesce((select max(c.revision) from public.fund_classifications c where c.movement_id=m.id),0)) order by m.movement_date,m.id),'[]') from public.money_movements m where private.has_scope_permission(m.scope_id,'read_funds') or private.has_scope_permission(m.scope_id,'record_payments')),
 'classifications',(select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('lines',(select jsonb_agg(jsonb_build_object('fund_id',l.fund_id,'fund_revision',l.fund_revision,'amount',l.amount::text,'fund_snapshot',l.fund_snapshot) order by l.fund_id) from public.fund_movement_lines l where l.classification_id=c.id)) order by c.movement_id,c.revision),'[]') from public.fund_classifications c where private.has_scope_permission(c.scope_id,'read_funds') or private.has_scope_permission(c.scope_id,'record_payments'))
)$$;
create function public.fund_feed() returns jsonb language sql security invoker set search_path='' as $$select private.fund_feed()$$;
create function public.save_fund(scope uuid,target uuid,expected_revision integer,request_key uuid,payload jsonb,note text) returns uuid language sql security invoker set search_path='' as $$select private.fund_operation(scope,target,expected_revision,request_key,payload,note,false)$$;
create function public.deactivate_fund(scope uuid,target uuid,expected_revision integer,request_key uuid,note text) returns uuid language sql security invoker set search_path='' as $$select private.fund_operation(scope,target,expected_revision,request_key,'{}',note,true)$$;
create function public.classify_fund_movement(scope uuid,movement uuid,expected_revision integer,request_key uuid,lines jsonb,note text) returns uuid language sql security invoker set search_path='' as $$select private.classify_fund_movement(scope,movement,expected_revision,request_key,lines,note)$$;

alter table public.funds enable row level security;alter table public.fund_versions enable row level security;alter table public.fund_classifications enable row level security;alter table public.fund_movement_lines enable row level security;
revoke all on public.funds,public.fund_versions,public.fund_classifications,public.fund_movement_lines from public,anon,authenticated;
grant select on public.funds,public.fund_versions,public.fund_classifications,public.fund_movement_lines to authenticated;
create policy fund_read on public.funds for select to authenticated using(private.can_read_funds(scope_id));
create policy fund_version_read on public.fund_versions for select to authenticated using(private.can_read_funds(scope_id));
create policy fund_classification_read on public.fund_classifications for select to authenticated using(private.has_scope_permission(scope_id,'read_funds'));
create policy fund_line_read on public.fund_movement_lines for select to authenticated using(private.has_scope_permission(scope_id,'read_funds'));
revoke all on function private.can_read_funds(uuid),private.can_use_funds(uuid),private.fund_source(public.money_movements),private.fund_payload(jsonb,boolean),private.guard_fund(),private.audit_fund(),private.fund_operation(uuid,uuid,integer,uuid,jsonb,text,boolean),private.fund_classification_guard(),private.fund_line_guard(),private.require_fund_split(),private.classify_fund_movement(uuid,uuid,integer,uuid,jsonb,text),private.mirror_fund_compensation(),private.fund_feed(),public.fund_feed(),public.save_fund(uuid,uuid,integer,uuid,jsonb,text),public.deactivate_fund(uuid,uuid,integer,uuid,text),public.classify_fund_movement(uuid,uuid,integer,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function private.can_read_funds(uuid),private.fund_operation(uuid,uuid,integer,uuid,jsonb,text,boolean),private.classify_fund_movement(uuid,uuid,integer,uuid,jsonb,text),private.fund_feed(),public.fund_feed(),public.save_fund(uuid,uuid,integer,uuid,jsonb,text),public.deactivate_fund(uuid,uuid,integer,uuid,text),public.classify_fund_movement(uuid,uuid,integer,uuid,jsonb,text) to authenticated;
