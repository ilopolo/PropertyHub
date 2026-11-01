import {createPrivateDownloadHandler,refuseDownload} from '../_shared/private-file-download.js';
export {boundedBytes} from '../_shared/private-file-download.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES={'application/pdf':['pdf',/\.pdf$/i],'image/png':['png',/\.png$/i],'image/jpeg':['jpg',/\.jpe?g$/i]};
function checkedDocument(d,id){
 if(!d)refuseDownload(404);
 const type=TYPES[d.mime_type];
 if(d.id!==id||!UUID.test(d.scope_id)||!UUID.test(d.item_id)||d.bucket_id!=='ticket-private-files'||!type
  ||d.storage_path!==`${d.scope_id}/${d.item_id}/${id}.${type[0]}`||!['pending','ready'].includes(d.status)
  ||!/^[0-9a-f]{64}$/.test(d.sha256)||!Number.isSafeInteger(Number(d.size_bytes))||Number(d.size_bytes)<1||Number(d.size_bytes)>5242880
  ||typeof d.original_filename!=='string'||[...d.original_filename].length>120||/[\x00-\x1f\x7f/\\]/.test(d.original_filename)||!type[1].test(d.original_filename))refuseDownload(502);
 return d;
}
export function validSignature(bytes,mime){
 const signature=mime==='application/pdf'?[37,80,68,70,45]:mime==='image/png'?[137,80,78,71,13,10,26,10]:mime==='image/jpeg'?[255,216,255]:null;
 return !!signature&&signature.every((b,i)=>bytes[i]===b);
}
export const createDownloadHandler=deps=>createPrivateDownloadHandler({...deps,checkedDocument,validateBytes:validSignature,
 fields:['id','scope_id','item_id','bucket_id','storage_path','original_filename','mime_type','size_bytes','sha256','status'],
 responseType:()=> 'application/octet-stream',fallback:'attachment.bin'});
