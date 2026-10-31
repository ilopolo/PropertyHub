import {getClient, unwrap} from './supabase.js';
import {UNIT_FILE_BUCKET, validateUnitFile, fileDigest, assertFileBytes,UnitFileError} from '../domain/unit-file.js';
const rpc = async (name, args) => unwrap(await getClient().rpc(name, args));
export const unitDocuments = (scope, unit) => rpc('unit_documents', {scope, unit});
export async function uploadUnitFile(scope, unit, file, audience='staff', requestKey=crypto.randomUUID()) {
 const invalid = validateUnitFile(file); if (invalid) throw new UnitFileError(invalid);
 if (!['staff','owners'].includes(audience)) throw new UnitFileError('Избери разрешената аудитория.');
 const digest = await fileDigest(file);
 const id = await rpc('prepare_unit_document', {scope, unit, filename:file.name, mime:file.type, bytes:file.size, digest, audience, request_key:requestKey});
 const path = `${scope}/${unit}/${id}.pdf`;
 // Pending metadata survives network failures so an authorized manager can cancel/clean it up.
 unwrap(await getClient().storage.from(UNIT_FILE_BUCKET).upload(path, file, {contentType:file.type, upsert:false, cacheControl:'0'}));
 const uploaded = unwrap(await getClient().storage.from(UNIT_FILE_BUCKET).download(path, {}, {cache:'no-store'}));
 await assertFileBytes(uploaded, {size_bytes:file.size, sha256:digest});
 await rpc('complete_unit_document', {document:id});
 return id;
}
export async function downloadUnitFile(document) {
 // Fresh authenticated request every time; never create public/signed URLs.
 const blob = unwrap(await getClient().storage.from(UNIT_FILE_BUCKET).download(document.storage_path, {}, {cache:'no-store'}));
 await assertFileBytes(blob, document);
 return blob;
}
export async function removeUnitFile(document, note) {
 await rpc('remove_unit_document', {document:document.id, note});
 // Tombstone precedes byte removal: interrupted cleanup never reopens owner access.
 unwrap(await getClient().storage.from(UNIT_FILE_BUCKET).remove([document.storage_path]));
 await rpc('finish_unit_document_removal', {document:document.id});
}
