-- Local candidate: ticket-only target, independent of unit-document permissions.
do $$ begin
 if to_regprocedure('storage.allow_only_operation(text)') is null or not exists(
  select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='storage' and c.relname='objects' and c.relrowsecurity) then
  raise exception 'Managed Storage operation helper/RLS required';
 end if;
 if exists(select 1 from storage.buckets where id='ticket-private-files') then
  raise exception 'Bucket already exists; reconcile before apply';
 end if;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('ticket-private-files','ticket-private-files',false,5242880,array['application/pdf','image/png','image/jpeg']);

create table public.ticket_attachments(
 id uuid primary key,
 scope_id uuid not null,
 item_id uuid not null,
 foreign key(scope_id,item_id) references public.work_items(scope_id,id),
 bucket_id text not null default 'ticket-private-files' check(bucket_id='ticket-private-files'),
 storage_path text not null unique,
 original_filename text not null check(length(original_filename) between 5 and 120 and original_filename !~ '[[:cntrl:]/\\]'),
 mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg')),
 size_bytes bigint not null check(size_bytes between 1 and 5242880),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 uploader_id uuid not null references public.profiles(id),
 status text not null default 'pending' check(status in ('pending','ready','removed')),
 created_at timestamptz not null default now(),
 upload_expires_at timestamptz not null default now()+interval '15 minutes',
 ready_at timestamptz,
 removed_at timestamptz,
 removed_by uuid references public.profiles(id),
 removal_note text,
 bytes_deleted_at timestamptz,
 check((mime_type='application/pdf' and lower(original_filename) ~ '\.pdf$') or
       (mime_type='image/png' and lower(original_filename) ~ '\.png$') or
       (mime_type='image/jpeg' and lower(original_filename) ~ '\.jpe?g$')),
 check(storage_path=scope_id::text||'/'||item_id::text||'/'||id::text||
  case mime_type when 'application/pdf' then '.pdf' when 'image/png' then '.png' else '.jpg' end),
 check((status='pending' and ready_at is null and removed_at is null) or
       (status='ready' and ready_at is not null and removed_at is null) or
       (status='removed' and removed_at is not null and removed_by is not null and length(btrim(removal_note)) between 1 and 300)),
 check(bytes_deleted_at is null or status='removed')
);
create unique index ticket_attachment_one_active on public.ticket_attachments(scope_id,item_id) where status<>'removed';
create index ticket_attachment_item on public.ticket_attachments(scope_id,item_id);
create index ticket_attachment_uploader on public.ticket_attachments(uploader_id);
create index ticket_attachment_remover on public.ticket_attachments(removed_by);
alter table public.ticket_attachments enable row level security;
revoke all on public.ticket_attachments from public,anon,authenticated;
grant select on public.ticket_attachments to authenticated;

create function private.can_access_ticket_file(item uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.work_items w where w.id=item and w.kind='ticket'
 and private.can_read_ticket(w.scope_id,w.unit_id,w.reporter_profile_id))
$$;
create function private.can_remove_ticket_file(item uuid,uploader uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.work_items w where w.id=item and w.kind='ticket'
 and private.can_read_ticket(w.scope_id,w.unit_id,w.reporter_profile_id)
 and (private.can_manage_tickets(w.scope_id) or (w.reporter_profile_id=private.actor() and uploader=private.actor())))
$$;
create policy ticket_attachment_read on public.ticket_attachments for select to authenticated using(private.can_access_ticket_file(item_id));

create function private.guard_ticket_attachment() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Attachment history is retained' using errcode='42501'; end if;
 if (to_jsonb(new)-array['status','ready_at','removed_at','removed_by','removal_note','bytes_deleted_at'])
  is distinct from (to_jsonb(old)-array['status','ready_at','removed_at','removed_by','removal_note','bytes_deleted_at'])
  or (old.status='removed' and new.status<>'removed') or (old.status='ready' and new.status='pending') then
  raise exception 'Immutable attachment identity/lifecycle' using errcode='42501';
 end if;
 return new;
end $$;
create trigger guard_ticket_attachment before update or delete on public.ticket_attachments for each row execute function private.guard_ticket_attachment();

