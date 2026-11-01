// SDK/PostgREST-shaped local transport + real PostgreSQL grants/RLS, not hosted proof.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {unitFileFixture} from './helpers/unit-file-fixture.mjs';
import {startUnitFileQaServer} from './helpers/unit-file-qa-server.mjs';
const f=await unitFileFixture(),password=randomUUID(),clients=[];let api;
try{
 await f.as('orgA','select public.revoke_staff_role($1)',[f.docRole]);
 await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['manage_tickets'])",[f.org.A,f.auth.doc,f.scope.A]);
 api=await startUnitFileQaServer(f,password);
 async function client(label){const c=createClient('http://127.0.0.1:54331','sb_publishable_local_qa',{auth:{persistSession:false,autoRefreshToken:false}});clients.push(c);if(label){const r=await c.auth.signInWithPassword({email:label.toLowerCase()+'@propertyhub.invalid',password});assert.equal(r.error,null);}return c;}
 const owner=await client('owner'),staff=await client('doc'),foreign=await client('B'),anon=await client();
 const r=await owner.rpc('create_ticket',{unit:f.unit.A,title:'API synthetic',description:'API safe content'});assert.equal(r.error,null);const id=r.data;
 const read=await staff.rpc('ticket_feed');assert.equal(read.error,null);assert.equal(read.data[0].unit_number,'03');assert.equal(read.data[0].can_manage,true);
 for(const [c,name,args,code]of [
  [anon,'create_ticket',{unit:f.unit.A,title:'bad',description:'bad'},'42501'],
  [foreign,'create_ticket',{unit:f.unit.A,title:'bad',description:'bad'},'42501'],
  [owner,'create_ticket',{unit:f.unit.B,title:'bad',description:'bad'},'42501'],
  [owner,'change_ticket_status',{item:id,expected_revision:1,next_status:'accepted',note:'bad'},'42501'],
  [foreign,'change_ticket_status',{item:id,expected_revision:1,next_status:'accepted',note:'bad'},'42501'],
  [staff,'change_ticket_status',{item:id,expected_revision:1,next_status:'completed',note:'skip'},'23514'],
 ]){const result=await c.rpc(name,args);assert.equal(result.error?.code,code);}
 const forged=await owner.rpc('create_ticket',{unit:f.unit.A,title:'forged',description:'forged',reporter_profile_id:f.profile.pending,scope_id:f.scope.B,status:'completed'});assert.ok(forged.error);
 assert.deepEqual((await foreign.rpc('ticket_feed')).data,[]);
 assert.equal((await staff.rpc('change_ticket_status',{item:id,expected_revision:1,next_status:'accepted',note:'API accepted'})).error,null);
 assert.equal((await staff.rpc('change_ticket_status',{item:id,expected_revision:1,next_status:'in_progress',note:'stale'})).error?.code,'40001');
 const records=(await f.db.query('select * from public.work_items')).rows;assert.equal(records.length,1);assert.equal(records[0].status,'accepted');assert.equal(records[0].reporter_profile_id,f.profile.owner);assert.equal(records[0].scope_id,f.scope.A);assert.equal((await f.db.query('select * from public.work_item_events')).rows.length,2);
 await mkdir('.local/tickets-qa',{recursive:true});await writeFile('.local/tickets-qa/api.json',JSON.stringify({pass:true,hosted:false,checks:['SDK HTTP create/feed/transition persisted','anonymous/foreign scope/foreign author mutation denied','forged extra RPC arguments refused','invalid transition and stale revision refused','actual rows and events checked']},null,2));console.log('PASS tickets SDK/local HTTP API: 5 groups');
}finally{for(const c of clients)c.auth.stopAutoRefresh();await api?.close();await f.db.close();}
