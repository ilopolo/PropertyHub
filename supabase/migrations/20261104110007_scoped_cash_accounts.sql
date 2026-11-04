-- DB-21 configuration only. No money movements, balances, allocations or fund mapping.
insert into public.role_permissions values ('manager','manage_cash_accounts'),('cashier','manage_cash_accounts') on conflict do nothing;
create table public.cash_accounts(
 id uuid primary key default gen_random_uuid(),scope_id uuid not null references public.management_units,
 account_type text not null check(account_type in('cash','bank')),currency text not null check(currency='EUR'),
 label text not null check(length(btrim(label)) between 1 and 160),purpose text not null check(length(btrim(purpose)) between 1 and 500),
 holder_label text,account_reference text,
 revision integer not null check(revision>0),archived_at timestamptz,
 created_by uuid not null references public.profiles,created_at timestamptz not null,
 updated_by uuid not null references public.profiles,updated_at timestamptz not null,last_reason text not null,
 check((account_type='cash' and holder_label is null and account_reference is null)
  or(account_type='bank' and holder_label is not null and length(btrim(holder_label)) between 1 and 160
    and account_reference is not null and length(btrim(account_reference)) between 1 and 160))
);
create index cash_accounts_scope_idx on public.cash_accounts(scope_id,id);
create table public.cash_account_versions(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.cash_accounts,
 scope_id uuid not null references public.management_units,revision integer not null,snapshot jsonb not null,
 recorded_by uuid not null references public.profiles,recorded_at timestamptz not null,reason text not null,
 unique(account_id,revision)
);
create index cash_account_versions_scope_idx on public.cash_account_versions(scope_id,account_id,revision);
create table private.cash_account_operations(actor_id uuid not null references public.profiles,request_key uuid not null,input jsonb not null,result_id uuid not null references public.cash_accounts,primary key(actor_id,request_key));
alter table private.cash_account_operations enable row level security;revoke all on private.cash_account_operations from public,anon,authenticated;

create function private.can_read_cash_accounts(scope uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_scope_permission(scope,'manage_cash_accounts') or private.has_scope_permission(scope,'read_payments') or private.has_scope_permission(scope,'record_payments')$$;
create function private.cash_account_payload(p jsonb,creating boolean) returns jsonb language plpgsql set search_path='' as $$
declare k text;allowed text[]:=case when creating then array['account_type','currency','label','purpose','holder_label','account_reference'] else array['label','purpose'] end;out jsonb:='{}';
begin
 if p is null or jsonb_typeof(p)<>'object' or p-allowed<>'{}' then raise exception 'cash_account_fields_invalid' using errcode='23514';end if;
 foreach k in array array['label','purpose'] loop
  if jsonb_typeof(p->k) is distinct from 'string' or length(btrim(p->>k)) not between 1 and(case when k='label' then 160 else 500 end) or (p->>k)~'[[:cntrl:]]' then raise exception 'cash_account_text_invalid' using errcode='23514';end if;
  out:=out||jsonb_build_object(k,btrim(p->>k));
 end loop;
 if not creating then return out;end if;
 if p->>'currency' is distinct from 'EUR' or p->>'account_type' is null or p->>'account_type' not in('cash','bank') then raise exception 'cash_account_type_currency_invalid' using errcode='23514';end if;
 if p->>'account_type'='bank' then
  foreach k in array array['holder_label','account_reference'] loop
   if jsonb_typeof(p->k) is distinct from 'string' or length(btrim(p->>k)) not between 1 and 160 or (p->>k)~'[[:cntrl:]]' or (p->>k) like '%://%' then raise exception 'cash_account_bank_details_required' using errcode='23514';end if;
   out:=out||jsonb_build_object(k,btrim(p->>k));
  end loop;
 else
  if p->>'holder_label' is not null or p->>'account_reference' is not null then raise exception 'cash_account_cash_has_bank_fields' using errcode='23514';end if;
  out:=out||jsonb_build_object('holder_label',null,'account_reference',null);
 end if;
 return out||jsonb_build_object('account_type',p->>'account_type','currency','EUR');
end$$;

create function private.guard_cash_account() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'cash_account_delete_forbidden' using errcode='23514';end if;
 if not private.has_scope_permission(new.scope_id,'manage_cash_accounts') or new.updated_by is distinct from private.actor() then raise exception 'cash_account_manage_forbidden' using errcode='42501';end if;
 if tg_op='INSERT' then
  if new.revision<>1 or new.archived_at is not null or new.created_by is distinct from private.actor() then raise exception 'cash_account_initial_state_invalid' using errcode='23514';end if;
 else
  if (new.id,new.scope_id,new.account_type,new.currency,new.holder_label,new.account_reference,new.created_by,new.created_at)
   is distinct from(old.id,old.scope_id,old.account_type,old.currency,old.holder_label,old.account_reference,old.created_by,old.created_at)
  then raise exception 'cash_account_identity_immutable' using errcode='23514';end if;
  if old.archived_at is not null or new.revision<>old.revision+1 then raise exception 'cash_account_revision_changed' using errcode='PT409';end if;
  if new.archived_at is not null and ((new.label,new.purpose) is distinct from(old.label,old.purpose) or new.archived_at<>new.updated_at) then raise exception 'cash_account_deactivation_invalid' using errcode='23514';end if;
 end if;
 if length(btrim(new.last_reason)) not between 1 and 1000 then raise exception 'cash_account_reason_required' using errcode='23514';end if;
 return new;
end$$;
create trigger cash_account_guard before insert or update or delete on public.cash_accounts for each row execute function private.guard_cash_account();
create function private.audit_cash_account() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.cash_account_versions(account_id,scope_id,revision,snapshot,recorded_by,recorded_at,reason)
 values(new.id,new.scope_id,new.revision,to_jsonb(new),new.updated_by,new.updated_at,new.last_reason);
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta)
 values(new.scope_id,private.actor(),case when tg_op='INSERT' then 'cash_account_create' when new.archived_at is not null then 'cash_account_deactivate' else 'cash_account_edit' end,'cash_account',new.id,new.last_reason,jsonb_build_object('revision',new.revision,'before',case when tg_op='UPDATE' then to_jsonb(old) else null end,'after',to_jsonb(new)));
 return new;
