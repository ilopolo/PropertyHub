-- Unapplied additive migration. Run only after the documented Storage release preflight.
-- No managed-schema DDL: only a dedicated bucket and policies on storage.objects.
do $$ begin
 if to_regprocedure('storage.allow_only_operation(text)') is null then
  raise exception 'Storage operation helper required; verify Storage version before applying';
 end if;
 if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relname='objects' and c.relrowsecurity) then
  raise exception 'Managed storage.objects RLS must already be enabled';
 end if;
 if exists(select 1 from storage.buckets where id='unit-private-files') then
  raise exception 'Bucket already exists; reconcile configuration before applying';
 end if;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('unit-private-files','unit-private-files',false,5242880,array['application/pdf']);

insert into public.role_permissions(role_code,permission_code) values('manager','manage_documents');
create function private.guard_document_permission() returns trigger language plpgsql set search_path='' as $$
begin
 if 'manage_documents'=any(new.permissions) and (new.role_code<>'manager' or not 'read_registry'=any(new.permissions)) then
  raise exception 'Document management requires scoped manager and registry read' using errcode='23514';
 end if;
 return new;
end $$;
create trigger guard_document_permission before insert or update on public.user_roles
 for each row execute function private.guard_document_permission();

create table public.documents(
 id uuid primary key default gen_random_uuid(),
 scope_id uuid not null references public.management_units(id),
 unit_id uuid not null references public.units(id),
 bucket_id text not null default 'unit-private-files' check(bucket_id='unit-private-files'),
 storage_path text not null unique,
 original_filename text not null check(length(original_filename) between 5 and 120 and original_filename !~ '[[:cntrl:]/\\]' and lower(right(original_filename,4))='.pdf'),
 mime_type text not null check(mime_type='application/pdf'),
 size_bytes bigint not null check(size_bytes between 1 and 5242880),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 category_code text not null default 'unit_attachment' check(category_code='unit_attachment'),
 visibility text not null default 'staff' check(visibility in ('staff','owners')),
 status text not null default 'pending' check(status in ('pending','ready','removed')),
 uploader_id uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 upload_expires_at timestamptz not null default now()+interval '15 minutes',
 ready_at timestamptz,
 removed_at timestamptz,
 removed_by uuid references public.profiles(id),
 removal_note text,
 bytes_deleted_at timestamptz,
 check(storage_path=scope_id::text||'/'||unit_id::text||'/'||id::text||'.pdf'),
 check((status='pending' and ready_at is null and removed_at is null) or (status='ready' and ready_at is not null and removed_at is null) or
  (status='removed' and removed_at is not null and removed_by is not null and length(btrim(removal_note)) between 1 and 300)),
 check(bytes_deleted_at is null or status='removed')
);
create unique index documents_one_active_unit on public.documents(scope_id,unit_id) where status<>'removed';
alter table public.documents enable row level security;
revoke all on public.documents from public,anon,authenticated;
grant select on public.documents to authenticated;

create function private.can_manage_unit_documents(scope uuid,unit uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_scope_permission(scope,'manage_documents') and private.has_scope_permission(scope,'read_registry')
 and exists(select 1 from public.unit_scope_periods up join public.units u on u.id=up.unit_id and u.archived_at is null
 where up.scope_id=scope and up.unit_id=unit and daterange(up.valid_from,up.valid_to,'[)') @> (now() at time zone 'Europe/Sofia')::date)
$$;
create function private.can_read_unit_document(document uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.documents d where d.id=document and d.status='ready' and (
 private.can_manage_unit_documents(d.scope_id,d.unit_id) or (d.visibility='owners' and exists(
 select 1 from private.my_owned_units() u where u.scope_id=d.scope_id and u.unit_id=d.unit_id))))
$$;
create policy document_staff_read on public.documents for select to authenticated
 using(private.can_manage_unit_documents(scope_id,unit_id));

create function private.prepare_unit_document(scope uuid,unit uuid,filename text,mime text,bytes bigint,digest text,audience text,request_key uuid)
 returns uuid language plpgsql security definer set search_path='' as $$
declare d public.documents;
begin
 if not private.can_manage_unit_documents(scope,unit) then raise exception 'Forbidden' using errcode='42501'; end if;
 if request_key is null or audience is null then raise exception 'Document fields required' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(scope::text||unit::text,0));
 select * into d from public.documents where id=request_key;
 if found then
  if d.scope_id<>scope or d.unit_id<>unit or d.uploader_id<>private.actor() or d.original_filename<>filename or d.mime_type<>mime
   or d.size_bytes<>bytes or d.sha256<>digest or d.visibility<>audience or d.status='removed' or d.upload_expires_at<=now() then
   raise exception 'Request differs or is closed' using errcode='23514';
  end if;
  return d.id;
 end if;
 insert into public.documents(id,scope_id,unit_id,storage_path,original_filename,mime_type,size_bytes,sha256,visibility,uploader_id)
 values(request_key,scope,unit,scope::text||'/'||unit::text||'/'||request_key::text||'.pdf',filename,mime,bytes,digest,audience,private.actor()) returning * into d;
 insert into public.audit_events(actor_profile_id,action,target_kind,target_id,scope_id,safe_delta)
 values(private.actor(),'document.prepared','document',d.id,scope,jsonb_build_object('visibility',audience));
 return d.id;