create function private.prepare_ticket_attachment(item uuid,filename text,mime text,bytes bigint,digest text,request_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.ticket_attachments; w public.work_items;
begin
 select * into w from public.work_items where id=item for update;
 if w.id is null or not private.can_access_ticket_file(item) then raise exception 'Forbidden' using errcode='42501'; end if;
 if request_key is null then raise exception 'Request key required' using errcode='23514'; end if;
 select * into d from public.ticket_attachments where id=request_key;
 if found then
  if d.item_id<>item or d.uploader_id<>private.actor() or d.original_filename is distinct from filename or d.mime_type is distinct from mime
   or d.size_bytes is distinct from bytes or d.sha256 is distinct from digest or d.status<>'pending' or d.upload_expires_at<=now() then
   raise exception 'Request differs or closed' using errcode='23514';
  end if;
  return to_jsonb(d);
 end if;
 insert into public.ticket_attachments(id,scope_id,item_id,storage_path,original_filename,mime_type,size_bytes,sha256,uploader_id)
 values(request_key,w.scope_id,item,w.scope_id::text||'/'||item::text||'/'||request_key::text||
 case mime when 'application/pdf' then '.pdf' when 'image/png' then '.png' else '.jpg' end,filename,mime,bytes,digest,private.actor()) returning * into d;
 insert into public.audit_events(actor_profile_id,action,target_kind,target_id,scope_id)
 values(private.actor(),'ticket_attachment.prepared','ticket_attachment',d.id,d.scope_id);
 return to_jsonb(d);
end $$;
create function public.prepare_ticket_attachment(item uuid,filename text,mime text,bytes bigint,digest text,request_key uuid)
returns jsonb language sql security invoker set search_path='' as $$select private.prepare_ticket_attachment(item,filename,mime,bytes,digest,request_key)$$;

create function private.complete_ticket_attachment(document uuid) returns void language plpgsql security definer set search_path='' as $$
declare d public.ticket_attachments;
begin
 select * into d from public.ticket_attachments where id=document for update;
 if d.id is null or not private.can_access_ticket_file(d.item_id) or d.uploader_id<>private.actor() then raise exception 'Forbidden' using errcode='42501'; end if;
 if d.status='ready' then return; end if;
 if d.status<>'pending' or d.upload_expires_at<=now() then raise exception 'Upload expired/closed' using errcode='23514'; end if;
 if not exists(select 1 from storage.objects o where o.bucket_id=d.bucket_id and o.name=d.storage_path
  and o.metadata->>'mimetype'=d.mime_type and (o.metadata->>'size')::bigint=d.size_bytes) then
  raise exception 'Uploaded object missing or mismatch' using errcode='23514'; end if;
 update public.ticket_attachments set status='ready',ready_at=now() where id=d.id;
 insert into public.audit_events(actor_profile_id,action,target_kind,target_id,scope_id)
 values(private.actor(),'ticket_attachment.ready','ticket_attachment',d.id,d.scope_id);
end $$;
create function public.complete_ticket_attachment(document uuid) returns void language sql security invoker set search_path='' as $$select private.complete_ticket_attachment(document)$$;

create function private.remove_ticket_attachment(document uuid,note text) returns void language plpgsql security definer set search_path='' as $$
declare d public.ticket_attachments;
begin
 select * into d from public.ticket_attachments where id=document for update;
 if d.id is null or not private.can_remove_ticket_file(d.item_id,d.uploader_id) then raise exception 'Forbidden' using errcode='42501'; end if;
 if note is null or length(btrim(note)) not between 1 and 300 then raise exception 'Removal reason required' using errcode='23514'; end if;
 if d.status='removed' then return; end if;
 update public.ticket_attachments set status='removed',removed_at=now(),removed_by=private.actor(),removal_note=btrim(note) where id=d.id;
 insert into public.audit_events(actor_profile_id,action,target_kind,target_id,scope_id,safe_delta)
 values(private.actor(),'ticket_attachment.removed','ticket_attachment',d.id,d.scope_id,jsonb_build_object('reason',btrim(note)));
end $$;
create function public.remove_ticket_attachment(document uuid,note text) returns void language sql security invoker set search_path='' as $$select private.remove_ticket_attachment(document,note)$$;
create function private.finish_ticket_attachment_removal(document uuid) returns void language plpgsql security definer set search_path='' as $$
declare d public.ticket_attachments;
begin
 select * into d from public.ticket_attachments where id=document for update;
 if d.id is null or not private.can_remove_ticket_file(d.item_id,d.uploader_id) then raise exception 'Forbidden' using errcode='42501'; end if;
 if d.status<>'removed' or exists(select 1 from storage.objects where bucket_id=d.bucket_id and name=d.storage_path) then
  raise exception 'Storage removal required' using errcode='23514'; end if;
 if d.bytes_deleted_at is not null then return; end if;
 update public.ticket_attachments set bytes_deleted_at=now() where id=d.id;
 insert into public.audit_events(actor_profile_id,action,target_kind,target_id,scope_id)
 values(private.actor(),'ticket_attachment.bytes_deleted','ticket_attachment',d.id,d.scope_id);
end $$;
create function public.finish_ticket_attachment_removal(document uuid) returns void language sql security invoker set search_path='' as $$select private.finish_ticket_attachment_removal(document)$$;

create function private.ticket_files(item uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select case when private.can_access_ticket_file(item) then jsonb_build_object(
 'can_upload',not exists(select 1 from public.ticket_attachments where item_id=item and status<>'removed'),
 'files',coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('can_remove',private.can_remove_ticket_file(d.item_id,d.uploader_id)) order by d.created_at,d.id)
 from public.ticket_attachments d where d.item_id=item),'[]'::jsonb)) else null end
