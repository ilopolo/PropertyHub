import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {unitFileFixture} from './helpers/unit-file-fixture.mjs';
const f=await unitFileFixture(),{db,as,scope,unit}=f,groups=[];
const bytes=Buffer.from('%PDF-1.4\n% synthetic PropertyHub file\n%%EOF\n'),digest=createHash('sha256').update(bytes).digest('hex');
const deny=async fn=>{let error;try{await fn();}catch(e){error=e;}assert.ok(error,'Expected refusal');assert.ok(['42501','23514','23505','23502'].includes(error.code),error.message);};
const check=async(name,fn)=>{await fn();groups.push(name);console.log('PASS: '+name);};
const prepare=(label='doc',s=scope.A,u=unit.A,overrides={})=>as(label,'select public.prepare_unit_document($1,$2,$3,$4,$5,$6,$7,$8) id',[s,u,overrides.name??'synthetic.pdf',overrides.mime??'application/pdf',overrides.size??bytes.length,digest,overrides.audience??'staff',overrides.key??randomUUID()]);
const list=label=>as(label,'select * from public.unit_documents($1,$2)',[scope.A,unit.A]);
const path=id=>`${scope.A}/${unit.A}/${id}.pdf`;
const upload=(id,label='doc',size=bytes.length,mime='application/pdf',op='storage.object.upload')=>as(label,"insert into storage.objects(bucket_id,name,metadata) values('unit-private-files',$1,$2)",[path(id),{size,mimetype:mime}],op);
const read=(id,label='owner',op='storage.object.get_authenticated')=>as(label,"select * from storage.objects where bucket_id='unit-private-files' and name=$1",[path(id)],op);
const authorize=(id,label='owner')=>as(label,'select * from public.authorize_unit_file_download($1)',[id]);
const remove=id=>as('doc',"select public.remove_unit_document($1,'Synthetic removal')",[id]);
const finish=id=>as('doc','select public.finish_unit_document_removal($1)',[id]);
const erase=id=>as('doc',"delete from storage.objects where bucket_id='unit-private-files' and name=$1 returning id",[path(id)],'storage.object.delete_many');
try{
 await check('unsupported managed Storage prerequisites fail before any application DDL',async()=>{
  const probe=new PGlite();try{
   await probe.exec('create schema storage;create table storage.buckets(id text);create table storage.objects(id uuid);');
   const migration=await readFile(new URL('../supabase/migrations/20261031113950_private_unit_file.sql',import.meta.url),'utf8');
   for(const message of ['Storage operation helper required','Managed storage.objects RLS must already be enabled']){
    let error;try{await probe.exec('begin;'+migration+'commit;');}catch(e){error=e;await probe.exec('rollback');}assert.ok(error?.message.startsWith(message));assert.equal((await probe.query('select * from storage.buckets')).rows.length,0);
    if(message.startsWith('Storage operation'))await probe.exec('create function storage.allow_only_operation(text) returns boolean language sql as $$select true$$');
   }
  }finally{await probe.close();}
 });
 await check('private bucket restrictions and explicit scoped permission only',async()=>{
  const bucket=(await db.query("select * from storage.buckets where id='unit-private-files'")).rows[0];assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),5242880);assert.deepEqual(bucket.allowed_mime_types,['application/pdf']);
  for(const label of ['anon','platform','orgA','A','B','owner','pending'])await deny(()=>prepare(label));
  await deny(()=>prepare('doc',scope.B,unit.B));await deny(()=>prepare('doc',scope.A,unit.B));
  await deny(()=>as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['manage_documents'])",[f.org.A,f.auth.pending,scope.A]));
 });
 await check('filename MIME and exact size limits enforced server-side',async()=>{
  for(const overrides of [{name:'../evil.pdf'},{mime:'text/html'},{size:0},{size:5242881},{audience:'public'},{name:'file.svg'}])await deny(()=>prepare('doc',scope.A,unit.A,overrides));
  const id=(await prepare('doc',scope.A,unit.A,{size:5242880})).rows[0].id;await remove(id);await finish(id);
 });
 let id;
 await check('pending object cannot be published without matching upload, expires fail closed',async()=>{
  id=(await prepare()).rows[0].id;assert.equal((await db.query('select category_code from public.documents where id=$1',[id])).rows[0].category_code,'unit_attachment');await deny(()=>prepare());await deny(()=>as('doc','select public.complete_unit_document($1)',[id]));
  assert.equal((await list('owner')).rows.length,0);await upload(id,'doc',bytes.length+1);await deny(()=>as('doc','select public.complete_unit_document($1)',[id]));
  await remove(id);await deny(()=>finish(id));assert.equal((await erase(id)).rows.length,1);await finish(id);
  const expired=(await prepare()).rows[0].id;await db.query("update public.documents set upload_expires_at=now()-interval '1 second' where id=$1",[expired]);await deny(()=>upload(expired));await deny(()=>as('doc','select public.complete_unit_document($1)',[expired]));await remove(expired);await finish(expired);
 });
 await check('staff-only ready file never becomes owner-readable; no signed/list/copy/upsert',async()=>{
  id=(await prepare()).rows[0].id;await upload(id);await as('doc','select public.complete_unit_document($1)',[id]);assert.equal((await authorize(id,'doc')).rows.length,1);assert.equal((await read(id,'doc')).rows.length,0);assert.equal((await read(id)).rows.length,0);assert.equal((await list('owner')).rows.length,0);
  for(const op of ['storage.object.sign','storage.object.sign_many','storage.object.list','storage.object.copy',''])assert.equal((await read(id,'doc',op)).rows.length,0);
  await deny(()=>upload(id));assert.equal((await as('doc',"update storage.objects set metadata='{}' where name=$1 returning id",[path(id)],'storage.object.upload_update')).rows.length,0);
  await remove(id);await erase(id);await finish(id);
 });
 await check('explicit owner audience and matching scope; metadata projection has no actor/history',async()=>{
  id=(await prepare('doc',scope.A,unit.A,{audience:'owners'})).rows[0].id;await upload(id);assert.equal((await read(id)).rows.length,0);await as('doc','select public.complete_unit_document($1)',[id]);
  assert.equal((await authorize(id)).rows.length,1);assert.equal((await read(id)).rows.length,0);const rows=(await list('owner')).rows;assert.equal(rows.length,1);assert.equal(Object.hasOwn(rows[0],'uploader_id'),false);assert.equal((await as('owner','select * from public.documents')).rows.length,0);
  for(const label of ['anon','B','A','orgA','platform','pending'])assert.equal((await read(id,label)).rows.length,0);
  assert.equal((await list('B')).rows.length,0);await deny(()=>as('owner','select public.remove_unit_document($1,$2)',[id,'Unauthorized']));
 });
 await check('same identity loses handler authorization and metadata after owner link revoke',async()=>{
  await as('A',"select public.revoke_owner_link($1,$2,'Synthetic evidence','Synthetic revoke')",[scope.A,f.link]);assert.equal((await authorize(id)).rows.length,0);assert.equal((await read(id)).rows.length,0);assert.equal((await list('owner')).rows.length,0);
 });
 await check('tombstone precedes physical cleanup, retry preserves audit and allows new slot',async()=>{
  await remove(id);assert.equal((await read(id,'doc')).rows.length,0);await deny(()=>finish(id));assert.equal((await erase(id)).rows.length,1);await finish(id);await finish(id);await remove(id);
  const d=(await db.query('select * from public.documents where id=$1',[id])).rows[0];assert.ok(d.removed_at&&d.bytes_deleted_at);assert.equal(d.removed_by,f.profile.doc);
  id=(await prepare()).rows[0].id;await upload(id);await as('doc','select public.complete_unit_document($1)',[id]);
 });
 await check('current staff revocation takes effect without replacing identity; direct writes denied',async()=>{
  await deny(()=>as('doc','update public.documents set visibility=$1 where id=$2',['owners',id]));await deny(()=>as('doc','delete from public.documents where id=$1',[id]));
  await as('orgA','select public.revoke_staff_role($1)',[f.docRole]);assert.equal((await read(id,'doc')).rows.length,0);assert.equal((await list('doc')).rows.length,0);await deny(()=>remove(id));
 });
 await check('restrictive guards contain broad pre-existing policies and deny anonymous access',async()=>{
  await db.exec('create policy synthetic_broad on storage.objects for all to anon,authenticated using(true) with check(true)');
  for(const label of ['anon','doc','owner','B'])assert.equal((await read(id,label)).rows.length,0);
  await deny(()=>upload(randomUUID(),'anon'));await deny(()=>upload(id,'B'));assert.equal((await as('anon','delete from storage.objects returning id',[],'storage.object.delete_many')).rows.length,0);
 });
 await mkdir('.local/unit-file-qa',{recursive:true});await writeFile('.local/unit-file-qa/db-report.json',JSON.stringify({status:'PASS',groups,migrations:f.migrations.length,hosted:false,scope:'PGlite with explicit managed Storage schema/helper fixture; not real Storage service'},null,2));
}catch(error){console.error('FAIL: '+error.code+' '+error.message);process.exitCode=1;}finally{await db.close();}