end$$;
create trigger cash_account_audit after insert or update on public.cash_accounts for each row execute function private.audit_cash_account();
create function private.immutable_cash_account_version() returns trigger language plpgsql set search_path='' as $$begin raise exception 'cash_account_history_immutable' using errcode='23514';end$$;
create trigger cash_account_version_guard before update or delete on public.cash_account_versions for each row execute function private.immutable_cash_account_version();

create function private.cash_account_operation(scope uuid,target uuid,expected_revision integer,request_key uuid,payload jsonb,note text,deactivating boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare input jsonb;receipt private.cash_account_operations;old public.cash_accounts;data jsonb;result uuid;stamp timestamptz;
begin
 if not private.has_scope_permission(scope,'manage_cash_accounts') then raise exception 'cash_account_manage_forbidden' using errcode='42501';end if;
 if request_key is null or note is null or length(btrim(note)) not between 1 and 1000 or deactivating is null then raise exception 'cash_account_request_required' using errcode='23514';end if;
 input:=jsonb_build_object('scope',scope,'target',target,'revision',expected_revision,'payload',payload,'note',btrim(note),'deactivate',deactivating);
 perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||':cash-account:'||request_key::text,0));
 perform pg_advisory_xact_lock(hashtextextended(scope::text||':cash-account-configuration',0));
 if not private.has_scope_permission(scope,'manage_cash_accounts') then raise exception 'cash_account_manage_forbidden' using errcode='42501';end if;
 select * into receipt from private.cash_account_operations where actor_id=private.actor() and cash_account_operations.request_key=cash_account_operation.request_key;
 if found then if receipt.input<>input then raise exception 'cash_account_request_changed' using errcode='PT409';end if;return receipt.result_id;end if;
 if target is null then
  if deactivating or expected_revision is distinct from 0 then raise exception 'cash_account_initial_state_invalid' using errcode='23514';end if;
  data:=private.cash_account_payload(payload,true);stamp:=clock_timestamp();
  insert into public.cash_accounts(scope_id,account_type,currency,label,purpose,holder_label,account_reference,revision,created_by,created_at,updated_by,updated_at,last_reason)
  values(scope,data->>'account_type','EUR',data->>'label',data->>'purpose',data->>'holder_label',data->>'account_reference',1,private.actor(),stamp,private.actor(),stamp,btrim(note)) returning id into result;
 else
  select * into old from public.cash_accounts where id=target and scope_id=scope for update;
  if old.id is null then raise exception 'cash_account_unavailable' using errcode='42501';end if;
  if old.archived_at is not null or old.revision is distinct from expected_revision then raise exception 'cash_account_revision_changed' using errcode='PT409';end if;
  stamp:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
  if deactivating then
   if payload is distinct from '{}'::jsonb then raise exception 'cash_account_fields_invalid' using errcode='23514';end if;
   update public.cash_accounts set archived_at=stamp,revision=revision+1,updated_by=private.actor(),updated_at=stamp,last_reason=btrim(note) where id=target;
  else
   data:=private.cash_account_payload(payload,false);
   if(old.label,old.purpose) is not distinct from(data->>'label',data->>'purpose') then raise exception 'cash_account_no_changes' using errcode='23514';end if;
   update public.cash_accounts set label=data->>'label',purpose=data->>'purpose',revision=revision+1,updated_by=private.actor(),updated_at=stamp,last_reason=btrim(note) where id=target;
  end if;result:=target;
 end if;
 insert into private.cash_account_operations values(private.actor(),request_key,input,result);return result;
