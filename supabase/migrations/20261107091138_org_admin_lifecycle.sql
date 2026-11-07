-- Local candidate only. Depends on current_write_access_guards, never CALC.
-- Normal org-admin lifecycle; recovery and membership/status editors are NOT exposed.
create table private.org_admin_revisions (
 organization_id uuid primary key references public.organizations, revision bigint not null check(revision>0)
);
create table private.org_admin_operations (
 actor_id uuid not null references public.profiles, request_key uuid not null,
 input jsonb not null, result jsonb not null, primary key(actor_id,request_key)
);
alter table private.org_admin_revisions enable row level security;
alter table private.org_admin_operations enable row level security;
revoke all on private.org_admin_revisions,private.org_admin_operations from public,anon,authenticated;
create trigger org_admin_operations_immutable before update or delete on private.org_admin_operations
 for each row execute function private.immutable_financial_preview();

create function private.org_admin_member(org uuid,member uuid) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare result uuid; t timestamptz:=clock_timestamp();begin
 select m.profile_id into result from public.organization_memberships m
 join public.organizations o on o.id=m.organization_id
 join public.profiles p on p.id=m.profile_id join auth.users u on u.id=p.auth_user_id
 where m.id=member and m.organization_id=org and m.status='active' and o.status='active'
 and p.status='active' and u.email_confirmed_at is not null and not u.is_anonymous
 and m.valid_from<=t and(m.valid_to is null or t<m.valid_to);
 return result;
end $$;

-- Dedicated authority mutex: staff assignment keeps its existing different lock.
-- Row-trigger callers use TRY, so a row lock never waits for the authority mutex.
create function private.lock_org_admin(org uuid,try_only boolean default false) returns void
language plpgsql volatile security definer set search_path='' as $$begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'current_write_isolation_unsupported' using errcode='42501';end if;
 if try_only then
  if not pg_try_advisory_xact_lock(hashtextextended('org-admin-authority:'||org::text,0)) then
   raise exception 'org_admin_authority_busy' using errcode='PT409';end if;
 else perform pg_advisory_xact_lock(hashtextextended('org-admin-authority:'||org::text,0));end if;
end $$;

create function private.org_admin_affected(tab text,old_row jsonb,new_row jsonb) returns uuid[]
language plpgsql volatile security definer set search_path='' as $$
declare ids uuid[];begin
 if tab='organizations' then
  if old_row is not null and new_row is not null and old_row->'status'=new_row->'status' then return '{}';end if;
  select array_agg(distinct x::uuid) into ids from unnest(array[old_row->>'id',new_row->>'id']) x where x is not null;
 elsif tab='user_roles' then
  select array_agg(distinct m.organization_id) into ids from public.organization_memberships m
  where m.id in(select (x->>'membership_id')::uuid from unnest(array[old_row,new_row]) x where x->>'role_code'='org_admin');
 elsif tab='organization_memberships' then
  if old_row is not null and new_row is not null and (old_row-'status'-'valid_from'-'valid_to')=(new_row-'status'-'valid_from'-'valid_to')
    and old_row->'status'=new_row->'status' and old_row->'valid_from'=new_row->'valid_from' and old_row->'valid_to'=new_row->'valid_to' then return '{}';end if;
  select array_agg(distinct (x->>'organization_id')::uuid) into ids from unnest(array[old_row,new_row]) x
  where exists(select 1 from public.user_roles r where r.membership_id=(x->>'id')::uuid and r.role_code='org_admin');
 elsif tab='profiles' then
  if old_row is not null and new_row is not null and old_row->'status'=new_row->'status' and old_row->'auth_user_id'=new_row->'auth_user_id' then return '{}';end if;
  select array_agg(distinct m.organization_id) into ids from public.organization_memberships m
  join public.user_roles r on r.membership_id=m.id and r.role_code='org_admin'
  where m.profile_id in(select (x->>'id')::uuid from unnest(array[old_row,new_row]) x);
 end if;
 return coalesce(ids,'{}');
end $$;

create function private.org_admin_touch() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare org uuid;begin
 if tg_table_name='user_roles' then
 if tg_op<>'INSERT' and old.role_code='org_admin' then
  if tg_op='DELETE' or (to_jsonb(old)-'valid_to')<>(to_jsonb(new)-'valid_to')
   or(old.valid_to is not null and(new.valid_to is null or new.valid_to>old.valid_to or old.valid_to<=clock_timestamp())) then
   raise exception 'org_admin_history_immutable' using errcode='23514';end if;
 end if;end if;
 for org in select unnest(private.org_admin_affected(tg_table_name,to_jsonb(old),to_jsonb(new))) order by 1 loop
  perform private.lock_org_admin(org,true);
  insert into private.org_admin_revisions values(org,1) on conflict(organization_id) do update set revision=org_admin_revisions.revision+1;
 end loop;
 return null;
end $$;

