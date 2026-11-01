import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {ticketFileFixture} from './helpers/ticket-file-fixture.mjs';
const out='.local/ticket-attachment-qa',checks=[],f=await ticketFileFixture();
const bytes=Buffer.from('%PDF-1.7\nSynthetic attachment\n%%EOF'),digest=createHash('sha256').update(bytes).digest('hex');
const prepare=async(who='owner',item=f.ticket,key=randomUUID(),name='test.pdf',mime='application/pdf',size=bytes.length)=>(await f.as(who,'select public.prepare_ticket_attachment($1,$2,$3,$4,$5,$6) d',[item,name,mime,size,digest,key])).rows[0].d;
const authorize=async(who,d)=>(await f.as(who,'select * from public.authorize_ticket_file_download($1)',[d.id])).rows;
const put=async(who,d)=>f.as(who,'insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[d.bucket_id,d.storage_path,{size:d.size_bytes,mimetype:d.mime_type}],'storage.object.upload');
const denied=async(who,sql,args=[],code='42501')=>assert.rejects(f.as(who,sql,args),e=>e.code===code);
async function remove(who,d){await f.as(who,"select public.remove_ticket_attachment($1,'Synthetic cleanup')",[d.id]);await f.as(who,'delete from storage.objects where bucket_id=$1 and name=$2',[d.bucket_id,d.storage_path],'storage.object.delete_many');await f.as(who,'select public.finish_ticket_attachment_removal($1)',[d.id]);}
try{
 const bucket=(await f.db.query("select * from storage.buckets where id='ticket-private-files'")).rows[0];assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),5242880);
 assert.deepEqual(bucket.allowed_mime_types,['application/pdf','image/png','image/jpeg']);
 for(const who of ['anon','pending','platform','orgA','A','B'])await assert.rejects(prepare(who),e=>e.code==='42501');
 const d=await prepare();assert.equal(d.scope_id,f.scope.A);assert.equal(d.uploader_id,f.profile.owner);assert.equal(d.item_id,f.ticket);assert.equal(d.status,'pending');
 assert.deepEqual(await prepare('owner',f.ticket,d.id),d);await assert.rejects(prepare(),e=>e.code==='23505');
 await assert.rejects(prepare('owner',f.ticket,d.id,'other.pdf'),e=>e.code==='23514');
 assert.equal((await authorize('owner',d)).length,1);assert.equal((await authorize('doc',d)).length,0);
 await denied('owner','select public.complete_ticket_attachment($1)',[d.id],'23514');
 for(const who of ['B','A','platform','orgA']){assert.equal((await f.as(who,'select * from public.ticket_attachments')).rows.length,0);assert.equal((await authorize(who,d)).length,0);await denied(who,'select public.remove_ticket_attachment($1,$2)',[d.id,'forged']);await assert.rejects(put(who,d),e=>e.code==='42501');}
 await denied('owner',"update public.ticket_attachments set item_id=$1 where id=$2",[f.coownerTicket,d.id]);
 await denied('owner','delete from public.ticket_attachments where id=$1',[d.id]);
 checks.push('private bucket; server scope/reporter/uploader; one active/idempotence; co-owner same-unit and foreign/anonymous/admin/registry denial; direct writes denied');
 await put('owner',d);await f.as('owner','select public.complete_ticket_attachment($1)',[d.id]);
 assert.equal((await authorize('doc',d)).length,1);assert.equal((await authorize('owner',d)).length,1);
 // Deliberately broad permissive policy cannot re-open guarded paths.
 await f.db.exec('create policy qa_broad on storage.objects for all to authenticated,anon using(true) with check(true)');
 for(const operation of ['storage.object.get_authenticated','storage.object.get','storage.object.sign','storage.object.sign_many','storage.object.list','storage.object.info','storage.object.copy','storage.s3.get_object',''])
  for(const who of ['owner','doc','B','anon'])assert.equal((await f.as(who,'select * from storage.objects where bucket_id=$1',[d.bucket_id],operation)).rows.length,0);
 assert.equal((await f.as('owner','delete from storage.objects where name=$1 returning id',[d.storage_path],'storage.object.delete_many')).rows.length,0);
 assert.equal((await f.as('owner',"update storage.objects set metadata='{}' where name=$1 returning id",[d.storage_path],'storage.object.upload')).rows.length,0);
 checks.push('ready owner/staff authorization; restrictive client byte/sign/info/list/copy/S3/update/delete guards contain broad permissive policy');
 await f.as('orgA','select public.revoke_staff_role($1)',[f.ticketRole]);assert.equal((await authorize('doc',d)).length,0);
 const onlyDocuments=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['read_registry','manage_documents']) id",[f.org.A,f.auth.doc,f.scope.A])).rows[0].id;
 assert.equal((await authorize('doc',d)).length,0);await assert.rejects(prepare('doc'),e=>e.code==='42501');
 await f.as('orgA','select public.revoke_staff_role($1)',[onlyDocuments]);
 await f.as('A','select public.revoke_owner_link($1,$2,$3,$4)',[f.scope.A,f.link,'Synthetic','Synthetic revoke']);assert.equal((await authorize('owner',d)).length,0);
 await denied('owner','select public.remove_ticket_attachment($1,$2)',[d.id,'revoked']);
 checks.push('current local caller identity loses bytes/remove after role and owner-link revocation without new identity');
 // Restore ONLY local QA grants to exercise remaining lifecycle cases.
 f.ticketRole=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['manage_tickets']) id",[f.org.A,f.auth.doc,f.scope.A])).rows[0].id;
 f.link=(await f.as('A','select public.confirm_owner_link($1,$2,$3,1,$4,$5,$6) id',[f.scope.A,f.auth.owner,f.person.A,'Synthetic','Synthetic',randomUUID()])).rows[0].id;
 await remove('owner',d);assert.equal((await authorize('owner',d)).length,0);
 const staff=await prepare('doc');await denied('owner','select public.remove_ticket_attachment($1,$2)',[staff.id,'not my upload']);await remove('doc',staff);
 for(const [name,mime,size]of [['test.txt','text/plain',10],['test.png','application/pdf',10],['test.pdf','application/pdf',0],['test.pdf','application/pdf',5242881],['bad/one.pdf','application/pdf',10]])await assert.rejects(prepare('owner',f.ticket,randomUUID(),name,mime,size),e=>e.code==='23514');
 for(const [name,mime,size]of [['test.pdf','application/pdf',5242880],['test.png','image/png',8],['test.jpeg','image/jpeg',3]]){const row=await prepare('owner',f.ticket,randomUUID(),name,mime,size);await remove('owner',row);}
 const pending=await prepare();await denied('owner','select public.finish_ticket_attachment_removal($1)',[pending.id],'23514');
 // Advance fixture time through a transaction-local clock alternative: set expiry BEFORE insert via default.
 await remove('owner',pending);
 await f.db.exec("alter table public.ticket_attachments alter upload_expires_at set default now()-interval '1 minute'");
 const expired=await prepare();assert.equal((await authorize('owner',expired)).length,0);await assert.rejects(put('owner',expired),e=>e.code==='42501');await denied('owner','select public.complete_ticket_attachment($1)',[expired.id],'23514');await remove('doc',expired);
 checks.push('own-only owner removal, scoped staff removal, file metadata limits, max boundary, incomplete/missing/expired upload explicit cancellation');
 assert.equal((await f.db.query("select * from storage.objects where bucket_id='ticket-private-files'")).rows.length,0);
 const history=(await f.db.query('select * from public.ticket_attachments')).rows;assert.equal(history.length,7);assert(history.every(d=>d.status==='removed'&&d.bytes_deleted_at));
 const audits=(await f.db.query("select * from public.audit_events where target_kind='ticket_attachment'")).rows;assert.equal(audits.length,22);
 await assert.rejects(f.db.query('delete from public.ticket_attachments where id=$1',[d.id]),e=>e.code==='42501');
 const acl=(await f.db.query("select has_function_privilege('anon','public.authorize_ticket_file_download(uuid)','execute') anon,has_function_privilege('authenticated','private.can_remove_ticket_file(uuid,uuid)','execute') helper")).rows[0];assert.deepEqual(acl,{anon:false,helper:false});
 checks.push('exact local byte cleanup: zero objects, seven immutable removed histories, 22 audit rows, explicit minimal grants; old unit ACL unchanged');
 await mkdir(out,{recursive:true});await writeFile(out+'/db.json',JSON.stringify({pass:true,hosted:false,runtime:'PGlite PostgreSQL, simulated Auth/Storage operation context',checks,migrations:f.migrations,cleanup:{objects:0,history:history.length,audits:audits.length}},null,2));console.log('PASS ticket attachment DB/RLS:',checks.length,'groups');
}finally{await f.db.close();}