end$$;
create function private.cash_account_feed() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'scopes',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'can_manage',private.has_scope_permission(id,'manage_cash_accounts')) order by label),'[]') from public.management_units where private.can_read_cash_accounts(id)),
 'accounts',(select coalesce(jsonb_agg(to_jsonb(a) order by label,id),'[]') from public.cash_accounts a where private.can_read_cash_accounts(scope_id)),
 'history',(select coalesce(jsonb_agg(to_jsonb(v) order by account_id,revision),'[]') from public.cash_account_versions v where private.can_read_cash_accounts(scope_id)))$$;
create function public.cash_account_feed() returns jsonb language sql security invoker set search_path='' as $$select private.cash_account_feed()$$;
create function public.save_cash_account(scope uuid,target uuid,expected_revision integer,request_key uuid,payload jsonb,note text) returns uuid language sql security invoker set search_path='' as $$select private.cash_account_operation(scope,target,expected_revision,request_key,payload,note,false)$$;
create function public.deactivate_cash_account(scope uuid,target uuid,expected_revision integer,request_key uuid,note text) returns uuid language sql security invoker set search_path='' as $$select private.cash_account_operation(scope,target,expected_revision,request_key,'{}',note,true)$$;

alter table public.cash_accounts enable row level security;alter table public.cash_account_versions enable row level security;
revoke all on public.cash_accounts,public.cash_account_versions from public,anon,authenticated;
grant select on public.cash_accounts,public.cash_account_versions to authenticated;
create policy cash_account_read on public.cash_accounts for select to authenticated using(private.can_read_cash_accounts(scope_id));
create policy cash_account_history_read on public.cash_account_versions for select to authenticated using(private.can_read_cash_accounts(scope_id));
revoke all on function private.can_read_cash_accounts(uuid),private.cash_account_payload(jsonb,boolean),private.guard_cash_account(),private.audit_cash_account(),private.immutable_cash_account_version(),private.cash_account_operation(uuid,uuid,integer,uuid,jsonb,text,boolean),private.cash_account_feed(),public.cash_account_feed(),public.save_cash_account(uuid,uuid,integer,uuid,jsonb,text),public.deactivate_cash_account(uuid,uuid,integer,uuid,text) from public,anon,authenticated;
grant execute on function private.can_read_cash_accounts(uuid),private.cash_account_operation(uuid,uuid,integer,uuid,jsonb,text,boolean),private.cash_account_feed(),public.cash_account_feed(),public.save_cash_account(uuid,uuid,integer,uuid,jsonb,text),public.deactivate_cash_account(uuid,uuid,integer,uuid,text) to authenticated;
