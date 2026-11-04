-- P2 additive candidate. PR8 category allowlist/history are prerequisites, not duplicated.
alter table public.work_item_events add column created_category_code text,
 add constraint work_item_created_category_snapshot check(created_category_code is null or event_type='created');

create function private.create_ticket(unit uuid,title text,description text,category text) returns uuid
language plpgsql security definer set search_path='' as $$
declare scope uuid; result uuid; actor uuid:=private.actor();
begin
 select u.scope_id into scope from private.my_owned_units() u where u.unit_id=unit;
 if actor is null or scope is null then raise exception 'Current owned unit required' using errcode='42501'; end if;
 if category is null or category='' then raise exception 'Ticket category required' using errcode='23514'; end if;
 if title is null or length(btrim(title)) not between 1 and 160 or description is null or length(btrim(description)) not between 1 and 4000 then
  raise exception 'Invalid ticket content' using errcode='23514'; end if;
 -- Existing PR8 work_items.category_code CHECK is the canonical nine-code whitelist.
 insert into public.work_items(scope_id,unit_id,reporter_profile_id,title,description,category_code)
 values(scope,unit,actor,btrim(title),btrim(description),category) returning id into result;
 insert into public.work_item_events(scope_id,item_id,event_type,to_status,actor_profile_id,revision,created_category_code)
 values(scope,result,'created','new',actor,1,category);
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,safe_delta)
 values(scope,actor,'create_ticket','work_item',result,jsonb_build_object('category_code',category,'revision',1));
 return result;
end $$;
create function public.create_ticket(unit uuid,title text,description text,category text) returns uuid
language sql security invoker set search_path='' as $$select private.create_ticket(unit,title,description,category)$$;

-- Close the old category-less write path. Historical rows are neither changed nor backfilled.
create or replace function private.create_ticket(unit uuid,title text,description text) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 if private.actor() is null or not exists(select 1 from private.my_owned_units() u where u.unit_id=unit) then
  raise exception 'Current owned unit required' using errcode='42501'; end if;
 raise exception 'Ticket category required; update client' using errcode='23514';
end $$;

create function private.ticket_contexts() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('scope_id',s.id,'scope_label',s.label) order by s.label,s.id),'[]')
 from public.management_units s where private.can_manage_tickets(s.id)
$$;
create function public.ticket_contexts() returns jsonb language sql stable security invoker set search_path='' as $$select private.ticket_contexts()$$;
revoke all on function private.create_ticket(uuid,text,text,text),public.create_ticket(uuid,text,text,text),
 private.ticket_contexts(),public.ticket_contexts() from public,anon,authenticated;
grant execute on function private.create_ticket(uuid,text,text,text),public.create_ticket(uuid,text,text,text),
 private.ticket_contexts(),public.ticket_contexts() to authenticated;