end $$;
create function public.prepare_unit_document(scope uuid,unit uuid,filename text,mime text,bytes bigint,digest text,audience text,request_key uuid)
 returns uuid language sql security invoker set search_path='' as $$select private.prepare_unit_document(scope,unit,filename,mime,bytes,digest,audience,request_key)$$;

create function private.complete_unit_document(document uuid) returns void language plpgsql security definer set search_path='' as $$
declare d public.documents;
begin
 select * into d from public.documents where id=document for update;
 if d.id is null or not private.can_manage_unit_documents(d.scope_id,d.unit_id) or d.uploader_id<>private.actor() then raise exception 'Forbidden' using errcode='42501'; end if;
 if d.status='ready' then return; end if;
 if d.status<>'pending' or d.upload_expires_at<=now() then raise exception 'Upload closed or expired' using errcode='23514'; end if;
 if not exists(select 1 from storage.objects o where o.bucket_id=d.bucket_id and o.name=d.storage_path
  and o.metadata->>'mimetype'=d.mime_type and (o.metadata->>'size')::bigint=d.size_bytes) then
  raise exception 'Uploaded bytes missing or metadata mismatch' using errcode='23514';
 end if;
 update public.documents set status='ready',ready_at=now() where id=d.id;
 insert into public.audit_events(actor_profile_id,action,target_kind,target_id,scope_id)
 values(private.actor(),'document.ready','document',d.id,d.scope_id);
end $$;
create function public.complete_unit_document(document uuid) returns void language sql security invoker set search_path='' as $$select private.complete_unit_document(document)$$;

create function private.remove_unit_document(document uuid,note text) returns void language plpgsql security definer set search_path='' as $$
declare d public.documents;
begin
 select * into d from public.documents where id=document for update;
 if d.id is null or not private.can_manage_unit_documents(d.scope_id,d.unit_id) then raise exception 'Forbidden' using errcode='42501'; end if;
 if note is null or length(btrim(note)) not between 1 and 300 then raise exception 'Removal reason required' using errcode='23514'; end if;
 if d.status='removed' then return; end if;
 update public.documents set status='removed',removed_at=now(),removed_by=private.actor(),removal_note=btrim(note) where id=d.id;
 insert into public.audit_events(actor_profile_id,action,target_kind,target_id,scope_id,safe_delta)
 values(private.actor(),'document.removed','document',d.id,d.scope_id,jsonb_build_object('reason',btrim(note)));
end $$;
create function public.remove_unit_document(document uuid,note text) returns void language sql security invoker set search_path='' as $$select private.remove_unit_document(document,note)$$;

create function private.finish_unit_document_removal(document uuid) returns void language plpgsql security definer set search_path='' as $$
declare d public.documents;
begin
 select * into d from public.documents where id=document for update;
 if d.id is null or not private.can_manage_unit_documents(d.scope_id,d.unit_id) then raise exception 'Forbidden' using errcode='42501'; end if;
 if d.status<>'removed' or exists(select 1 from storage.objects where bucket_id=d.bucket_id and name=d.storage_path) then
  raise exception 'Storage API removal required' using errcode='23514'; end if;
 if d.bytes_deleted_at is not null then return; end if;
 update public.documents set bytes_deleted_at=now() where id=d.id;
 insert into public.audit_events(actor_profile_id,action,target_kind,target_id,scope_id)
 values(private.actor(),'document.bytes_deleted','document',d.id,d.scope_id);
end $$;
create function public.finish_unit_document_removal(document uuid) returns void language sql security invoker set search_path='' as $$select private.finish_unit_document_removal(document)$$;

create function private.unit_documents(scope uuid,unit uuid) returns table(id uuid,scope_id uuid,unit_id uuid,storage_path text,original_filename text,mime_type text,size_bytes bigint,sha256 text,visibility text,status text,upload_expires_at timestamptz,bytes_deleted_at timestamptz)
 language sql stable security definer set search_path='' as $$
 select d.id,d.scope_id,d.unit_id,d.storage_path,d.original_filename,d.mime_type,d.size_bytes,d.sha256,d.visibility,d.status,d.upload_expires_at,d.bytes_deleted_at
 from public.documents d where d.scope_id=scope and d.unit_id=unit
 and (private.can_manage_unit_documents(scope,unit) or private.can_read_unit_document(d.id)) order by d.created_at desc,d.id
