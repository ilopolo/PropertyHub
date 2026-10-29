alter table public.access_requests drop constraint access_requests_status_check;
alter table public.access_requests drop constraint access_requests_check;
alter table public.access_requests add column review_note text check(length(btrim(review_note)) between 1 and 300);
alter table public.access_requests add check(status in ('pending','fulfilled','rejected','revoked'));
alter table public.access_requests add check(
 (status='pending' and reviewed_by is null and reviewed_at is null and organization_id is null and review_note is null)
 or (status in ('rejected','revoked') and reviewed_by is not null and reviewed_at is not null and organization_id is null and review_note is not null)
 or (status='fulfilled' and reviewed_by is not null and reviewed_at is not null and organization_id is not null));
grant select(review_note,reviewed_at) on public.access_requests to authenticated;

create function private.audit_request_creation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_events(actor_profile_id,action,target_kind,target_id) values(private.actor(),'request_organization','access_request',new.id);
 return new;
end $$;
create trigger audit_request_creation after insert on public.access_requests for each row execute function private.audit_request_creation();

create function private.revise_organization_request(request_id uuid,expected_revision integer,name text,organization_kind text) returns void language plpgsql security definer set search_path='' as $$
declare req public.access_requests;
begin
 select * into req from public.access_requests where id=request_id for update;
 if not found or req.requester_profile_id is distinct from private.actor() then raise exception 'Forbidden' using errcode='42501'; end if;
 if req.status<>'pending' or req.revision is distinct from expected_revision then raise exception 'Request changed' using errcode='23514'; end if;
 update public.access_requests set request_payload=jsonb_build_object('name',btrim(name),'organization_kind',organization_kind),revision=revision+1 where id=request_id;
 insert into public.audit_events(actor_profile_id,action,target_kind,target_id) values(private.actor(),'revise_organization_request','access_request',request_id);
end $$;
create function public.revise_organization_request(request_id uuid,expected_revision integer,name text,organization_kind text) returns void language sql security invoker set search_path='' as $$select private.revise_organization_request(request_id,expected_revision,name,organization_kind)$$;

create function private.close_organization_request(request_id uuid,expected_revision integer,decision text,note text) returns void language plpgsql security definer set search_path='' as $$
declare req public.access_requests;
begin
 select * into req from public.access_requests where id=request_id for update;
 if not found or not coalesce((decision='revoked' and req.requester_profile_id=private.actor()) or (decision='rejected' and private.is_platform_admin()),false) then raise exception 'Forbidden' using errcode='42501'; end if;
 if req.status<>'pending' or req.revision is distinct from expected_revision then raise exception 'Request changed' using errcode='23514'; end if;
 if note is null or length(btrim(note)) not between 1 and 300 then raise exception 'Reason required' using errcode='23514'; end if;
 update public.access_requests set status=decision,reviewed_by=private.actor(),reviewed_at=now(),review_note=btrim(note),revision=revision+1 where id=request_id;
 insert into public.audit_events(actor_profile_id,action,target_kind,target_id,reason) values(private.actor(),'close_organization_request','access_request',request_id,btrim(note));
end $$;
create function public.close_organization_request(request_id uuid,expected_revision integer,decision text,note text) returns void language sql security invoker set search_path='' as $$select private.close_organization_request(request_id,expected_revision,decision,note)$$;

drop function public.activate_organization(uuid);
revoke all on function private.activate_organization(uuid) from public,anon,authenticated;
create function private.activate_reviewed_organization(request_id uuid,expected_revision integer,review_note text) returns uuid language plpgsql security definer set search_path='' as $$
declare req public.access_requests; org uuid;
begin
 if not private.is_platform_admin() then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into req from public.access_requests where id=request_id for update;
 if not found then raise exception 'Request unavailable' using errcode='42501'; end if;
 if review_note is null or length(btrim(review_note)) not between 1 and 300 then raise exception 'Review note required' using errcode='23514'; end if;
 if req.status='fulfilled' and req.revision=expected_revision+1 and req.review_note=btrim(review_note) then return req.organization_id; end if;
 if req.status<>'pending' or req.revision is distinct from expected_revision then raise exception 'Request changed' using errcode='23514'; end if;
 org:=private.activate_organization(request_id);
 update public.access_requests set review_note=btrim(activate_reviewed_organization.review_note) where id=request_id;
 insert into public.audit_events(organization_id,actor_profile_id,action,target_kind,target_id,reason,safe_delta)
 values(org,private.actor(),'review_organization_request','access_request',request_id,btrim(review_note),jsonb_build_object('reviewed_revision',expected_revision));
 return org;
end $$;
create function public.activate_organization(request_id uuid,expected_revision integer,review_note text) returns uuid language sql security invoker set search_path='' as $$select private.activate_reviewed_organization(request_id,expected_revision,review_note)$$;

revoke all on function private.audit_request_creation(),private.revise_organization_request(uuid,integer,text,text),private.close_organization_request(uuid,integer,text,text),private.activate_reviewed_organization(uuid,integer,text) from public,anon,authenticated;
grant execute on function private.revise_organization_request(uuid,integer,text,text),private.close_organization_request(uuid,integer,text,text),private.activate_reviewed_organization(uuid,integer,text) to authenticated;
revoke all on function public.revise_organization_request(uuid,integer,text,text),public.close_organization_request(uuid,integer,text,text),public.activate_organization(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.revise_organization_request(uuid,integer,text,text),public.close_organization_request(uuid,integer,text,text),public.activate_organization(uuid,integer,text) to authenticated;
