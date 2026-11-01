-- Unapplied corrective candidate. PostgREST 14 retries SQLSTATE 40001 indefinitely.
-- Use a domain conflict (HTTP409); preserve authorization, row lock, revision and history.
create or replace function private.change_ticket_status(item uuid,expected_revision integer,next_status text,note text) returns void language plpgsql security definer set search_path='' as $$
declare w public.work_items;
begin
 select * into w from public.work_items where id=item for update;
 if not found or not private.can_manage_tickets(w.scope_id) then raise exception 'Ticket management forbidden' using errcode='42501'; end if;
 if expected_revision is distinct from w.revision then raise exception 'Ticket changed; reload' using errcode='PT409'; end if;
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
