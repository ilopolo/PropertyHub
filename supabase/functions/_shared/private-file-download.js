// Transport-independent boundary. No credentials, shared user state, URLs or cache.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 5242880;
const ORIGINS = new Set(['https://propertyhub-ilopolo.netlify.app','http://127.0.0.1:5173','http://127.0.0.1:4173']);
class Refusal extends Error { constructor(status) { super('Download unavailable'); this.status=status; } }
export const refuseDownload = status => { throw new Refusal(status); };
export async function boundedBytes(body, limit, signal) {
 if (!body?.[Symbol.asyncIterator]) refuseDownload(502);
 const chunks=[]; let size=0;
 const iterator=body[Symbol.asyncIterator](); let completed=false;
 let abort;
 const cancelled=new Promise((_,reject)=>{abort=()=>reject(new Refusal(503));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});
 try { while (true) {
  const next=await Promise.race([iterator.next(),cancelled]); if(next.done){completed=true;break;} const chunk=next.value;
  if (!(chunk instanceof Uint8Array)) refuseDownload(502);
  size+=chunk.byteLength; if (size>limit) refuseDownload(502);
  chunks.push(chunk);
 } } finally {signal?.removeEventListener('abort',abort);if(!completed)Promise.resolve(iterator.return?.()).catch(()=>{});}
 const bytes=new Uint8Array(size); let offset=0;
 for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.byteLength; }
 return bytes;
}
function filenameHeader(name,fallback) {
 // Fixed ASCII fallback; UTF-8 name is percent-encoded, never a raw header value.
 const encoded=encodeURIComponent(name.replace(/[\u202a-\u202e\u2066-\u2069]/g,''))
  .replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
 return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
export function createPrivateDownloadHandler({authenticate,authorize,fetchObject,checkedDocument,fields,validateBytes=()=>true,responseType=d=>d.mime_type,fallback='attachment.bin'}) {
 return async request => {
  const headers=new Headers({'Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store',
   'Surrogate-Control':'no-store','Pragma':'no-cache','Expires':'0','Vary':'Authorization, Origin','X-Content-Type-Options':'nosniff'});
  const origin=request.headers.get('origin');
  if (ORIGINS.has(origin)) {
   headers.set('Access-Control-Allow-Origin',origin);
   headers.set('Access-Control-Allow-Headers','authorization, apikey, content-type, x-client-info');
   headers.set('Access-Control-Allow-Methods','POST, OPTIONS');
  }
  const errorResponse=status=>new Response(JSON.stringify({error:'Download unavailable'}),{status,headers:new Headers([...headers,['Content-Type','application/json']])});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
  const cancel=()=>controller.abort(); request.signal.addEventListener('abort',cancel,{once:true});
  if (request.signal.aborted) controller.abort();
  try {
   if (origin && !ORIGINS.has(origin)) refuseDownload(403);
   if (request.method==='OPTIONS') return new Response(null,{status:204,headers});
   if (request.method!=='POST') refuseDownload(405);
   if (request.headers.has('range') || request.headers.get('content-type')?.split(';')[0]!=='application/json') refuseDownload(400);
   const authorization=request.headers.get('authorization')||'';
   if (!/^Bearer [^\s]+$/i.test(authorization)) refuseDownload(401);
   let input;
   try { input=JSON.parse(new TextDecoder().decode(await boundedBytes(request.body,256,controller.signal))); } catch { refuseDownload(controller.signal.aborted?503:400); }
   if (!input || Array.isArray(input) || Object.keys(input).length!==1 || !UUID.test(input.document_id)) refuseDownload(400);
   const token=authorization.slice(7), caller=await authenticate(token,controller.signal);
   if (!caller || !UUID.test(caller.id) || caller.is_anonymous!==false || !caller.email_confirmed_at) refuseDownload(401);
   const d=checkedDocument(await authorize(token,input.document_id,controller.signal),input.document_id);
   const object=await fetchObject(d,controller.signal);
   if (object.contentType!==d.mime_type || Number(object.contentLength)!==Number(d.size_bytes)) refuseDownload(502);
   const bytes=await boundedBytes(object.body,Number(d.size_bytes),controller.signal);
   if (bytes.length!==Number(d.size_bytes)) refuseDownload(502);
   const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
   if (digest!==d.sha256 || !validateBytes(bytes,d.mime_type)) refuseDownload(502);
   const current=checkedDocument(await authorize(token,input.document_id,controller.signal),input.document_id);
   if (!fields.every(key=>String(current[key])===String(d[key]))) refuseDownload(404);
   if (controller.signal.aborted) refuseDownload(503);
   headers.set('Content-Type',responseType(d)); headers.set('Content-Length',String(bytes.length));
   headers.set('Content-Disposition',filenameHeader(d.original_filename,fallback));
   return new Response(bytes,{status:200,headers});
  } catch (error) {
   return errorResponse(error instanceof Refusal ? error.status : controller.signal.aborted ? 503 : 502);
  } finally { clearTimeout(timer); request.signal.removeEventListener('abort',cancel); }
 };
}
