-- Storage 1.80.2/CDN authenticates byte downloads through an object-info preflight.
-- Same exact document predicate; no signing/listing/copy/public access is added.
alter policy unit_file_read on storage.objects using(
 bucket_id='unit-private-files' and (
 ((storage.allow_only_operation('object.get_authenticated') or storage.allow_only_operation('object.get_authenticated_info') or storage.allow_only_operation('object.head_authenticated_info')) and private.unit_file_storage_access(name,'read')) or
 ((storage.allow_only_operation('object.delete') or storage.allow_only_operation('object.delete_many')) and private.unit_file_storage_access(name,'delete'))));
alter policy unit_file_read_guard on storage.objects using(bucket_id<>'unit-private-files' or (
 ((storage.allow_only_operation('object.get_authenticated') or storage.allow_only_operation('object.get_authenticated_info') or storage.allow_only_operation('object.head_authenticated_info')) and private.unit_file_storage_access(name,'read')) or
 ((storage.allow_only_operation('object.delete') or storage.allow_only_operation('object.delete_many')) and private.unit_file_storage_access(name,'delete'))));
