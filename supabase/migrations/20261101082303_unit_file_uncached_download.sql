-- Direct /object/authenticated downloads execute current RLS on every request.
-- Reject CDN metadata preflight: the default /object URL can cache authorization,
-- including across a role/link withdrawal. No client nonce is treated as security.
alter policy unit_file_read on storage.objects using(
 bucket_id='unit-private-files' and (
 (storage.allow_only_operation('object.get_authenticated') and private.unit_file_storage_access(name,'read')) or
 ((storage.allow_only_operation('object.delete') or storage.allow_only_operation('object.delete_many')) and private.unit_file_storage_access(name,'delete'))));
alter policy unit_file_read_guard on storage.objects using(bucket_id<>'unit-private-files' or (
 (storage.allow_only_operation('object.get_authenticated') and private.unit_file_storage_access(name,'read')) or
 ((storage.allow_only_operation('object.delete') or storage.allow_only_operation('object.delete_many')) and private.unit_file_storage_access(name,'delete'))));
