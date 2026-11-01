// Real SDK/HTTP/service + actual JS handler + PostgreSQL, local mock Auth/S3 only.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {unitFileFixture} from './helpers/unit-file-fixture.mjs';
import {startUnitFileQaServer} from './helpers/unit-file-qa-server.mjs';
const f=await unitFileFixture(),password=randomUUID(),clients=[];let api;
const bytes=Buffer.from('%PDF-1.4\n% synthetic integration\n%%EOF\n'),hash=b=>createHash('sha256').update(b).digest('hex');
const ok=r=>{if(r.error)throw Error('Local SDK refusal');return r.data;};
try{
 api=await startUnitFileQaServer(f,password);
 async function login(label){const c=createClient('http://127.0.0.1:54331','sb_publishable_local_qa_only',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>{assert.equal(new URL(input instanceof Request?input.url:input).hostname,'127.0.0.1');return fetch(input,init);}}});clients.push(c);ok(await c.auth.signInWithPassword({email:label.toLowerCase()+'@propertyhub.invalid',password}));return c;}
 const staff=await login('doc'),owner=await login('owner'),a=await login('A');
 globalThis.__unitDownloadClient=staff;
 const source=(await readFile('src/services/unit-files.js','utf8')).replace("import {getClient, unwrap} from './supabase.js';","const getClient=()=>globalThis.__unitDownloadClient;const unwrap=r=>{if(r.error)throw r.error;return r.data;};")
  .replace("'../domain/unit-file.js'",JSON.stringify(new URL('../src/domain/unit-file.js',import.meta.url).href));
 const service=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 let id=await service.uploadUnitFile(f.scope.A,f.unit.A,new File([bytes],'synthetic.pdf',{type:'application/pdf'}));
 let doc=(await service.unitDocuments(f.scope.A,f.unit.A)).find(d=>d.id===id);assert.equal(doc.status,'ready');
 assert.equal(hash(Buffer.from(await(await service.downloadUnitFile(doc)).arrayBuffer())),hash(bytes));
 globalThis.__unitDownloadClient=owner;await assert.rejects(()=>service.downloadUnitFile(doc));
 globalThis.__unitDownloadClient=staff;await service.removeUnitFile(doc,'Synthetic integration removal');
 id=await service.uploadUnitFile(f.scope.A,f.unit.A,new File([bytes],'owners.pdf',{type:'application/pdf'}),'owners');
 doc=(await service.unitDocuments(f.scope.A,f.unit.A)).find(d=>d.id===id);globalThis.__unitDownloadClient=owner;
 const sameToken=ok(await owner.auth.getSession()).session.access_token;assert.equal(hash(Buffer.from(await(await service.downloadUnitFile(doc)).arrayBuffer())),hash(bytes));
 ok(await a.rpc('revoke_owner_link',{scope:f.scope.A,link_id:f.link,evidence:'Synthetic evidence',note:'Synthetic integration revoke'}));
 await assert.rejects(()=>service.downloadUnitFile(doc));assert.equal(ok(await owner.auth.getSession()).session.access_token,sameToken);
 globalThis.__unitDownloadClient=staff;await service.removeUnitFile(doc,'Synthetic final removal');assert.equal(api.objects.size,0);
 assert.equal(api.failures.length,0);
 await mkdir('.local/unit-file-download-qa',{recursive:true});await writeFile('.local/unit-file-download-qa/integration.json',JSON.stringify({status:'PASS',hosted:false,checks:['SDK upload + handler pending verification + ready complete','staff bytes/hash','default owner denied','explicit owner bytes/hash','same local JWT link revocation denied','service remove/audit and zero mock objects'],transfers:api.transfers,scope:'local HTTP mock Auth/S3, actual service/SDK/handler + PGlite; not hosted CDN proof'},null,2));
 console.log('PASS: actual service + SDK/HTTP + handler/DB integration, both read paths, privacy/revocation/cleanup; local only');
}finally{delete globalThis.__unitDownloadClient;for(const c of clients)await c.auth.signOut({scope:'local'});if(api)await api.close();await f.db.close();}
