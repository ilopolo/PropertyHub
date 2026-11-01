import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {unitFileFixture} from './helpers/unit-file-fixture.mjs';
const f=await unitFileFixture();
try{
 const id=randomUUID(),path=`${f.scope.A}/${f.unit.A}/${id}.pdf`;
 await f.as('doc',"select public.prepare_unit_document($1,$2,'operations.pdf','application/pdf',10,$3,'owners',$4)",[f.scope.A,f.unit.A,'0'.repeat(64),id]);
 await f.as('doc',"insert into storage.objects(bucket_id,name,metadata) values('unit-private-files',$1,$2)",[path,{mimetype:'application/pdf',size:10}],'storage.object.upload');
 const read=(actor,operation)=>f.as(actor,'select id from storage.objects where name=$1',[path],'storage.'+operation);
 assert.equal((await read('doc','object.get_authenticated')).rows.length,1);assert.equal((await read('owner','object.get_authenticated')).rows.length,0);
 await f.as('doc','select public.complete_unit_document($1)',[id]);
 assert.equal((await read('owner','object.get_authenticated')).rows.length,1);assert.equal((await read('B','object.get_authenticated')).rows.length,0);assert.equal((await read('anon','object.get_authenticated')).rows.length,0);
 for(const op of ['object.get_authenticated_info','object.head_authenticated_info','object.sign','object.sign_many','object.list','object.copy','object.info_public'])assert.equal((await read('owner',op)).rows.length,0);
 await f.as('A',"select public.revoke_owner_link($1,$2,'Synthetic info revocation','Synthetic info revocation')",[f.scope.A,f.link]);
 for(const op of ['object.get_authenticated','object.get_authenticated_info','object.head_authenticated_info'])assert.equal((await read('owner',op)).rows.length,0);
 console.log('PASS: explicit authenticated byte operation enforces current pending/ready/owner rights; CDN info/head/sign/list/copy, foreign/anonymous and revoked identity remain denied.');
}finally{await f.db.close();}
