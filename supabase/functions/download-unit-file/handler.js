// Transport-independent boundary. No credentials, shared user state, URLs or cache.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 5242880;
const ORIGINS = new Set(['https://propertyhub-ilopolo.netlify.app','http://127.0.0.1:5173','http://127.0.0.1:4173']);
const FIELDS = ['id','scope_id','unit_id','bucket_id','storage_path','original_filename','mime_type','size_bytes','sha256','status'];
class Refusal extends Error { constructor(status) { super('Download unavailable'); this.status=status; } }
const fail = status => { throw new Refusal(status); };
export async function boundedBytes(body, limit, signal) {
 if (!body?.[Symbol.asyncIterator]) fail(502);
 const chunks=[]; let size=0;
 const iterator=body[Symbol.asyncIterator](); let completed=false;
 let abort;
 const cancelled=new Promise((_,reject)=>{abort=()=>reject(new Refusal(503));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});
 try { while (true) {
  const next=await Promise.race([iterator.next(),cancelled]); if(next.done){completed=true;break;} const chunk=next.value;
  if (!(chunk instanceof Uint8Array)) fail(502);
  size+=chunk.byteLength; if (size>limit) fail(502);
  chunks.push(chunk);
 } } finally {signal?.removeEventListener('abort',abort);if(!completed)Promise.resolve(iterator.return?.()).catch(()=>{});}
 const bytes=new Uint8Array(size); let offset=0;
 for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.byteLength; }
 return bytes;
}
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
function filenameHeader(name) {
 // Fixed ASCII fallback; UTF-8 name is percent-encoded, never a raw header value.
 const encoded=encodeURIComponent(name.replace(/[\u202a-\u202e\u2066-\u2069]/g,''))
  .replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
 return `attachment; filename="document.pdf"; filename*=UTF-8''${encoded}`;
}
export function createDownloadHandler({authenticate,authorize,fetchObject}) {
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
   if (origin && !ORIGINS.has(origin)) fail(403);
   if (request.method==='OPTIONS') return new Response(null,{status:204,headers});
   if (request.method!=='POST') fail(405);
   if (request.headers.has('range') || request.headers.get('content-type')?.split(';')[0]!=='application/json') fail(400);
   const authorization=request.headers.get('authorization')||'';
   if (!/^Bearer [^\s]+$/i.test(authorization)) fail(401);
   let input;
   try { input=JSON.parse(new TextDecoder().decode(await boundedBytes(request.body,256,controller.signal))); } catch { fail(controller.signal.aborted?503:400); }
   if (!input || Array.isArray(input) || Object.keys(input).length!==1 || !UUID.test(input.document_id)) fail(400);
   const token=authorization.slice(7), caller=await authenticate(token,controller.signal);
   if (!caller || !UUID.test(caller.id) || caller.is_anonymous!==false || !caller.email_confirmed_at) fail(401);
   const d=checkedDocument(await authorize(token,input.document_id,controller.signal),input.document_id);
   const object=await fetchObject(d,controller.signal);
   if (object.contentType!=='application/pdf' || Number(object.contentLength)!==Number(d.size_bytes)) fail(502);
   const bytes=await boundedBytes(object.body,Number(d.size_bytes),controller.signal);
   if (bytes.length!==Number(d.size_bytes)) fail(502);
   const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
   if (digest!==d.sha256) fail(502);
   const current=checkedDocument(await authorize(token,input.document_id,controller.signal),input.document_id);
   if (!FIELDS.every(key=>String(current[key])===String(d[key]))) fail(404);
   if (controller.signal.aborted) fail(503);
   headers.set('Content-Type','application/pdf'); headers.set('Content-Length',String(bytes.length));
   headers.set('Content-Disposition',filenameHeader(d.original_filename));
   return new Response(bytes,{status:200,headers});
  } catch (error) {
   return errorResponse(error instanceof Refusal ? error.status : controller.signal.aborted ? 503 : 502);
  } finally { clearTimeout(timer); request.signal.removeEventListener('abort',cancel); }
 };
}
