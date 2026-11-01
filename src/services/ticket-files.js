import {getClient,unwrap} from './supabase.js';
import {TICKET_FILE_BUCKET,validateTicketFile,fileDigest,assertTicketBytes,TicketFileError,ticketSignature} from '../domain/ticket-file.js';
const rpc=async(name,args)=>unwrap(await getClient().rpc(name,args));
const read=async id=>{
 const blob=unwrap(await getClient().functions.invoke('download-ticket-file',{body:{document_id:id}}));
 if(!(blob instanceof Blob))throw new TicketFileError('Приложението не е достъпно.');
 return blob;
};
export const ticketFiles=item=>rpc('ticket_files',{item});
export async function uploadTicketFile(item,file,requestKey=crypto.randomUUID()){
 const invalid=validateTicketFile(file);if(invalid)throw new TicketFileError(invalid);
 if(!ticketSignature(new Uint8Array(await file.slice(0,8).arrayBuffer()),file.type))throw new TicketFileError('Форматът на файла не съвпада с избрания тип.');
 const digest=await fileDigest(file);
 const d=await rpc('prepare_ticket_attachment',{item,filename:file.name,mime:file.type,bytes:file.size,digest,request_key:requestKey});
 // The path/scope are server-derived. No caller-supplied Storage target or upsert.
 unwrap(await getClient().storage.from(TICKET_FILE_BUCKET).upload(d.storage_path,file,{contentType:file.type,upsert:false,cacheControl:'0'}));
 await assertTicketBytes(await read(d.id),d);
 await rpc('complete_ticket_attachment',{document:d.id});
 return d.id;
}
export async function downloadTicketFile(d){
 const blob=await read(d.id);await assertTicketBytes(blob,d);return blob;
}
export async function removeTicketFile(d,note){
 await rpc('remove_ticket_attachment',{document:d.id,note});
 unwrap(await getClient().storage.from(TICKET_FILE_BUCKET).remove([d.storage_path]));
 await rpc('finish_ticket_attachment_removal',{document:d.id});
}
