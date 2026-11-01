// Local handler/dependency tests. No env/credentials/network/hosted evidence.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createDownloadHandler} from '../supabase/functions/download-unit-file/handler.js';
const groups=[],bytes=Buffer.from('%PDF-1.4\n% synthetic download boundary\n%%EOF\n');
const hash=b=>createHash('sha256').update(b).digest('hex');
const id=randomUUID(),scope=randomUUID(),unit=randomUUID(),actor=randomUUID();
const document={id,scope_id:scope,unit_id:unit,bucket_id:'unit-private-files',storage_path:`${scope}/${unit}/${id}.pdf`,
 original_filename:'Синтетичен "файл".pdf',mime_type:'application/pdf',size_bytes:bytes.length,sha256:hash(bytes),status:'ready'};
const stream=async function*(value=bytes){yield value;};
const request=(body={document_id:id},headers={},method='POST')=>new Request('http://local/functions/v1/download-unit-file',{
 method,headers:{authorization:'Bearer synthetic-session-only','content-type':'application/json',...headers},
 ...(['GET','OPTIONS'].includes(method)?{}:{body:JSON.stringify(body)})});
function setup(overrides={}){
 const calls={auth:[],rpc:[],s3:[]};
 const handler=createDownloadHandler({authenticate:async(token)=>{calls.auth.push(token);return{id:actor,is_anonymous:false,email_confirmed_at:'2026-01-01'};},
  authorize:async(token,target)=>{calls.rpc.push({token,target});return document;},
  fetchObject:async(d)=>{calls.s3.push(d);return{body:stream(),contentType:'application/pdf',contentLength:bytes.length};},...overrides});
 return {handler,calls};
}
function uncached(r){for(const header of ['cache-control','cdn-cache-control','surrogate-control'])assert.match(r.headers.get(header),/no-store/);assert.equal(r.headers.get('etag'),null);assert.equal(r.headers.get('last-modified'),null);}
const check=async(name,fn)=>{await fn();groups.push(name);console.log('PASS: '+name);};
await check('allowed exact bytes/hash, same caller token twice, safe UTF-8 attachment and no cache',async()=>{
 const {handler,calls}=setup(),r=await handler(request());assert.equal(r.status,200);uncached(r);
 assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);assert.equal(calls.rpc.length,2);assert.deepEqual(calls.rpc[0],calls.rpc[1]);
 assert.equal(calls.s3[0].storage_path,document.storage_path);assert.match(r.headers.get('content-disposition'),/^attachment; filename="document.pdf"; filename\*=UTF-8''%/);
 assert.equal(r.headers.get('content-disposition').includes('"файл"'),false);
});
await check('invalid/anonymous/unconfirmed identity and unauthorized ID never fetch S3',async()=>{
 for(const identity of [null,{id:actor,is_anonymous:true,email_confirmed_at:'yes'},{id:actor,is_anonymous:false}]){
  const {handler,calls}=setup({authenticate:async()=>identity});const r=await handler(request());assert.equal(r.status,401);uncached(r);assert.equal(calls.s3.length,0);
 }
 const {handler,calls}=setup({authorize:async()=>null});assert.equal((await handler(request())).status,404);assert.equal(calls.s3.length,0);
});
await check('role and owner-link revocation between authorizations deny bytes with same token',async()=>{
 for(const reason of ['role','link']){let n=0;const tokens=[];const {handler}=setup({authorize:async(token)=>{tokens.push(token);return ++n===1?document:null;}});
  const r=await handler(request());assert.equal(r.status,404,reason);uncached(r);assert.deepEqual(tokens,['synthetic-session-only','synthetic-session-only']);assert.equal((await r.text()).includes('%PDF'),false);
 }
});
await check('untrusted paths/buckets, wrong ID and changed metadata fail closed',async()=>{
 for(const change of [{id:randomUUID()},{bucket_id:'other'},{storage_path:'../other.pdf'},{size_bytes:5242881},{sha256:'bad'},{original_filename:'evil\r\nX: yes.pdf'},{status:'removed'}]){
  const {handler,calls}=setup({authorize:async()=>({...document,...change})});assert.equal((await handler(request())).status,502);assert.equal(calls.s3.length,0);
 }
 let n=0;const {handler}=setup({authorize:async()=>++n===1?document:{...document,original_filename:'changed.pdf'}});assert.equal((await handler(request())).status,404);
});
await check('actual size/hash/MIME, oversized stream, and S3/DB failure never return PDF',async()=>{
 for(const fetchObject of [async()=>{throw Error('secret must not appear');},async()=>({body:stream(),contentType:'text/html',contentLength:bytes.length}),
  async()=>({body:stream(),contentType:'application/pdf',contentLength:bytes.length+1}),
  async()=>({body:stream(bytes.subarray(1)),contentType:'application/pdf',contentLength:bytes.length}),
  async()=>({body:stream(Buffer.alloc(bytes.length,33)),contentType:'application/pdf',contentLength:bytes.length}),
  async()=>({body:stream(Buffer.alloc(bytes.length+1)),contentType:'application/pdf',contentLength:bytes.length})]){
  const r=await setup({fetchObject}).handler(request());assert.equal(r.status,502);uncached(r);assert.equal((await r.text()).includes('secret'),false);
 }
 const r=await setup({authorize:async()=>{throw Error('DB unavailable');}}).handler(request());assert.equal(r.status,502);uncached(r);
});
await check('input/origin/method/Range errors and preflight are uncached',async()=>{
 for(const [body,headers,method,status]of [[{document_id:id,path:'anything'},{},'POST',400],[{document_id:'bad'},{},'POST',400],
  [{document_id:id},{authorization:''},'POST',401],[{document_id:id},{origin:'https://other.invalid'},'POST',403],
  [{document_id:id},{range:'bytes=0-1'},'POST',400],[{}, {},'GET',405],[{}, {origin:'http://127.0.0.1:5173'},'OPTIONS',204]]){
  const {handler,calls}=setup();const r=await handler(request(body,headers,method));assert.equal(r.status,status);uncached(r);assert.equal(calls.s3.length,0);
 }
 const controller=new AbortController();controller.abort();const aborted=new Request(request(),{signal:controller.signal});
 const response=await setup().handler(aborted);assert.equal(response.status,503);uncached(response);
});
await check('exact 5 MiB succeeds without normalization, over-limit metadata refuses',async()=>{
 const large=Buffer.alloc(5242880,32),d={...document,size_bytes:large.length,sha256:hash(large)};
 const {handler}=setup({authorize:async()=>d,fetchObject:async()=>({body:stream(large),contentType:'application/pdf',contentLength:large.length})});
 const r=await handler(request());assert.equal(r.status,200);assert.equal(hash(Buffer.from(await r.arrayBuffer())),d.sha256);
});
await check('both actual service reads invoke handler by ID; failure has no Storage fallback',async()=>{
 const source=await readFile('src/services/unit-files.js','utf8');
 assert.equal(/\.download\(|createSigned|publicUrl/.test(source),false);
 const calls=[],storage={upload:async()=>({data:{}}),remove:async()=>({data:{}})};
 const client={rpc:async(name)=>{calls.push(name);return{data:name==='prepare_unit_document'?id:null};},storage:{from:()=>storage},functions:{invoke:async(name,args)=>{calls.push([name,args]);return{data:new Blob([bytes],{type:'application/pdf'})};}}};
 // Replace only the environment-specific client import; execute the actual service source.
 globalThis.__unitDownloadClient=client;
 const domain=new URL('../src/domain/unit-file.js',import.meta.url).href;
 const transformed=source.replace("import {getClient, unwrap} from './supabase.js';","const getClient=()=>globalThis.__unitDownloadClient;const unwrap=r=>{if(r.error)throw r.error;return r.data;};")
  .replace("'../domain/unit-file.js'",JSON.stringify(domain));
 const service=await import('data:text/javascript;base64,'+Buffer.from(transformed).toString('base64'));
 await service.uploadUnitFile(scope,unit,new File([bytes],'synthetic.pdf',{type:'application/pdf'}));await service.downloadUnitFile(document);
 assert.equal(calls.filter(Array.isArray).length,2);for(const call of calls.filter(Array.isArray))assert.deepEqual(call,['download-unit-file',{body:{document_id:id}}]);
 assert.ok(calls.indexOf('complete_unit_document')>calls.findIndex(Array.isArray));
 client.functions.invoke=async()=>({error:Error('Function unavailable')});await assert.rejects(()=>service.downloadUnitFile(document));
 delete globalThis.__unitDownloadClient;
});
await mkdir('.local/unit-file-download-qa',{recursive:true});
await writeFile('.local/unit-file-download-qa/handler.json',JSON.stringify({status:'PASS',groups,hosted:false,scope:'actual JS handler + mocked Auth/RPC/S3; service client stub, not hosted cache evidence'},null,2));
