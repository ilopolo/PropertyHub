-- Local additive candidate. Do not edit/reapply earlier migrations.
alter table public.work_items add column category_code text check(category_code in (
 'common_repairs','elevator','electrical_lighting','plumbing','cleaning_hygiene',
 'access_security','garden_landscaping','administration','other')),
 add column assignee_profile_id uuid references public.profiles(id);
create index work_items_assignee_idx on public.work_items(assignee_profile_id) where assignee_profile_id is not null;
alter table public.work_item_events drop constraint work_item_events_event_type_check;
alter table public.work_item_events add constraint work_item_events_event_type_check
 check(event_type in ('created','status_changed','handling_changed'));
alter table public.work_item_events add column handling_delta jsonb,
 add constraint work_item_handling_delta_check check(
 (event_type='handling_changed' and handling_delta is not null and jsonb_typeof(handling_delta)='object' and handling_delta<>'{}'::jsonb)
 or (event_type<>'handling_changed' and handling_delta is null));

-- Same current scope/role/member/org/management-period guards as has_scope_permission,
-- with explicit recipient Auth identity checks rather than impersonating auth.uid().
create function private.ticket_eligible_staff(scope uuid)
returns table(profile_id uuid,display_name text) language sql stable security definer set search_path='' as $$
 select distinct p.id,nullif(btrim(p.display_name),'') from public.user_roles r
 join public.profiles p on p.id=r.profile_id join auth.users u on u.id=p.auth_user_id
 join public.organization_memberships m on m.id=r.membership_id
 join public.organizations o on o.id=m.organization_id
 join public.management_assignments a on a.organization_id=o.id and a.scope_id=r.scope_id
 join public.management_units s on s.id=a.scope_id
 where r.scope_id=scope and r.role_code='manager' and 'manage_tickets'=any(r.permissions)
 and p.status='active' and u.email_confirmed_at is not null and not u.is_anonymous
 and o.status='active' and m.status='active' and a.status='active' and s.status='active'
 and r.valid_from<=now() and (r.valid_to is null or now()<r.valid_to)
 and m.valid_from<=now() and (m.valid_to is null or now()<m.valid_to)
 and a.valid_from<=current_date and (a.valid_to is null or current_date<a.valid_to)
$$;
create function private.ticket_assignees(item uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare scope uuid;
begin
 select w.scope_id into scope from public.work_items w where w.id=item;
 if scope is null or not private.can_manage_tickets(scope) then raise exception 'Ticket management forbidden' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(x) order by x.display_name nulls last,x.profile_id),'[]'::jsonb) from private.ticket_eligible_staff(scope) x);
end $$;
create function public.ticket_assignees(item uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.ticket_assignees(item)$$;

create function private.update_ticket_handling(item uuid,expected_revision integer,category text,assignee uuid,note text)
returns void language plpgsql security definer set search_path='' as $$
declare w public.work_items; delta jsonb:='{}'; old_name text; new_name text;
begin
 select * into w from public.work_items where id=item for update;
 if not found or not private.can_manage_tickets(w.scope_id) then raise exception 'Ticket management forbidden' using errcode='42501'; end if;
 if expected_revision is distinct from w.revision then raise exception 'Ticket changed; reload' using errcode='PT409'; end if;
 if category is not null and category<>all(array['common_repairs','elevator','electrical_lighting','plumbing','cleaning_hygiene','access_security','garden_landscaping','administration','other']) then
  raise exception 'Unknown ticket category' using errcode='23514'; end if;
 if assignee is not null and not exists(select 1 from private.ticket_eligible_staff(w.scope_id) p where p.profile_id=assignee) then
  raise exception 'Recipient lacks current scoped ticket permission' using errcode='23514'; end if;
 if note is null or length(btrim(note)) not between 1 and 1000 then raise exception 'Change reason required' using errcode='23514'; end if;
 if w.category_code is distinct from category then delta:=delta||jsonb_build_object('category',jsonb_build_object('from',w.category_code,'to',category)); end if;
 if w.assignee_profile_id is distinct from assignee then
  select nullif(btrim(p.display_name),'') into old_name from public.profiles p where p.id=w.assignee_profile_id;
  select nullif(btrim(p.display_name),'') into new_name from public.profiles p where p.id=assignee;
  delta:=delta||jsonb_build_object('assignee',jsonb_build_object('from',w.assignee_profile_id,'to',assignee,'from_name',old_name,'to_name',new_name));
 end if;
 if delta='{}'::jsonb then return; end if;
 update public.work_items set category_code=category,assignee_profile_id=assignee,revision=revision+1 where id=w.id;
 insert into public.work_item_events(scope_id,item_id,event_type,visibility,body,from_status,to_status,actor_profile_id,revision,handling_delta)
 values(w.scope_id,w.id,'handling_changed','reporter',btrim(note),w.status,w.status,private.actor(),w.revision+1,delta);
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta)
 values(w.scope_id,private.actor(),'update_ticket_handling','work_item',w.id,btrim(note),delta||jsonb_build_object('revision',w.revision+1));
end $$;
create function public.update_ticket_handling(item uuid,expected_revision integer,category text,assignee uuid,note text)
returns void language sql security invoker set search_path='' as $$select private.update_ticket_handling(item,expected_revision,category,assignee,note)$$;

create or replace function private.ticket_feed() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(w)||jsonb_build_object('scope_label',s.label,'unit_number',u.unit_number,
 'can_manage',private.can_manage_tickets(w.scope_id),'assignee_name',nullif(btrim(p.display_name),''),
 'assignee_eligible',case when w.assignee_profile_id is not null then exists(select 1 from private.ticket_eligible_staff(w.scope_id) x where x.profile_id=w.assignee_profile_id) end,
 'events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.revision),'[]') from public.work_item_events e where e.item_id=w.id and e.visibility='reporter'))
 order by w.created_at desc,w.id),'[]') from public.work_items w
 join public.management_units s on s.id=w.scope_id join public.units u on u.id=w.unit_id
 left join public.profiles p on p.id=w.assignee_profile_id
 where private.can_read_ticket(w.scope_id,w.unit_id,w.reporter_profile_id)
$$;
revoke all on function private.ticket_eligible_staff(uuid),private.ticket_assignees(uuid),public.ticket_assignees(uuid),
 private.update_ticket_handling(uuid,integer,text,uuid,text),public.update_ticket_handling(uuid,integer,text,uuid,text) from public,anon,authenticated;
grant execute on function private.ticket_assignees(uuid),public.ticket_assignees(uuid),
 private.update_ticket_handling(uuid,integer,text,uuid,text),public.update_ticket_handling(uuid,integer,text,uuid,text) to authenticated;
