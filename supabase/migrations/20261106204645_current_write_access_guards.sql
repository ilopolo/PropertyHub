-- Local access correction; separate exact hosted permission is required before apply.
-- Targets the accepted 40-version baseline. No CALC tables/functions are dependencies.
-- Only the enumerated write workers change; read policies and the canonical STABLE
-- helpers remain intact. Financial/business dates and original records are untouched.

-- VOLATILE PL/pgSQL obtains a fresh statement snapshot at each guard under READ COMMITTED.
-- clock_timestamp is evaluated for authority intervals only, never calculation dates.
-- Fail closed under fixed-snapshot isolation; it cannot establish a committed revoke.
create function private.current_write_permission(scope uuid,permission text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare checked_at timestamptz;allowed boolean;begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'current_write_isolation_unsupported' using errcode='42501';end if;
 checked_at:=clock_timestamp();
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
create function private.current_write_org_admin(org uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare checked_at timestamptz;allowed boolean;begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'current_write_isolation_unsupported' using errcode='42501';end if;
 checked_at:=clock_timestamp();
 select exists(select 1 from public.user_roles r
 join public.organization_memberships m on m.id=r.membership_id
 join public.organizations o on o.id=m.organization_id join public.profiles p on p.id=r.profile_id
 where r.profile_id=private.actor() and p.status='active' and r.role_code='org_admin' and 'manage_members'=any(r.permissions)
 and m.organization_id=org and m.status='active' and o.status='active'
 and r.valid_from<=checked_at and(r.valid_to is null or checked_at<r.valid_to)
 and m.valid_from<=checked_at and(m.valid_to is null or checked_at<m.valid_to)) into allowed;
 return allowed;
end $$;
create function private.current_write_unit_document(scope uuid,unit uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
 if not(private.current_write_permission(scope,'manage_documents') and private.current_write_permission(scope,'read_registry')) then return false;end if;
 -- Current unit eligibility is authority, not a charge/ownership business timestamp.
 -- Retain Europe/Sofia and the stored intervals; evaluate only this access day live.
 return exists(select 1 from public.unit_scope_periods up join public.units u on u.id=up.unit_id and u.archived_at is null
 where up.scope_id=scope and up.unit_id=unit and daterange(up.valid_from,up.valid_to,'[)') @> (clock_timestamp() at time zone 'Europe/Sofia')::date);
end $$;
revoke all on function private.current_write_permission(uuid,text),private.current_write_org_admin(uuid),private.current_write_unit_document(uuid,uuid) from public,anon,authenticated;

-- Preserve function identities, owners, EXECUTE ACLs and every business statement.
-- prosrc hashes cover the actual accepted body, with CRLF normalized, not server
-- pretty-printing. Unknown source fails closed; it is not patched by approximation.
-- The second publisher hash only preserves existing local CALC extensions if present;
-- applying this migration on the hosted baseline does not require or activate CALC.
do $patch$
declare item record;source text;original text;definition text;needle text;guard text;begin
 for item in select * from (values
  ('private.activate_financial_rule(uuid,uuid,integer,integer,uuid,uuid,text)',array['1c0d08cf3aa7a2f74d5ea54c0b78e9a2'],'if not(private.current_write_permission(scope,''publish_rules'')) then raise exception ''Publish forbidden'' using errcode=''42501'';end if;',array['perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||'':''||request_key::text,0));','perform pg_advisory_xact_lock(hashtextextended(scope::text||'':common_repair:POOL'',0));','select * into r from public.allocation_rule_versions v where v.scope_id=scope and v.id=target for update;','select * into b from public.resolutions where id=r.resolution_id and scope_id=scope for update;','perform 1 from public.units u join public.unit_scope_periods p on p.unit_id=u.id and p.scope_id=scope where u.id in(select value::uuid from jsonb_array_elements_text(b.evidence->''unit_ids'')) for share of u,p;','select * into old from public.allocation_rule_versions where id=supersedes and scope_id=scope and status=''active'' for update;']::text[],array['return old.id;','return result;']::text[]),
  ('private.assign_staff_role(uuid,uuid,uuid,text,text[])',array['dda5bdc173a52225e823b2ef39c28b12'],'if not(private.current_write_org_admin(org)) then raise exception ''Forbidden'' using errcode=''42501'';end if;',array['perform pg_advisory_xact_lock(hashtextextended(org::text,0));','select id into result from public.user_roles where membership_id=member and scope_id=scope and role_code=role and valid_to is null for update;']::text[],array['return result;']::text[]),
  ('private.cash_account_operation(uuid,uuid,integer,uuid,jsonb,text,boolean)',array['75e9433c21b9aa71549728fd9a6a9ff4'],'if not(private.current_write_permission(scope,''manage_cash_accounts'')) then raise exception ''cash_account_manage_forbidden'' using errcode=''42501'';end if;',array['perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||'':cash-account:''||request_key::text,0));','perform pg_advisory_xact_lock(hashtextextended(scope::text||'':cash-account-configuration'',0));','select * into old from public.cash_accounts where id=target and scope_id=scope for update;']::text[],array['return receipt.result_id;','return result;']::text[]),
  ('private.classify_fund_movement(uuid,uuid,integer,uuid,jsonb,text)',array['35cbad38c207a194ceb8062e2320f75f'],'if not(private.current_write_permission(scope,''record_payments'') and (expected_revision<=0 or private.current_write_permission(scope,''correct_finance''))) then raise exception ''fund_classify_forbidden'' using errcode=''42501'';end if;',array['perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||'':fund:''||request_key::text,0));','perform pg_advisory_xact_lock(hashtextextended(scope::text||'':charge-publication'',0));','perform pg_advisory_xact_lock(hashtextextended(scope::text||'':cash-account-configuration'',0));','perform pg_advisory_xact_lock(hashtextextended(scope::text||'':fund-configuration'',0));','perform 1 from public.payments where id=(select payment_id from public.money_movements where id=movement and scope_id=scope) for update;','select * into m from public.money_movements where id=movement and scope_id=scope for update;']::text[],array['return receipt.result_id;','return c.id;','return result;']::text[]),
  ('private.create_financial_preview(uuid,jsonb,text,uuid,text)',array['5ce729dcfc6af13ae27452c58e42feaf'],'if not(private.current_write_permission(scope,''prepare_charges'')) then raise exception ''preview_current_rights_changed'' using errcode=''42501'';end if;',array['perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||'':preview:''||request_key::text,0));']::text[],array['return old.id;','return id;']::text[]),
  ('private.expense_operation(uuid,text,uuid,integer,integer,uuid,jsonb,text,uuid,integer,jsonb,date,text)',array['61088f5dd38c9650bab9c20a2fe2220c'],'if not(private.current_write_permission(scope,''record_expenses'') and (not(action in(''reverse'',''replace'') or(action=''save'' and target is not null)) or private.current_write_permission(scope,''correct_finance''))) then raise exception ''expense_current_rights_changed'' using errcode=''42501'';end if;',array['perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||'':expense:''||request_key,0));','perform pg_advisory_xact_lock(hashtextextended(scope::text||'':charge-publication'',0));','perform pg_advisory_xact_lock(hashtextextended(scope::text||'':cash-account-configuration'',0));','perform pg_advisory_xact_lock(hashtextextended(scope::text||'':fund-configuration'',0));','select * into e from public.expenses where id=target and scope_id=scope for update;','select * into e from public.expenses where id=p.expense_id and scope_id=scope for update;','select * into a from public.cash_accounts where id=account_id and scope_id=scope for share;']::text[],array['return receipt.result_id;','return result;']::text[]),
  ('private.fund_operation(uuid,uuid,integer,uuid,jsonb,text,boolean)',array['2f6183710bdede160fdc2a54091946e8'],'if not(private.current_write_permission(scope,''manage_funds'')) then raise exception ''fund_manage_forbidden'' using errcode=''42501'';end if;',array['perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||'':fund:''||request_key::text,0));','perform pg_advisory_xact_lock(hashtextextended(scope::text||'':cash-account-configuration'',0));','perform pg_advisory_xact_lock(hashtextextended(scope::text||'':fund-configuration'',0));','select * into old from public.funds where id=target and scope_id=scope for update;']::text[],array['return receipt.result_id;','return result;']::text[]),
  ('private.inbound_payment_operation(uuid,text,uuid,integer,uuid,jsonb,text,uuid,integer,date,text)',array['7a0a58bb774b94daa85e1712a1a8c99f'],'if not(private.current_write_permission(scope,''record_payments'') and (action not in(''reverse'',''replace'') or private.current_write_permission(scope,''correct_finance''))) then raise exception ''payment_operation_forbidden'' using errcode=''42501'';end if;',array['perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||'':payment:''||request_key::text,0));','perform pg_advisory_xact_lock(hashtextextended(scope::text||'':charge-publication'',0));','perform pg_advisory_xact_lock(hashtextextended(scope::text||'':cash-account-configuration'',0));','select * into p from public.payments where id=target and scope_id=scope for update;','select * into o from public.money_movements where payment_id=p.id and kind=''payment_receipt'' for update;','select * into a from public.cash_accounts where id=account_id and scope_id=scope for share;']::text[],array['return receipt.result_id;','return result;']::text[]),
  ('private.manual_payment_operation(uuid,text,uuid,integer,uuid,jsonb,text)',array['46ac58ac036e5cdb1464ffd1b54fb912'],'if not(private.current_write_permission(scope,''record_payments'')) then raise exception ''payment_operation_forbidden'' using errcode=''42501'';end if;',array[]::text[],array['return private.manual_payment_operation_before_inbound(scope,action,target,expected_revision,request_key,payload,note);']::text[]),
  ('private.manual_payment_operation_before_inbound(uuid,text,uuid,integer,uuid,jsonb,text)',array['7fcfbffe546031e061ed93b2c5b9c580'],'if not(private.current_write_permission(scope,''record_payments'') and (action not in(''reverse'',''replace'') or private.current_write_permission(scope,''correct_finance''))) then raise exception ''payment_operation_forbidden'' using errcode=''42501'';end if;',array['perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||'':payment:''||request_key::text,0));','perform pg_advisory_xact_lock(hashtextextended(scope::text||'':charge-publication'',0));','select * into p from public.payments where id=target and scope_id=scope for update;']::text[],array['return receipt.result_id;','return result;']::text[]),
  ('private.prepare_unit_document(uuid,uuid,text,text,bigint,text,text,uuid)',array['fd625fcaaf425cc35d8410e7702a78ee'],'if not(private.current_write_unit_document(scope,unit)) then raise exception ''document_prepare_forbidden'' using errcode=''42501'';end if;',array['perform pg_advisory_xact_lock(hashtextextended(scope::text||unit::text,0));']::text[],array['return d.id;']::text[]),
  ('private.publish_charge_batch(uuid,uuid,integer,uuid,text)',array['94267ceb8dcdba2388a7c11af90641dd','fbbd13db48910b2141a6021e41812b8b'],'if not(private.current_write_permission(scope,''publish_charges'') and (b.kind is distinct from ''replacement'' or private.current_write_permission(scope,''correct_finance''))) then raise exception ''charge_publish_revoked'' using errcode=''42501'';end if;',array['perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||'':charge:''||request_key::text,0));','perform pg_advisory_xact_lock(hashtextextended(scope::text||'':charge-publication'',0));','select * into b from public.charge_batches where id=target and scope_id=scope for update;','select * into old from public.charge_batches where id=b.replaces_id and scope_id=scope for update;']::text[],array['return receipt.result_id;','return target;']::text[])
 ) as specs(signature,body_hashes,guard_text,locks,exits) loop
  select replace(prosrc,chr(13),'') into original from pg_proc where oid=item.signature::regprocedure;
  if md5(original)<>all(item.body_hashes) then raise exception 'current_write_guard_dependency_changed: %',item.signature;end if;
  source:=replace(original,'private.has_scope_permission(','private.current_write_permission(');
  if item.signature like 'private.assign_staff_role(%' then source:=replace(source,'private.is_org_admin(','private.current_write_org_admin(');end if;
  if item.signature like 'private.prepare_unit_document(%' then source:=replace(source,'private.can_manage_unit_documents(','private.current_write_unit_document(');end if;
  guard:=item.guard_text;
  foreach needle in array item.locks loop
   if position(needle in source)=0 then raise exception 'current_write_guard_lock_missing: %',item.signature;end if;
   source:=replace(source,needle,needle||chr(10)||' '||guard);
  end loop;
  -- All replay/business-repeat/normal returns get the same current authorization.
  -- This also rolls back writes if authority was lost during an implicit FK/trigger
  -- wait. IF expressions preserve the caller's FOUND state after SELECT FOR UPDATE.
  foreach needle in array item.exits loop
   if position(needle in source)=0 then raise exception 'current_write_guard_exit_missing: %',item.signature;end if;
   source:=replace(source,needle,guard||chr(10)||' '||needle);
  end loop;
  definition:=pg_get_functiondef(item.signature::regprocedure);
  -- Normalize only for locating the body; no timestamps or historical data are updated.
  definition:=replace(definition,chr(13),'');
  if position(original in definition)=0 then raise exception 'current_write_guard_body_missing: %',item.signature;end if;
  execute replace(definition,original,source);
 end loop;
end $patch$;
