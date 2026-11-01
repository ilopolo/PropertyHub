-- Additive handler-only read boundary. Do not edit/reapply earlier migrations.
-- auth.sessions is only read by this guarded helper; no managed-schema/grant changes.
create function private.authorize_unit_file_download(document_id uuid)
returns table(id uuid,scope_id uuid,unit_id uuid,bucket_id text,storage_path text,
 original_filename text,mime_type text,size_bytes bigint,sha256 text,status text)
language plpgsql stable security definer set search_path='' as $$
declare session_claim text := auth.jwt()->>'session_id'; actor_id uuid := private.actor();
begin
 if actor_id is null or session_claim is null or session_claim !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 then return; end if;
 if not exists(select 1 from auth.sessions s where s.id=session_claim::uuid and s.user_id=auth.uid())
 then return; end if;
 return query select d.id,d.scope_id,d.unit_id,d.bucket_id,d.storage_path,
 d.original_filename,d.mime_type,d.size_bytes,d.sha256,d.status
 from public.documents d where d.id=document_id and (
 private.can_read_unit_document(d.id) or
 (d.status='pending' and d.uploader_id=actor_id and d.upload_expires_at>now()
 and private.can_manage_unit_documents(d.scope_id,d.unit_id)));
end $$;
create function public.authorize_unit_file_download(document_id uuid)
returns table(id uuid,scope_id uuid,unit_id uuid,bucket_id text,storage_path text,
 original_filename text,mime_type text,size_bytes bigint,sha256 text,status text)
language sql stable security invoker set search_path='' as $$
 select * from private.authorize_unit_file_download(document_id)
$$;
revoke all on function private.authorize_unit_file_download(uuid),public.authorize_unit_file_download(uuid) from public,anon,authenticated;
grant execute on function private.authorize_unit_file_download(uuid),public.authorize_unit_file_download(uuid) to authenticated;

-- No direct read/sign/copy/S3 read for clients. Keep SELECT solely for Storage removal.
alter policy unit_file_read on storage.objects using(
 bucket_id='unit-private-files' and
 (storage.allow_only_operation('object.delete') or storage.allow_only_operation('object.delete_many'))
 and private.unit_file_storage_access(name,'delete'));
alter policy unit_file_read_guard on storage.objects using(bucket_id<>'unit-private-files' or (
 (storage.allow_only_operation('object.delete') or storage.allow_only_operation('object.delete_many'))
 and private.unit_file_storage_access(name,'delete')));