create function private.assert_org_admin_continuity(org uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare t timestamptz:=clock_timestamp();n integer;anchor integer;begin
 if not exists(select 1 from public.organizations o where o.id=org and o.status='active') then return;end if;
 select count(distinct r.profile_id),count(distinct r.profile_id) filter(where r.valid_to is null and m.valid_to is null)
 into n,anchor from public.user_roles r join public.organization_memberships m on m.id=r.membership_id
 join public.profiles p on p.id=r.profile_id join auth.users u on u.id=p.auth_user_id
 where m.organization_id=org and m.status='active' and p.status='active' and u.email_confirmed_at is not null and not u.is_anonymous
 and r.role_code='org_admin' and 'manage_members'=any(r.permissions)
 and r.valid_from<=t and(r.valid_to is null or t<r.valid_to) and m.valid_from<=t and(m.valid_to is null or t<m.valid_to);
 if n=0 then raise exception 'org_admin_last_required' using errcode='PT409';end if;
 if anchor=0 then raise exception 'org_admin_permanent_required' using errcode='PT409';end if;
end $$;
create function private.org_admin_continuity() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare org uuid;begin
 for org in select unnest(private.org_admin_affected(tg_table_name,to_jsonb(old),to_jsonb(new))) order by 1 loop
  perform private.assert_org_admin_continuity(org);
 end loop;return null;
end $$;
-- Deferred final-state check permits atomic handover/onboarding without an empty final org.
-- There is no new client UPDATE/DELETE grant on any authority table.
do $$declare tab text;begin
 foreach tab in array array['organizations','organization_memberships','profiles','user_roles'] loop
  execute format('create trigger org_admin_authority_touch after insert or update or delete on public.%I for each row execute function private.org_admin_touch()',tab);
  execute format('create constraint trigger org_admin_continuity after insert or update or delete on public.%I deferrable initially deferred for each row execute function private.org_admin_continuity()',tab);
 end loop;
end $$;

create function private.org_admin_directory(org uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb; t timestamptz:=clock_timestamp();begin
 if not private.current_write_org_admin(org) then raise exception 'Forbidden' using errcode='42501';end if;
 select jsonb_build_object('organization_id',org,'revision',coalesce((select revision from private.org_admin_revisions where organization_id=org),0),
 'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'label',p.display_name) order by p.display_name,m.id)
  from public.organization_memberships m join public.profiles p on p.id=m.profile_id
  where m.organization_id=org and private.org_admin_member(org,m.id) is not null),'[]'::jsonb),
 'grants',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'membership_id',m.id,'label',p.display_name,
  'self',r.profile_id=private.actor(),'valid_from',r.valid_from,'valid_to',r.valid_to,'current',
  r.valid_from<=t and(r.valid_to is null or t<r.valid_to) and private.org_admin_member(org,m.id) is not null) order by r.valid_from,r.id)
  from public.user_roles r join public.organization_memberships m on m.id=r.membership_id join public.profiles p on p.id=r.profile_id
  where m.organization_id=org and r.role_code='org_admin'),'[]'::jsonb),
 'history',coalesce((select jsonb_agg(jsonb_build_object('at',e.happened_at,'reason',e.reason,'change',e.safe_delta) order by e.happened_at,e.id)
  from public.audit_events e where e.organization_id=org and e.action='org_admin_lifecycle'),'[]'::jsonb)) into result;
 if not private.current_write_org_admin(org) then raise exception 'Forbidden' using errcode='42501';end if;
 return result;
end $$;

