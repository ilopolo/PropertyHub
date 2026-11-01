// Safe evidence only: never persist request URLs, authorization, keys or response bodies.
import assert from 'node:assert/strict';
import {PROJECT,URL,BUCKET} from './unit-file-hosted.mjs';
const HEADER_NAMES=['cache-control','cdn-cache-control','surrogate-control','pragma','expires','vary','content-type','content-length','age','cf-cache-status','x-cache','sb-request-id','x-request-id','etag'];
export const safeHeaders=response=>Object.fromEntries(HEADER_NAMES.flatMap(name=>response.headers.has(name)?[[name,response.headers.get(name).slice(0,512)]]:[]));
export function assertUncached(response){
 assert.match(response.headers.get('cache-control')||'',/(?:^|[, ])no-store(?:$|[, ])/i,'Missing server no-store');
 for(const name of ['cdn-cache-control','surrogate-control'])if(response.headers.has(name))assert.match(response.headers.get(name),/no-store/i);
 assert.equal(response.headers.has('etag'),false,'No conditional byte response');
 assert.ok(!/hit/i.test(response.headers.get('cf-cache-status')||''),'Unexpected CDN cache HIT');
}
export async function edgeProbe({fetcher=fetch,token,publicKey,id,evidence,label}){
 const headers={'Content-Type':'application/json',apikey:publicKey};if(token)headers.Authorization='Bearer '+token;
 const response=await fetcher(URL+'/functions/v1/download-unit-file',{method:'POST',headers,body:JSON.stringify({document_id:id}),redirect:'error',signal:AbortSignal.timeout(40000)});
 evidence.push({probe:'handler',label,status:response.status,headers:safeHeaders(response)});
 // Both success and authorization errors must be uncached; 5xx is never a denial PASS.
 assertUncached(response);
 if(response.status!==200){assert.ok([400,401,403,404].includes(response.status),'Handler configuration/runtime/transport failure');await response.body?.cancel();return{error:{status:response.status}};}
 assert.equal(response.headers.get('content-type'),'application/pdf');
 assert.match(response.headers.get('content-disposition')||'',/^attachment;/i);
 return {data:await response.blob()};
}
export async function directByteProbes({fetcher=fetch,token,publicKey,path,evidence}){
 assert.match(path,/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/i);
 const routes=[['sdk-url','GET',`/object/${BUCKET}/${path}`,{}],['authenticated','GET',`/object/authenticated/${BUCKET}/${path}`,{}],
  ['public','GET',`/object/public/${BUCKET}/${path}`,{}],['info','GET',`/object/info/${BUCKET}/${path}`,{}],
  ['head','HEAD',`/object/${BUCKET}/${path}`,{}],['range','GET',`/object/${BUCKET}/${path}`,{Range:'bytes=0-15'}],
  ['render','GET',`/render/image/authenticated/${BUCKET}/${path}`,{}]];
 for(const [label,method,route,extra]of routes){
  const r=await fetcher(URL+'/storage/v1'+route,{method,headers:{Authorization:'Bearer '+token,apikey:publicKey,...extra},redirect:'error',signal:AbortSignal.timeout(20000)});
  evidence.push({probe:'direct-byte',label,status:r.status,headers:safeHeaders(r)});
  await r.body?.cancel();assert.ok([400,401,403,404].includes(r.status),'Direct byte path succeeded or transport failed: '+label);
 }
 // Repetition uses the identical default URL; no nonce or JWT replacement.
 const r=await fetcher(URL+`/storage/v1/object/${BUCKET}/${path}`,{headers:{Authorization:'Bearer '+token,apikey:publicKey},redirect:'error',signal:AbortSignal.timeout(20000)});
 evidence.push({probe:'direct-byte',label:'sdk-url-replay',status:r.status,headers:safeHeaders(r)});await r.body?.cancel();assert.ok([400,401,403,404].includes(r.status));
}
export async function signingProbes({fetcher=fetch,token,publicKey,path,evidence}){
 const requests=[['sign',`/object/sign/${BUCKET}/${path}`,{expiresIn:60}],['sign-many',`/object/sign/${BUCKET}`,{expiresIn:60,paths:[path]}],
  ['list',`/object/list/${BUCKET}`,{prefix:path.slice(0,path.lastIndexOf('/')),limit:100,offset:0}]];
 for(const [label,route,body]of requests){
  const r=await fetcher(URL+'/storage/v1'+route,{method:'POST',headers:{Authorization:'Bearer '+token,apikey:publicKey,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});
  evidence.push({probe:'direct-metadata',label,status:r.status,headers:safeHeaders(r)});
  if(r.status===200){
   const data=await r.json();assert.ok(Array.isArray(data),'Unexpected signing result');
   if(label==='list')assert.equal(data.length,0,'Object listing exposed');
   else{assert.equal(label,'sign-many');assert.equal(data.length,1);assert.ok(data[0].error&&!data[0].signedURL&&!data[0].signedUrl,'Signed URL issued');}
  }else{await r.body?.cancel();assert.ok([400,401,403,404].includes(r.status),'Signing/list transport or runtime failure');}
 }
}
export function validateS3PublicKey(key){
 assert.equal(typeof key,'string','Legacy anon key required for the supported S3 user-token mode');
 const parts=key.split('.');assert.equal(parts.length,3);let claims;try{claims=JSON.parse(Buffer.from(parts[1],'base64url'));}catch{throw Error('Invalid legacy public key');}
 assert.equal(claims.role,'anon');assert.equal(claims.ref,PROJECT);
}
