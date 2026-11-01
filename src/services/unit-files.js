import {getClient, unwrap} from './supabase.js';
import {UNIT_FILE_BUCKET, validateUnitFile, fileDigest, assertFileBytes,UnitFileError} from '../domain/unit-file.js';
const rpc = async (name, args) => unwrap(await getClient().rpc(name, args));
async function readUnitFile(id) {
 const blob=unwrap(await getClient().functions.invoke('download-unit-file',{body:{document_id:id}}));
 if (!(blob instanceof Blob)) throw new UnitFileError('Файлът не е достъпен.');
 return blob;
}
export const unitDocuments = (scope, unit) => rpc('unit_documents', {scope, unit});
export async function uploadUnitFile(scope, unit, file, audience='staff', requestKey=crypto.randomUUID()) {
 const invalid = validateUnitFile(file); if (invalid) throw new UnitFileError(invalid);
 if (!['staff','owners'].includes(audience)) throw new UnitFileError('Избери разрешената аудитория.');
 const digest = await fileDigest(file);
 const id = await rpc('prepare_unit_document', {scope, unit, filename:file.name, mime:file.type, bytes:file.size, digest, audience, request_key:requestKey});
 const path = `${scope}/${unit}/${id}.pdf`;
 // Pending metadata survives network failures so an authorized manager can cancel/clean it up.
 unwrap(await getClient().storage.from(UNIT_FILE_BUCKET).upload(path, file, {contentType:file.type, upsert:false, cacheControl:'0'}));
 const uploaded = await readUnitFile(id);
 await assertFileBytes(uploaded, {size_bytes:file.size, sha256:digest});
 await rpc('complete_unit_document', {document:id});
 return id;
}
export async function downloadUnitFile(document) {
 // Only the handler may read bytes; never fall back to Storage URLs/signing.
 const blob = await readUnitFile(document.id);
 await assertFileBytes(blob, document);
 return blob;
}
export async function removeUnitFile(document, note) {
 await rpc('remove_unit_document', {document:document.id, note});
 // Tombstone precedes byte removal: interrupted cleanup never reopens owner access.
 unwrap(await getClient().storage.from(UNIT_FILE_BUCKET).remove([document.storage_path]));
 await rpc('finish_unit_document_removal', {document:document.id});
}