create function private.org_admin_operation(org uuid,request_key uuid,operation text,target_role_id uuid,
 target_membership_id uuid,expected_revision bigint,ends_at timestamptz,reason text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;target uuid;old_role public.user_roles;input jsonb;saved private.org_admin_operations;new_id uuid;
 revision_now bigint;result jsonb;self_end boolean:=false;ended_at timestamptz;begin
 if not private.current_write_org_admin(org) then raise exception 'Forbidden' using errcode='42501';end if;
 actor:=private.actor();
 if request_key is null or expected_revision is null or expected_revision<0 or reason is null or length(btrim(reason)) not between 1 and 300
  or operation is null or operation not in('grant','end','handover')
  or(operation='grant' and(target_role_id is not null or target_membership_id is null))
  or(operation='end' and(target_role_id is null or target_membership_id is not null or ends_at is not null))
  or(operation='handover' and(target_role_id is null or target_membership_id is null)) then
  raise exception 'org_admin_input_invalid' using errcode='22023';end if;
 input:=jsonb_build_object('org',org,'operation',operation,'target_role_id',target_role_id,'target_membership_id',target_membership_id,
  'expected_revision',expected_revision,'ends_at',ends_at,'reason',reason);
 -- Request mutex is independent of organization scope, so a key cannot cross-org race.
 perform pg_advisory_xact_lock(hashtextextended(actor::text||request_key::text||':org-admin-request',0));
 if not private.current_write_org_admin(org) then raise exception 'Forbidden' using errcode='42501';end if;
 perform private.lock_org_admin(org);
 if not private.current_write_org_admin(org) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into saved from private.org_admin_operations x where x.actor_id=actor and x.request_key=org_admin_operation.request_key;
 if found then
  if saved.input<>input then raise exception 'org_admin_request_mismatch' using errcode='PT409';end if;
  return saved.result;
 end if;
 select coalesce((select revision from private.org_admin_revisions where organization_id=org),0) into revision_now;
 if revision_now<>expected_revision then raise exception 'org_admin_stale' using errcode='PT409';end if;
 if operation in('end','handover') then
  select r.* into old_role from public.user_roles r join public.organization_memberships m on m.id=r.membership_id
   where r.id=target_role_id and r.role_code='org_admin' and m.organization_id=org for update of r;
  if not private.current_write_org_admin(org) then raise exception 'Forbidden' using errcode='42501';end if;
  if old_role.id is null then raise exception 'Forbidden' using errcode='42501';end if;
  if old_role.valid_from>clock_timestamp() or(old_role.valid_to is not null and old_role.valid_to<=clock_timestamp()) then
   raise exception 'org_admin_not_current' using errcode='PT409';end if;
  self_end:=old_role.profile_id=actor and 'manage_members'=any(old_role.permissions);
 end if;
 if operation in('grant','handover') then
  target:=private.org_admin_member(org,target_membership_id);
  if target is null then raise exception 'Forbidden' using errcode='42501';end if;
  if target=actor then raise exception 'org_admin_self_grant_forbidden' using errcode='42501';end if;
  if ends_at is not null and ends_at<=clock_timestamp() then raise exception 'org_admin_term_invalid' using errcode='22023';end if;
  if exists(select 1 from public.user_roles r where r.profile_id=target and r.membership_id=target_membership_id
   and r.role_code='org_admin' and(r.valid_to is null or clock_timestamp()<r.valid_to)) then
   raise exception 'org_admin_already_active' using errcode='PT409';end if;
  insert into public.user_roles(profile_id,membership_id,role_code,permissions,valid_from,valid_to)
   values(target,target_membership_id,'org_admin',array['manage_members'],clock_timestamp(),ends_at) returning id into new_id;
 end if;
 if not private.current_write_org_admin(org) then raise exception 'Forbidden' using errcode='42501';end if;
 if operation in('end','handover') then
  ended_at:=clock_timestamp();update public.user_roles set valid_to=ended_at where id=old_role.id;
 end if;
 perform private.assert_org_admin_continuity(org);
 -- Intentional self-end is allowed only for the verified exact original grant;
 -- membership/profile/Auth must remain eligible and another administrator must remain.
 if not private.current_write_org_admin(org) and not coalesce(self_end and private.org_admin_member(org,old_role.membership_id)=actor,false) then
  raise exception 'Forbidden' using errcode='42501';end if;
 select revision into revision_now from private.org_admin_revisions where organization_id=org;
 result:=jsonb_build_object('operation',operation,'new_role_id',new_id,'ended_role_id',old_role.id,'ended_at',ended_at,'revision',revision_now);
 insert into public.audit_events(organization_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta)
  values(org,actor,'org_admin_lifecycle','user_role',coalesce(new_id,old_role.id),btrim(reason),
   result||jsonb_build_object('previous_role',case when old_role.id is null then null else to_jsonb(old_role) end,
    'actor_label',(select p.display_name from public.profiles p where p.id=actor),
    'from_label',(select p.display_name from public.profiles p where p.id=old_role.profile_id),
    'to_label',(select p.display_name from public.profiles p where p.id=target)));
 insert into private.org_admin_operations values(actor,request_key,input,result);
 if operation in('grant','handover') and not coalesce(private.org_admin_member(org,target_membership_id)=target,false) then
  raise exception 'Forbidden' using errcode='42501';end if;
 if not private.current_write_org_admin(org) and not coalesce(self_end and private.org_admin_member(org,old_role.membership_id)=actor,false) then
  raise exception 'Forbidden' using errcode='42501';end if;
 return result;
end $$;
create function public.org_admin_directory(org uuid) returns jsonb language sql security invoker set search_path='' as $$select private.org_admin_directory(org)$$;
create function public.org_admin_operation(org uuid,request_key uuid,operation text,target_role_id uuid,target_membership_id uuid,
 expected_revision bigint,ends_at timestamptz,reason text) returns jsonb language sql security invoker set search_path='' as $$
 select private.org_admin_operation(org,request_key,operation,target_role_id,target_membership_id,expected_revision,ends_at,reason)$$;

revoke all on function private.org_admin_member(uuid,uuid),private.lock_org_admin(uuid,boolean),private.org_admin_affected(text,jsonb,jsonb),
 private.org_admin_touch(),private.assert_org_admin_continuity(uuid),private.org_admin_continuity(),private.org_admin_directory(uuid),
 private.org_admin_operation(uuid,uuid,text,uuid,uuid,bigint,timestamptz,text),public.org_admin_directory(uuid),
 public.org_admin_operation(uuid,uuid,text,uuid,uuid,bigint,timestamptz,text) from public,anon,authenticated;
grant execute on function private.org_admin_directory(uuid),private.org_admin_operation(uuid,uuid,text,uuid,uuid,bigint,timestamptz,text),
 public.org_admin_directory(uuid),public.org_admin_operation(uuid,uuid,text,uuid,uuid,bigint,timestamptz,text) to authenticated;
