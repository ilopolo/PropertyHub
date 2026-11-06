-- P1 read-only personal projection. No financial writers, role inheritance or base-table grants.
create function private.owner_finance_identities() returns table(scope_id uuid,person_id uuid)
language sql stable security invoker set search_path='' as $$
 select distinct l.scope_id,l.person_id
 from public.account_person_links l
 join public.persons p on p.id=l.person_id and p.scope_id=l.scope_id
  and p.revision=l.person_revision and p.status='active' and p.verification_status='verified'
 join public.profiles pr on pr.id=l.profile_id and pr.status='active'
 join auth.users u on u.id=pr.auth_user_id and u.email_confirmed_at is not null and not u.is_anonymous
 where pr.auth_user_id=(select auth.uid()) and l.revoked_at is null
 and exists(select 1 from auth.sessions s where s.id::text=(select auth.jwt()->>'session_id') and s.user_id=u.id)
$$;

create function private.my_financial_access() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.owner_finance_identities())
$$;

create function private.my_financial_history(unit_filter uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare items jsonb;totals jsonb;
begin
 if not exists(select 1 from private.owner_finance_identities()) then
  raise exception 'owner_finance_identity_required' using errcode='42501';
 end if;
 with identities as materialized(select * from private.owner_finance_identities()),
 own as materialized(
  select p.id,p.person_id,p.scope_id,p.assessed_amount,p.liability_date,
   c.id charge_id,c.unit_id,c.unit_snapshot->>'unit_number' unit_label,c.amount unit_amount,c.due_date,c.reversal_of_id,
   b.id batch_id,b.kind,b.replaces_id,b.reverses_id,b.period_start,b.period_end,b.published_at,
   case when b.kind='reversal' then 'reversal'
    when exists(select 1 from public.charge_batches r where r.reverses_id=b.id and r.status='published') then 'superseded'
    else 'current' end item_status,
   coalesce((select sum(a.amount) from public.payment_allocations a where a.obligation_party_id=p.id and a.scope_id=p.scope_id),0)::numeric(18,2) covered
  from public.obligation_parties p join identities i on i.scope_id=p.scope_id and i.person_id=p.person_id
  join public.charges c on c.id=p.charge_id and c.scope_id=p.scope_id
  join public.charge_batches b on b.id=c.batch_id and b.scope_id=c.scope_id and b.status='published'
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',o.id,'unit_id',o.unit_id,'unit_label',o.unit_label,
  'liability_date',o.liability_date,'due_date',o.due_date,'published_at',o.published_at,
  'period_start',o.period_start,'period_end',o.period_end,'status',o.item_status,
  'assessed_amount',o.assessed_amount::text,'unit_amount',o.unit_amount::text,'covered_amount',o.covered::text,
  'remaining_amount',case when o.item_status='current' and o.assessed_amount>=o.covered and o.covered>=0
    then (o.assessed_amount-o.covered)::numeric(18,2)::text else null end,
  'related_item_id',(select q.id from own q where q.unit_id=o.unit_id and q.person_id=o.person_id and q.scope_id=o.scope_id
    and(case when o.kind='reversal' then q.charge_id=o.reversal_of_id
      when o.kind='replacement' then q.batch_id=o.replaces_id
      else q.replaces_id=o.batch_id and q.kind='replacement' end) order by q.published_at,q.id limit 1),
  'coverage',(select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'amount',a.amount::text,'payment_date',p.payment_date,'recorded_at',a.recorded_at,
    'compensation_date',m.movement_date,'reversal_of_id',a.reversal_of_id,
    'basis_code',case when a.amount<0 then 'coverage_reversal' else 'manual_coverage' end
   ) order by a.recorded_at,a.id),'[]')
   from public.payment_allocations a join public.payments p on p.id=a.payment_id and p.scope_id=a.scope_id
   left join public.money_movements m on m.payment_id=a.reversal_payment_id and m.scope_id=a.scope_id
   where a.obligation_party_id=o.id and a.scope_id=o.scope_id)
 ) order by o.published_at desc,o.unit_id,o.id),'[]') into items from own o;
 if exists(select 1 from jsonb_array_elements(items) x where x->>'status'='current' and x->>'remaining_amount' is null) then
  raise exception 'owner_finance_data_inconsistent' using errcode='23514';
 end if;
 if unit_filter is not null then
  if not exists(select 1 from jsonb_array_elements(items) x where x->>'unit_id'=unit_filter::text) then
   raise exception 'owner_finance_filter_forbidden' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(x),'[]') into items from jsonb_array_elements(items) x where x->>'unit_id'=unit_filter::text;
 end if;
 select jsonb_build_object(
  'assessed_amount',coalesce(sum((x->>'assessed_amount')::numeric),0)::numeric(18,2)::text,
  'covered_amount',coalesce(sum((x->>'covered_amount')::numeric),0)::numeric(18,2)::text,
  'remaining_amount',coalesce(sum((x->>'remaining_amount')::numeric),0)::numeric(18,2)::text
 ) into totals from jsonb_array_elements(items) x where x->>'status'='current';
 return jsonb_build_object('schema_version','owner-finances-v1','currency','EUR','items',items,'totals',totals);
end $$;

create function public.my_financial_access() returns boolean language sql stable security invoker set search_path='' as $$select private.my_financial_access()$$;
create function public.my_financial_history(unit_filter uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$select private.my_financial_history(unit_filter)$$;
revoke all on function private.owner_finance_identities(),private.my_financial_access(),private.my_financial_history(uuid),
 public.my_financial_access(),public.my_financial_history(uuid) from public,anon,authenticated;
grant execute on function private.my_financial_access(),private.my_financial_history(uuid),
 public.my_financial_access(),public.my_financial_history(uuid) to authenticated;
