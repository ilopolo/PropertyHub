import {createPrivateDownloadHandler,refuseDownload as fail} from '../_shared/private-file-download.js';
export {boundedBytes} from '../_shared/private-file-download.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 5242880;
const FIELDS = ['id','scope_id','unit_id','bucket_id','storage_path','original_filename','mime_type','size_bytes','sha256','status'];
function checkedDocument(d, id) {
 if (!d) fail(404);
 if (d.id!==id || !UUID.test(d.scope_id) || !UUID.test(d.unit_id) || d.bucket_id!=='unit-private-files'
  || d.storage_path!==`${d.scope_id}/${d.unit_id}/${d.id}.pdf` || d.mime_type!=='application/pdf'
  || !['pending','ready'].includes(d.status) || !/^[0-9a-f]{64}$/.test(d.sha256)
  || !Number.isSafeInteger(Number(d.size_bytes)) || Number(d.size_bytes)<1 || Number(d.size_bytes)>MAX_BYTES
  || typeof d.original_filename!=='string' || [...d.original_filename].length>120
  || /[\x00-\x1f\x7f/\\]/.test(d.original_filename) || !/\.pdf$/i.test(d.original_filename)) fail(502);
 return d;
}

export const createDownloadHandler=deps=>createPrivateDownloadHandler({...deps,checkedDocument,fields:FIELDS,fallback:'document.pdf'});