$$;
create function public.unit_documents(scope uuid,unit uuid) returns table(id uuid,scope_id uuid,unit_id uuid,storage_path text,original_filename text,mime_type text,size_bytes bigint,sha256 text,visibility text,status text,upload_expires_at timestamptz,bytes_deleted_at timestamptz)
 language sql stable security invoker set search_path='' as $$select * from private.unit_documents(scope,unit)$$;

create function private.unit_file_storage_access(path text,operation text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.documents d where d.storage_path=path and (
 (operation='upload' and d.status='pending' and d.upload_expires_at>now() and d.uploader_id=private.actor() and private.can_manage_unit_documents(d.scope_id,d.unit_id)) or
 (operation='read' and (private.can_read_unit_document(d.id) or (d.status='pending' and d.upload_expires_at>now() and d.uploader_id=private.actor() and private.can_manage_unit_documents(d.scope_id,d.unit_id)))) or
 (operation='delete' and d.status='removed' and private.can_manage_unit_documents(d.scope_id,d.unit_id))))
$$;
-- Serialize a Storage INSERT with tombstoning/finalization. A late upload cannot appear
-- after a successful removal check without the remover having observed its transaction.
create function private.authorize_unit_file_upload(path text) returns boolean language plpgsql security definer set search_path='' as $$
declare d public.documents;
begin
 select * into d from public.documents where storage_path=path for share;
 return d.id is not null and d.status='pending' and d.upload_expires_at>now() and d.uploader_id=private.actor()
  and private.can_manage_unit_documents(d.scope_id,d.unit_id);
end $$;
-- Operation-specific SELECT prevents issuing signed URLs that would outlive revocation.
create policy unit_file_read on storage.objects for select to authenticated using(
 bucket_id='unit-private-files' and (
 (storage.allow_only_operation('object.get_authenticated') and private.unit_file_storage_access(name,'read')) or
 ((storage.allow_only_operation('object.delete') or storage.allow_only_operation('object.delete_many')) and private.unit_file_storage_access(name,'delete'))));
create policy unit_file_insert on storage.objects for insert to authenticated with check(
 bucket_id='unit-private-files' and storage.allow_only_operation('object.upload') and private.authorize_unit_file_upload(name));
create policy unit_file_delete on storage.objects for delete to authenticated using(
 bucket_id='unit-private-files' and (storage.allow_only_operation('object.delete') or storage.allow_only_operation('object.delete_many')) and private.unit_file_storage_access(name,'delete'));
-- Restrictive guards also contain any pre-existing broad permissive policies.
create policy unit_file_read_guard on storage.objects as restrictive for select to authenticated using(bucket_id<>'unit-private-files' or (
 (storage.allow_only_operation('object.get_authenticated') and private.unit_file_storage_access(name,'read')) or
 ((storage.allow_only_operation('object.delete') or storage.allow_only_operation('object.delete_many')) and private.unit_file_storage_access(name,'delete'))));
create policy unit_file_insert_guard on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'unit-private-files' or (
 storage.allow_only_operation('object.upload') and private.authorize_unit_file_upload(name)));
create policy unit_file_delete_guard on storage.objects as restrictive for delete to authenticated using(bucket_id<>'unit-private-files' or (
 (storage.allow_only_operation('object.delete') or storage.allow_only_operation('object.delete_many')) and private.unit_file_storage_access(name,'delete')));
create policy unit_file_no_update on storage.objects as restrictive for update to authenticated using(bucket_id<>'unit-private-files') with check(bucket_id<>'unit-private-files');
create policy unit_file_no_anon on storage.objects as restrictive for all to anon using(bucket_id<>'unit-private-files') with check(bucket_id<>'unit-private-files');

revoke all on function private.guard_document_permission(),private.can_manage_unit_documents(uuid,uuid),private.can_read_unit_document(uuid),private.unit_file_storage_access(text,text),private.authorize_unit_file_upload(text),
 private.prepare_unit_document(uuid,uuid,text,text,bigint,text,text,uuid),public.prepare_unit_document(uuid,uuid,text,text,bigint,text,text,uuid),
 private.complete_unit_document(uuid),public.complete_unit_document(uuid),private.remove_unit_document(uuid,text),public.remove_unit_document(uuid,text),
 private.finish_unit_document_removal(uuid),public.finish_unit_document_removal(uuid),private.unit_documents(uuid,uuid),public.unit_documents(uuid,uuid) from public,anon,authenticated;
grant execute on function private.can_manage_unit_documents(uuid,uuid),private.unit_file_storage_access(text,text),private.authorize_unit_file_upload(text),
 private.prepare_unit_document(uuid,uuid,text,text,bigint,text,text,uuid),public.prepare_unit_document(uuid,uuid,text,text,bigint,text,text,uuid),
 private.complete_unit_document(uuid),public.complete_unit_document(uuid),private.remove_unit_document(uuid,text),public.remove_unit_document(uuid,text),
 private.finish_unit_document_removal(uuid),public.finish_unit_document_removal(uuid),private.unit_documents(uuid,uuid),public.unit_documents(uuid,uuid) to authenticated;
