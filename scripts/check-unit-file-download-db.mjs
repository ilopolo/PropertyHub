// Disposable PostgreSQL checks, managed Auth/Storage schema/operation fixtures only.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {unitFileFixture} from './helpers/unit-file-fixture.mjs';
const f=await unitFileFixture(),{db,as,scope,unit}=f,groups=[];
const check=async(name,fn)=>{await fn();groups.push(name);console.log('PASS: '+name);};
const digest=createHash('sha256').update('synthetic').digest('hex');
const authz=(label,id)=>as(label,'select * from public.authorize_unit_file_download($1)',[id]);
let id,path;
try{
 await check('caller RPC grants and session lookup stay narrow',async()=>{
  assert.equal((await db.query("select has_function_privilege('anon','public.authorize_unit_file_download(uuid)','execute') p")).rows[0].p,false);
  assert.equal((await db.query("select has_table_privilege('authenticated','auth.sessions','select') p")).rows[0].p,false);
  assert.equal((await db.query("select prosecdef from pg_proc where oid='public.authorize_unit_file_download(uuid)'::regprocedure")).rows[0].prosecdef,false);
 });
 await check('pending authorization only uploader/current permission, ready default staff only',async()=>{
  id=(await as('doc',"select public.prepare_unit_document($1,$2,'synthetic.pdf','application/pdf',9,$3,'staff',$4) id",[scope.A,unit.A,digest,randomUUID()])).rows[0].id;
  path=`${scope.A}/${unit.A}/${id}.pdf`;
  assert.equal((await authz('doc',id)).rows.length,1);for(const label of ['owner','B','platform','orgA','pending'])assert.equal((await authz(label,id)).rows.length,0);
  await as('doc',"insert into storage.objects(bucket_id,name,metadata) values('unit-private-files',$1,$2)",[path,{size:9,mimetype:'application/pdf'}],'storage.object.upload');
  await as('doc','select public.complete_unit_document($1)',[id]);assert.equal((await authz('doc',id)).rows.length,1);assert.equal((await authz('owner',id)).rows.length,0);
  assert.equal((await authz('doc',randomUUID())).rows.length,0);
 });
 await check('every direct read/sign operation denied even with broad permissive policy',async()=>{
  await db.exec('create policy synthetic_broad_read on storage.objects for select to anon,authenticated using(true)');
  for(const label of ['doc','owner','B','anon'])for(const op of ['object.get_authenticated','object.get_authenticated_info','object.head_authenticated','object.list','object.sign','object.sign_many','object.copy','object.get_public','s3.get_object','s3.head_object','']){
   assert.equal((await as(label,"select * from storage.objects where name=$1",[path],op?'storage.'+op:'')).rows.length,0,label+'/'+op);
  }
 });
 await check('session missing/malformed/another-user refuses, without exposing auth table',async()=>{
  const previous=f.session.doc;for(const invalid of [undefined,'bad',f.session.owner,randomUUID()]){f.session.doc=invalid;assert.equal((await authz('doc',id)).rows.length,0);}f.session.doc=previous;
  await db.query('delete from auth.sessions where id=$1',[previous]);assert.equal((await authz('doc',id)).rows.length,0);await db.query('insert into auth.sessions values($1,$2)',[previous,f.auth.doc]);
 });
 await check('tombstone/delete SELECT exception and retained audit still work',async()=>{
  await as('doc',"select public.remove_unit_document($1,'Synthetic removal')",[id]);assert.equal((await authz('doc',id)).rows.length,0);
  assert.equal((await as('doc',"delete from storage.objects where name=$1 returning id",[path],'storage.object.delete_many')).rows.length,1);
  await as('doc','select public.finish_unit_document_removal($1)',[id]);
  assert.equal((await db.query('select bytes_deleted_at is not null done from public.documents where id=$1',[id])).rows[0].done,true);
 });
 await check('explicit owner opt-in; actual link/role revoke stops caller RPC with unchanged session',async()=>{
  id=(await as('doc',"select public.prepare_unit_document($1,$2,'owners.pdf','application/pdf',9,$3,'owners',$4) id",[scope.A,unit.A,digest,randomUUID()])).rows[0].id;
  path=`${scope.A}/${unit.A}/${id}.pdf`;await as('doc',"insert into storage.objects(bucket_id,name,metadata) values('unit-private-files',$1,$2)",[path,{size:9,mimetype:'application/pdf'}],'storage.object.upload');await as('doc','select public.complete_unit_document($1)',[id]);
  assert.equal((await authz('owner',id)).rows.length,1);const session=f.session.owner;
  await as('A',"select public.revoke_owner_link($1,$2,'Synthetic evidence','Synthetic revoke')",[scope.A,f.link]);assert.equal((await authz('owner',id)).rows.length,0);assert.equal(f.session.owner,session);
  await as('orgA','select public.revoke_staff_role($1)',[f.docRole]);assert.equal((await authz('doc',id)).rows.length,0);
 });
 await mkdir('.local/unit-file-download-qa',{recursive:true});await writeFile('.local/unit-file-download-qa/db.json',JSON.stringify({status:'PASS',groups,migrations:f.migrations.length,hosted:false,scope:'PGlite PostgreSQL with managed schemas and operation-name fixtures; not Storage/S3 runtime'},null,2));
}finally{await db.close();}
