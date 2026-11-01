import {fileDigest} from './unit-file.js';
export {fileDigest};
export const TICKET_FILE_BUCKET='ticket-private-files';
export const TICKET_FILE_MAX_BYTES=5242880;
export class TicketFileError extends Error {constructor(message){super(message);this.name='TicketFileError';}}
const types={'application/pdf':/\.pdf$/i,'image/png':/\.png$/i,'image/jpeg':/\.jpe?g$/i};
export function validateTicketFile({name,type,size}){
 if(typeof name!=='string'||[...name].length<5||[...name].length>120||/[\x00-\x1f\x7f/\\]/.test(name))return 'Името трябва да е до 120 знака, без път или контролни знаци.';
 if(!types[type]?.test(name))return 'Избери PNG, JPEG или PDF със съответното разширение.';
 if(!Number.isSafeInteger(size)||size<1||size>TICKET_FILE_MAX_BYTES)return 'Допустим размер: от 1 byte до 5 MiB (5 242 880 bytes).';
 return null;
}
export function ticketSignature(bytes,mime){
 const signature=mime==='application/pdf'?[37,80,68,70,45]:mime==='image/png'?[137,80,78,71,13,10,26,10]:mime==='image/jpeg'?[255,216,255]:null;
 return !!signature&&signature.every((b,i)=>bytes[i]===b);
}
export async function assertTicketBytes(blob,document){
 if(blob.size!==Number(document.size_bytes)||await fileDigest(blob)!==document.sha256||!ticketSignature(new Uint8Array(await blob.slice(0,8).arrayBuffer()),document.mime_type))throw new TicketFileError('Размерът, SHA-256 или файловият формат не съвпадат.');
}
