-- Local candidate only. Additive; no hosted changes in this package.
insert into public.role_permissions(role_code,permission_code) values('manager','manage_tickets');
create function private.can_manage_tickets(scope uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.has_scope_permission(scope,'manage_tickets'),false)
$$;

create table public.work_items(
 id uuid primary key default gen_random_uuid(), scope_id uuid not null references public.management_units,
 kind text not null default 'ticket' check(kind='ticket'), unit_id uuid not null references public.units,
 reporter_profile_id uuid not null references public.profiles,
 title text not null check(length(btrim(title)) between 1 and 160),
 description text not null check(length(btrim(description)) between 1 and 4000),
 status text not null default 'new' check(status in ('new','accepted','in_progress','completed')),
 revision integer not null default 1 check(revision>0), created_at timestamptz not null default now(),
 completed_on date, unique(scope_id,id),
 check((status='completed')=(completed_on is not null))
);
create index work_items_scope_idx on public.work_items(scope_id,created_at,id);
create index work_items_reporter_idx on public.work_items(reporter_profile_id,unit_id);
create index work_items_unit_idx on public.work_items(unit_id);
create table public.work_item_events(
 id uuid primary key default gen_random_uuid(), scope_id uuid not null,
 item_id uuid not null, event_type text not null check(event_type in ('created','status_changed')),
 visibility text not null default 'reporter' check(visibility='reporter'),
 body text check(length(btrim(body)) between 1 and 1000), from_status text, to_status text not null,
 actor_profile_id uuid not null references public.profiles, revision integer not null,
 created_at timestamptz not null default now(),
 foreign key(scope_id,item_id) references public.work_items(scope_id,id), unique(item_id,revision)
);
create index work_item_events_actor_idx on public.work_item_events(actor_profile_id);
alter table public.work_items enable row level security;
alter table public.work_item_events enable row level security;
revoke all on public.work_items,public.work_item_events from public,anon,authenticated;
grant select on public.work_items,public.work_item_events to authenticated;

create function private.can_read_ticket(scope uuid,unit uuid,reporter uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.can_manage_tickets(scope) or
 (reporter=private.actor() and exists(select 1 from private.my_owned_units() u where u.scope_id=scope and u.unit_id=unit))
$$;
create policy ticket_read on public.work_items for select to authenticated using(private.can_read_ticket(scope_id,unit_id,reporter_profile_id));
create policy ticket_event_read on public.work_item_events for select to authenticated using(exists(
 select 1 from public.work_items w where w.id=item_id and w.scope_id=work_item_events.scope_id
));

create function private.create_ticket(unit uuid,title text,description text) returns uuid language plpgsql security definer set search_path='' as $$
declare scope uuid; result uuid; actor uuid:=private.actor();
begin
 select u.scope_id into scope from private.my_owned_units() u where u.unit_id=unit;
 if actor is null or scope is null then raise exception 'Current owned unit required' using errcode='42501'; end if;
 if title is null or length(btrim(title)) not between 1 and 160 or description is null or length(btrim(description)) not between 1 and 4000 then
  raise exception 'Invalid ticket content' using errcode='23514'; end if;
 insert into public.work_items(scope_id,unit_id,reporter_profile_id,title,description)
 values(scope,unit,actor,btrim(title),btrim(description)) returning id into result;
 insert into public.work_item_events(scope_id,item_id,event_type,to_status,actor_profile_id,revision)
 values(scope,result,'created','new',actor,1);
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id)
 values(scope,actor,'create_ticket','work_item',result);
 return result;
end $$;
create function public.create_ticket(unit uuid,title text,description text) returns uuid language sql security invoker set search_path='' as $$select private.create_ticket(unit,title,description)$$;

create function private.change_ticket_status(item uuid,expected_revision integer,next_status text,note text) returns void language plpgsql security definer set search_path='' as $$
declare w public.work_items;
begin
 select * into w from public.work_items where id=item for update;
 if not found or not private.can_manage_tickets(w.scope_id) then raise exception 'Ticket management forbidden' using errcode='42501'; end if;
 if expected_revision is distinct from w.revision then raise exception 'Ticket changed; reload' using errcode='40001'; end if;
 if next_status is null or not ((w.status='new' and next_status='accepted') or (w.status='accepted' and next_status='in_progress')
  or (w.status='in_progress' and next_status='completed') or (w.status='completed' and next_status='in_progress'))
 then raise exception 'Invalid status transition' using errcode='23514'; end if;
 if note is null or length(btrim(note)) not between 1 and 1000 then raise exception 'Transition reason/result required' using errcode='23514'; end if;
 update public.work_items set status=next_status,revision=revision+1,
  completed_on=case when next_status='completed' then (now() at time zone 'Europe/Sofia')::date end where id=w.id;
 insert into public.work_item_events(scope_id,item_id,event_type,body,from_status,to_status,actor_profile_id,revision)
 values(w.scope_id,w.id,'status_changed',btrim(note),w.status,next_status,private.actor(),w.revision+1);
 insert into public.audit_events(scope_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta)
 values(w.scope_id,private.actor(),'change_ticket_status','work_item',w.id,btrim(note),jsonb_build_object('from',w.status,'to',next_status,'revision',w.revision+1));
end $$;
create function public.change_ticket_status(item uuid,expected_revision integer,next_status text,note text) returns void language sql security invoker set search_path='' as $$select private.change_ticket_status(item,expected_revision,next_status,note)$$;

create function private.ticket_feed() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(w)||jsonb_build_object('scope_label',s.label,'unit_number',u.unit_number,'can_manage',private.can_manage_tickets(w.scope_id),'events',
  (select coalesce(jsonb_agg(to_jsonb(e) order by e.revision),'[]') from public.work_item_events e where e.item_id=w.id and e.visibility='reporter'))
  order by w.created_at desc,w.id),'[]') from public.work_items w join public.management_units s on s.id=w.scope_id join public.units u on u.id=w.unit_id where private.can_read_ticket(w.scope_id,w.unit_id,w.reporter_profile_id)
$$;
create function public.ticket_feed() returns jsonb language sql stable security invoker set search_path='' as $$select private.ticket_feed()$$;

create function private.guard_ticket_event_history() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Ticket history is append only' using errcode='42501'; end$$;
create trigger guard_ticket_event_history before update or delete on public.work_item_events for each row execute function private.guard_ticket_event_history();
revoke all on function private.guard_ticket_event_history() from public,anon,authenticated;
revoke all on function private.can_manage_tickets(uuid),private.can_read_ticket(uuid,uuid,uuid),private.create_ticket(uuid,text,text),public.create_ticket(uuid,text,text),private.change_ticket_status(uuid,integer,text,text),public.change_ticket_status(uuid,integer,text,text),private.ticket_feed(),public.ticket_feed() from public,anon,authenticated;
grant execute on function private.can_manage_tickets(uuid),private.can_read_ticket(uuid,uuid,uuid),private.create_ticket(uuid,text,text),public.create_ticket(uuid,text,text),private.change_ticket_status(uuid,integer,text,text),public.change_ticket_status(uuid,integer,text,text),private.ticket_feed(),public.ticket_feed() to authenticated;
