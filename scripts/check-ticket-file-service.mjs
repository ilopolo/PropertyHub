// Real supabase-js/HTTP and application service; local Auth/S3 adapters + PostgreSQL.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {ticketFileFixture} from './helpers/ticket-file-fixture.mjs';
import {startUnitFileQaServer} from './helpers/unit-file-qa-server.mjs';
import {createDownloadHandler} from '../supabase/functions/download-ticket-file/handler.js';
const f=await ticketFileFixture(),password=randomUUID(),clients=[],checks=[];let api;
const hash=b=>createHash('sha256').update(b).digest('hex'),ok=r=>{if(r.error)throw r.error;return r.data;};
const pdf=Buffer.from('%PDF-1.7\nSynthetic\n%%EOF'),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6nWQAAAAASUVORK5CYII=','base64');
try{
 api=await startUnitFileQaServer(f,password,{bucket:'ticket-private-files',functionName:'download-ticket-file',authorizeRpc:'authorize_ticket_file_download',handlerFactory:createDownloadHandler,mimes:['application/pdf','image/png','image/jpeg']});
 async function login(label){const c=createClient('http://127.0.0.1:54331','sb_publishable_local_qa_only',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>{assert.equal(new URL(input instanceof Request?input.url:input).hostname,'127.0.0.1');return fetch(input,init);}}});clients.push(c);ok(await c.auth.signInWithPassword({email:label.toLowerCase()+'@propertyhub.invalid',password}));return c;}
 const owner=await login('owner'),staff=await login('doc'),coowner=await login('B');
 const source=(await readFile('src/services/ticket-files.js','utf8')).replace("import {getClient,unwrap} from './supabase.js';","const getClient=()=>globalThis.__ticketFileClient;const unwrap=r=>{if(r.error)throw r.error;return r.data;};").replace("'../domain/ticket-file.js'",JSON.stringify(new URL('../src/domain/ticket-file.js',import.meta.url).href));
 const service=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 globalThis.__ticketFileClient=owner;
 for(const [bytes,name,mime]of [[pdf,'synthetic.pdf','application/pdf'],[png,'synthetic.png','image/png'],[Buffer.from([255,216,255,217]),'synthetic.jpeg','image/jpeg']]){
  const id=await service.uploadTicketFile(f.ticket,new File([bytes],name,{type:mime}));
  const data=await service.ticketFiles(f.ticket),d=data.files.find(d=>d.id===id);assert.equal(d.status,'ready');assert.equal(data.can_upload,false);
  const blob=await service.downloadTicketFile(d);assert(blob instanceof Blob);assert.equal(hash(Buffer.from(await blob.arrayBuffer())),hash(bytes));
  globalThis.__ticketFileClient=coowner;assert.equal(await service.ticketFiles(f.ticket),null);await assert.rejects(()=>service.downloadTicketFile(d));
  globalThis.__ticketFileClient=staff;assert.equal(hash(Buffer.from(await(await service.downloadTicketFile(d)).arrayBuffer())),hash(bytes));
  globalThis.__ticketFileClient=owner;await service.removeTicketFile(d,'Synthetic service cleanup');
 }
 checks.push('all three MIME types: actual upload/pending Edge integrity/complete/ready download and SHA; image Blob SDK handling; co-owner refusal; staff read');
 const id=await service.uploadTicketFile(f.ticket,new File([pdf],'revocation.pdf',{type:'application/pdf'})),d=(await service.ticketFiles(f.ticket)).files.find(d=>d.id===id);
 const token=ok(await owner.auth.getSession()).session.access_token;globalThis.__ticketFileClient=staff;
 const staffToken=ok(await staff.auth.getSession()).session.access_token;await service.downloadTicketFile(d);
 await f.as('orgA','select public.revoke_staff_role($1)',[f.ticketRole]);await assert.rejects(()=>service.downloadTicketFile(d));assert.equal(ok(await staff.auth.getSession()).session.access_token,staffToken);
 globalThis.__ticketFileClient=owner;await f.as('A','select public.revoke_owner_link($1,$2,$3,$4)',[f.scope.A,f.link,'Synthetic','Synthetic']);await assert.rejects(()=>service.downloadTicketFile(d));assert.equal(ok(await owner.auth.getSession()).session.access_token,token);
 f.ticketRole=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['manage_tickets']) id",[f.org.A,f.auth.doc,f.scope.A])).rows[0].id;
 globalThis.__ticketFileClient=staff;await service.removeTicketFile(d,'Synthetic revoked-uploader cleanup');
 checks.push('positive download then local same-token role/link revoke denies; authorized staff removes revoked-uploader file');
 await assert.rejects(()=>service.uploadTicketFile(f.ticket,new File([pdf],'bad.png',{type:'image/png'})));
 // Backend transfer failure: pending metadata persists, then explicit cancel safely cleans it.
 globalThis.__ticketFileClient={rpc:staff.rpc.bind(staff),storage:staff.storage,functions:{invoke:async()=>({data:null,error:new Error('Synthetic transport interruption')})}};
 await assert.rejects(()=>service.uploadTicketFile(f.ticket,new File([pdf],'interrupted.pdf',{type:'application/pdf'})));
 globalThis.__ticketFileClient=staff;
 const pending=(await service.ticketFiles(f.ticket)).files.find(d=>d.status==='pending');assert(pending);assert.equal(api.objects.size,1);
 await service.removeTicketFile(pending,'Synthetic incomplete upload cancellation');assert.equal(api.objects.size,0);
 const rows=(await f.db.query('select * from public.ticket_attachments')).rows;assert.equal(rows.length,5);assert(rows.every(d=>d.status==='removed'&&d.bytes_deleted_at));
 checks.push('bad signature refuses before prepare; interrupted pending remains tracked; explicit cancellation removes bytes and retains five histories');
 await mkdir('.local/ticket-attachment-qa',{recursive:true});await writeFile('.local/ticket-attachment-qa/service.json',JSON.stringify({pass:true,hosted:false,checks,transfers:api.transfers,cleanup:{objects:0,histories:rows.length},runtime:'actual SDK/service/HTTP/handler + PGlite, local Auth/S3; not hosted CDN/revocation evidence'},null,2));console.log('PASS ticket attachment service:',checks.length,'groups');
}finally{delete globalThis.__ticketFileClient;for(const c of clients)await c.auth.signOut({scope:'local'});await api?.close();await f.db.close();}
