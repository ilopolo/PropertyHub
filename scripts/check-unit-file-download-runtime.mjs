// Run with Deno: executes the actual npm SDK adapters against intercepted fetch only.
import assert from 'node:assert/strict';
import {runtimeHandler} from '../supabase/functions/download-unit-file/index.js';
const project='qfybswnezdzzahmozikr',id=crypto.randomUUID(),scope=crypto.randomUUID(),unit=crypto.randomUUID(),actor=crypto.randomUUID();
const bytes=new TextEncoder().encode('%PDF-1.4\n% synthetic runtime fixture\n%%EOF\n');
const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
const row={id,scope_id:scope,unit_id:unit,bucket_id:'unit-private-files',storage_path:`${scope}/${unit}/${id}.pdf`,original_filename:'synthetic.pdf',mime_type:'application/pdf',size_bytes:bytes.length,sha256,status:'ready'};
const config={SUPABASE_URL:`https://${project}.supabase.co`,UNIT_FILES_PUBLIC_KEY:'sb_publishable_synthetic_runtime_fixture',UNIT_FILES_S3_ENDPOINT:`https://${project}.storage.supabase.co/storage/v1/s3`,UNIT_FILES_S3_REGION:'eu-central-1',UNIT_FILES_S3_ACCESS_KEY_ID:'synthetic-access-only',UNIT_FILES_S3_SECRET_ACCESS_KEY:'synthetic-secret-only'};
const original=globalThis.fetch;let calls=[],revoked=false,denySecond=false;
globalThis.fetch=async(input,options)=>{
 const request=input instanceof Request?input:new Request(input,options),url=new URL(request.url);calls.push({url,request});
 if(url.origin===config.SUPABASE_URL&&url.pathname==='/auth/v1/user')return Response.json({id:actor,is_anonymous:false,email_confirmed_at:'2026-01-01'});
 if(url.origin===config.SUPABASE_URL&&url.pathname==='/rest/v1/rpc/authorize_unit_file_download'){
  assert.equal(request.headers.get('authorization'),'Bearer synthetic-runtime-session');assert.deepEqual(await request.json(),{document_id:id});return Response.json(revoked?[]:[row]);
 }
 if(url.origin===`https://${project}.storage.supabase.co`&&url.pathname===`/storage/v1/s3/unit-private-files/${row.storage_path}`){
  assert.equal(request.method,'GET');assert.match(request.headers.get('authorization'),/^AWS4-HMAC-SHA256 /);
  assert.equal(request.cache,'no-store');assert.equal(request.redirect,'error');if(denySecond)revoked=true;
  return new Response(bytes,{headers:{'content-type':'application/pdf','content-length':String(bytes.length)}});
 }
 throw Error('Unexpected network destination; no network allowed');
};
const request=()=>new Request('http://local/functions/v1/download-unit-file',{method:'POST',headers:{authorization:'Bearer synthetic-runtime-session','content-type':'application/json'},body:JSON.stringify({document_id:id})});
try{
 let r=await runtimeHandler(name=>config[name])(request());assert.equal(r.status,200);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),bytes);
 assert.equal(calls.length,4);assert.equal(calls.filter(c=>c.url.hostname.endsWith('.storage.supabase.co')).length,1);
 console.log('PASS: actual Supabase/AWS/FetchHttpHandler adapters: caller RPC twice, exact signed S3 GET, no-store/no-redirect (intercepted fetch only)');
 calls=[];denySecond=true;r=await runtimeHandler(name=>config[name])(request());assert.equal(r.status,404);assert.match(r.headers.get('cache-control'),/no-store/);
 console.log('PASS: runtime adapter refuses revocation during fetch; no bytes returned');
 calls=[];r=await runtimeHandler(()=>undefined)(request());assert.equal(r.status,502);assert.equal(calls.length,0);assert.match(r.headers.get('cache-control'),/no-store/);
 const wrong={...config,UNIT_FILES_S3_ENDPOINT:'https://other.invalid'};r=await runtimeHandler(name=>wrong[name])(request());assert.equal(r.status,502);assert.equal(calls.length,0);
 console.log('PASS: missing/wrong server configuration refuses without any fetch or fallback');
}finally{globalThis.fetch=original;}