$$;
create function public.ticket_files(item uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.ticket_files(item)$$;

create function private.authorize_ticket_file_download(document_id uuid)
returns table(id uuid,scope_id uuid,item_id uuid,bucket_id text,storage_path text,original_filename text,mime_type text,size_bytes bigint,sha256 text,status text)
language plpgsql stable security definer set search_path='' as $$
declare session_claim text:=auth.jwt()->>'session_id'; actor_id uuid:=private.actor();
begin
 if actor_id is null or session_claim is null or session_claim !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return; end if;
 if not exists(select 1 from auth.sessions s where s.id=session_claim::uuid and s.user_id=auth.uid()) then return; end if;
 return query select d.id,d.scope_id,d.item_id,d.bucket_id,d.storage_path,d.original_filename,d.mime_type,d.size_bytes,d.sha256,d.status
 from public.ticket_attachments d where d.id=document_id and private.can_access_ticket_file(d.item_id)
 and (d.status='ready' or (d.status='pending' and d.uploader_id=actor_id and d.upload_expires_at>now()));
end $$;
create function public.authorize_ticket_file_download(document_id uuid)
returns table(id uuid,scope_id uuid,item_id uuid,bucket_id text,storage_path text,original_filename text,mime_type text,size_bytes bigint,sha256 text,status text)
language sql stable security invoker set search_path='' as $$select * from private.authorize_ticket_file_download(document_id)$$;

create function private.authorize_ticket_file_upload(path text) returns boolean language plpgsql security definer set search_path='' as $$
declare d public.ticket_attachments;
begin
 select * into d from public.ticket_attachments where storage_path=path for share;
 return d.id is not null and d.status='pending' and d.upload_expires_at>now() and d.uploader_id=private.actor() and private.can_access_ticket_file(d.item_id);
end $$;
create function private.can_delete_ticket_file(path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ticket_attachments d where d.storage_path=path and d.status='removed' and private.can_remove_ticket_file(d.item_id,d.uploader_id))
$$;
create policy ticket_file_insert on storage.objects for insert to authenticated with check(bucket_id='ticket-private-files' and storage.allow_only_operation('object.upload') and private.authorize_ticket_file_upload(name));
create policy ticket_file_delete on storage.objects for delete to authenticated using(bucket_id='ticket-private-files' and
 (storage.allow_only_operation('object.delete') or storage.allow_only_operation('object.delete_many')) and private.can_delete_ticket_file(name));
create policy ticket_file_delete_select on storage.objects for select to authenticated using(bucket_id='ticket-private-files' and
 (storage.allow_only_operation('object.delete') or storage.allow_only_operation('object.delete_many')) and private.can_delete_ticket_file(name));
create policy ticket_file_insert_guard on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'ticket-private-files' or
 (storage.allow_only_operation('object.upload') and private.authorize_ticket_file_upload(name)));
create policy ticket_file_read_guard on storage.objects as restrictive for select to authenticated using(bucket_id<>'ticket-private-files' or
 ((storage.allow_only_operation('object.delete') or storage.allow_only_operation('object.delete_many')) and private.can_delete_ticket_file(name)));
create policy ticket_file_delete_guard on storage.objects as restrictive for delete to authenticated using(bucket_id<>'ticket-private-files' or
 ((storage.allow_only_operation('object.delete') or storage.allow_only_operation('object.delete_many')) and private.can_delete_ticket_file(name)));
create policy ticket_file_no_update on storage.objects as restrictive for update to authenticated using(bucket_id<>'ticket-private-files') with check(bucket_id<>'ticket-private-files');
create policy ticket_file_no_anon on storage.objects as restrictive for all to anon using(bucket_id<>'ticket-private-files') with check(bucket_id<>'ticket-private-files');

revoke all on function private.guard_ticket_attachment(),private.can_access_ticket_file(uuid),private.can_remove_ticket_file(uuid,uuid),
 private.prepare_ticket_attachment(uuid,text,text,bigint,text,uuid),public.prepare_ticket_attachment(uuid,text,text,bigint,text,uuid),
 private.complete_ticket_attachment(uuid),public.complete_ticket_attachment(uuid),private.remove_ticket_attachment(uuid,text),public.remove_ticket_attachment(uuid,text),
 private.finish_ticket_attachment_removal(uuid),public.finish_ticket_attachment_removal(uuid),private.ticket_files(uuid),public.ticket_files(uuid),
 private.authorize_ticket_file_download(uuid),public.authorize_ticket_file_download(uuid),private.authorize_ticket_file_upload(text),private.can_delete_ticket_file(text) from public,anon,authenticated;
grant execute on function private.can_access_ticket_file(uuid),
 private.prepare_ticket_attachment(uuid,text,text,bigint,text,uuid),public.prepare_ticket_attachment(uuid,text,text,bigint,text,uuid),
 private.complete_ticket_attachment(uuid),public.complete_ticket_attachment(uuid),private.remove_ticket_attachment(uuid,text),public.remove_ticket_attachment(uuid,text),
 private.finish_ticket_attachment_removal(uuid),public.finish_ticket_attachment_removal(uuid),private.ticket_files(uuid),public.ticket_files(uuid),
 private.authorize_ticket_file_download(uuid),public.authorize_ticket_file_download(uuid),private.authorize_ticket_file_upload(text),private.can_delete_ticket_file(text) to authenticated;
