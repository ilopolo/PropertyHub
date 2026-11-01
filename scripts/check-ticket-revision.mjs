// Corrective candidate only: actual PostgreSQL/RLS and SDK/local HTTP, not hosted PostgREST.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {unitFileFixture} from './helpers/unit-file-fixture.mjs';
import {startUnitFileQaServer} from './helpers/unit-file-qa-server.mjs';
const source=await readFile('supabase/migrations/20261101141944_owner_signals.sql','utf8'),fix=await readFile('supabase/migrations/20261101180527_ticket_revision_conflict.sql','utf8');
assert.equal(createHash('sha256').update(source.replaceAll('\r\n','\n')).digest('hex'),'513a58cfe1f4c4211fb942c9d5360ffe6ba6ea00a696495882a911670da6afd9');
const start=source.indexOf('create function private.change_ticket_status('),end=source.indexOf('create function public.change_ticket_status(',start);
assert.equal(fix.slice(fix.indexOf('create or replace function')).trim().replaceAll('\r\n','\n'),source.slice(start,end).trim().replace('create function','create or replace function').replace("errcode='40001'","errcode='PT409'").replaceAll('\r\n','\n'));
const f=await unitFileFixture(),password=randomUUID();let api,c;
try{
 await f.as('orgA','select public.revoke_staff_role($1)',[f.docRole]);await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['manage_tickets'])",[f.org.A,f.auth.doc,f.scope.A]);
 const id=(await f.as('owner',"select public.create_ticket($1,'Synthetic revision','Synthetic description') id",[f.unit.A])).rows[0].id;
 await f.as('doc',"select public.change_ticket_status($1,1,'accepted','Synthetic accepted')",[id]);
 const before=await f.db.query('select to_jsonb(w) row from public.work_items w where id=$1',[id]);
 await assert.rejects(f.as('doc',"select public.change_ticket_status($1,1,'in_progress','Synthetic stale')",[id]),e=>e.code==='PT409');
 for(const label of ['owner','B'])await assert.rejects(f.as(label,"select public.change_ticket_status($1,1,'in_progress','Synthetic denied')",[id]),e=>e.code==='42501');
 api=await startUnitFileQaServer(f,password);c=createClient('http://127.0.0.1:54331','sb_publishable_local_qa',{auth:{persistSession:false,autoRefreshToken:false}});assert.equal((await c.auth.signInWithPassword({email:'doc@propertyhub.invalid',password})).error,null);
 const stale=await c.rpc('change_ticket_status',{item:id,expected_revision:1,next_status:'in_progress',note:'Synthetic stale'});assert.equal(stale.error?.code,'PT409');
 assert.deepEqual((await f.db.query('select to_jsonb(w) row from public.work_items w where id=$1',[id])).rows,before.rows);assert.equal((await f.db.query('select count(*)::int n from public.work_item_events where item_id=$1',[id])).rows[0].n,2);
 assert.equal((await c.rpc('change_ticket_status',{item:id,expected_revision:2,next_status:'in_progress',note:'Synthetic current'})).error,null);
 assert.equal((await f.db.query('select revision from public.work_items where id=$1',[id])).rows[0].revision,3);
 await mkdir('.local/tickets-qa',{recursive:true});await writeFile('.local/tickets-qa/revision-fix-local.json',JSON.stringify({pass:true,hosted:false,checks:['original applied SQL hash unchanged','corrective body changes only CREATE OR REPLACE and PT409','current update works; stale PT409 via PostgreSQL and SDK/local HTTP','foreign/owner still denied; stale leaves record/events unchanged'],http409HostedVerified:false},null,2));console.log('PASS: targeted ticket revision corrective candidate; hosted HTTP409 remains unverified.');
}finally{c?.auth.stopAutoRefresh();await api?.close();await f.db.close();}
