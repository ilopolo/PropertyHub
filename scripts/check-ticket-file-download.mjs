import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {createDownloadHandler} from '../supabase/functions/download-ticket-file/handler.js';
import {validateTicketFile,assertTicketBytes,TicketFileError} from '../src/domain/ticket-file.js';
const checks=[],id=randomUUID(),scope=randomUUID(),item=randomUUID(),user={id:randomUUID(),email_confirmed_at:'2026-11-01',is_anonymous:false};
const request=(value={document_id:id},headers={})=>new Request('http://local/download',{method:'POST',headers:{authorization:'Bearer synthetic-unchanged','content-type':'application/json',...headers},body:JSON.stringify(value)});
const samples=[['application/pdf','report.pdf',Buffer.from('%PDF-1.7\nSynthetic\n%%EOF')],['image/png','test.png',Buffer.from([137,80,78,71,13,10,26,10,1,2])],['image/jpeg','test.jpeg',Buffer.from([255,216,255,217])]];
function setup(mime,name,bytes,overrides={}){
 const ext=mime==='application/pdf'?'pdf':mime==='image/png'?'png':'jpg';
 const document={id,scope_id:scope,item_id:item,bucket_id:'ticket-private-files',storage_path:`${scope}/${item}/${id}.${ext}`,original_filename:name,mime_type:mime,size_bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),status:'ready'};
 let authorizations=0,fetches=0;
 const deps={authenticate:async()=>user,authorize:async token=>{assert.equal(token,'synthetic-unchanged');authorizations++;return document;},fetchObject:async d=>{assert.deepEqual(d,document);fetches++;return {body:(async function*(){yield bytes;})(),contentType:mime,contentLength:bytes.length};},...overrides};
 return {handle:createDownloadHandler(deps),document,deps,counts:()=>({authorizations,fetches})};
}
function noCache(r){assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(r.headers.get('cdn-cache-control'),'no-store');assert.equal(r.headers.get('surrogate-control'),'no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.match(r.headers.get('vary'),/Authorization/);}
for(const [mime,name,bytes]of samples){
 assert.equal(validateTicketFile({name,type:mime,size:bytes.length}),null);
 const s=setup(mime,name,bytes),r=await s.handle(request());assert.equal(r.status,200);noCache(r);assert.equal(r.headers.get('content-type'),'application/octet-stream');assert.match(r.headers.get('content-disposition'),/^attachment;/);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);assert.deepEqual(s.counts(),{authorizations:2,fetches:1});
 await assertTicketBytes(new Blob([bytes]),s.document);
}
checks.push('PDF/PNG/JPEG exact bytes/hash/signature, twice same caller, octet-stream Blob and uncached attachment');
for(const input of [{name:'test.pdf',type:'application/pdf',size:0},{name:'test.pdf',type:'application/pdf',size:5242881},{name:'test.png',type:'application/pdf',size:10},{name:'bad/test.pdf',type:'application/pdf',size:10},{name:'x.txt',type:'text/plain',size:10}])assert(validateTicketFile(input));
assert.equal(validateTicketFile({name:'test.pdf',type:'application/pdf',size:5242880}),null);
const [mime,name,bytes]=samples[0];
for(const identity of [null,{...user,is_anonymous:true},{...user,email_confirmed_at:null}]){const s=setup(mime,name,bytes,{authenticate:async()=>identity}),r=await s.handle(request());assert.equal(r.status,401);noCache(r);assert.equal(s.counts().fetches,0);}
for(const reason of ['foreign','role-revoked','link-revoked']){let n=0;const s=setup(mime,name,bytes);const handle=createDownloadHandler({...s.deps,authorize:async()=>++n===(reason==='foreign'?1:2)?null:s.document});const r=await handle(request());assert.equal(r.status,404);noCache(r);assert.equal(s.counts().fetches,reason==='foreign'?0:1);}
checks.push('invalid/anonymous/unconfirmed; foreign document; role/link revoke between both current authorizations');
for(const mutation of [d=>({...d,bucket_id:'unit-private-files'}),d=>({...d,item_id:randomUUID()}),d=>({...d,storage_path:'arbitrary/path'}),d=>({...d,original_filename:'injected\r\n.pdf'}),d=>({...d,sha256:'f'.repeat(64)}),d=>({...d,size_bytes:bytes.length+1})]){
 const s=setup(mime,name,bytes);const r=await createDownloadHandler({...s.deps,authorize:async()=>mutation(s.document)})(request());assert.equal(r.status,502);noCache(r);
}
for(const fetchObject of [async()=>{throw Error('S3 unavailable');},async()=>({body:(async function*(){yield Buffer.alloc(bytes.length);})(),contentType:mime,contentLength:bytes.length})]){const s=setup(mime,name,bytes,{fetchObject}),r=await s.handle(request());assert.equal(r.status,502);noCache(r);}
const falseMagic=Buffer.from('not a PDF'),bad=setup(mime,name,falseMagic);assert.equal((await bad.handle(request())).status,502);
for(const extra of [{document_id:id,path:'foreign'},{document_id:randomUUID(),bucket:'foreign'}])assert.equal((await setup(mime,name,bytes).handle(request(extra))).status,400);
const safe=setup(mime,'Отчет "пример".pdf',bytes),response=await safe.handle(request());assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/%22/);
await assert.rejects(assertTicketBytes(new Blob([bytes]),{...safe.document,sha256:'0'.repeat(64)}),TicketFileError);
checks.push('immutable target/no path input; metadata/size/hash/magic mismatch; S3 failure; safe UTF-8 name; domain rejection');
await mkdir('.local/ticket-attachment-qa',{recursive:true});await writeFile('.local/ticket-attachment-qa/download.json',JSON.stringify({pass:true,hosted:false,runtime:'dependency-injected Edge handler, local bytes; no S3/CDN proof',checks},null,2));console.log('PASS ticket download/domain:',checks.length,'groups');
