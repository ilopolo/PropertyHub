import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
// Disposable PostgreSQL fixtures, not new hosted Auth accounts or a rerun of unrelated suites.
const db=new PGlite({extensions:{btree_gist}});let groups=0;
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema extensions;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,is_anonymous boolean not null default false,raw_app_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 alter default privileges in schema public grant all on tables to anon,authenticated;
 alter default privileges in schema public grant execute on functions to anon,authenticated;`);
 const files=(await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort();
 for(const file of files)await db.exec('begin;'+await readFile('supabase/migrations/'+file,'utf8')+'commit;');
 console.log(`APPLIED: ${files.length} local migrations in disposable PostgreSQL; occupancy assertions only.`);
 const auth={},profile={},scope={},unit={},person={A:[],B:[]};
 for(const label of ['platform','orgA','orgB','A','B','pending','controller']){auth[label]=randomUUID();await db.query('insert into auth.users(id,email_confirmed_at) values($1,now())',[auth[label]]);}
 const as=async(label,sql,params=[])=>{await db.exec('set role '+(label==='anon'?'anon':'authenticated'));await db.query("select set_config('request.jwt.claim.sub',$1,false)",[auth[label]||'']);try{return await db.query(sql,params);}finally{await db.exec('reset role');}};
 for(const label of Object.keys(auth))profile[label]=(await as(label,"select public.ensure_profile($1) id",['Synthetic '+label])).rows[0].id;
 await db.query('select private.bootstrap_platform_admin($1)',[auth.platform]);
 for(const label of ['A','B']){
  const req=(await as('org'+label,"insert into public.access_requests(request_kind,requester_profile_id,request_payload) values('organization_onboarding',$1,$2) returning id",[profile['org'+label],{name:'Synthetic '+label,organization_kind:'self_managed'}])).rows[0].id;
  const org=(await as('platform',"select public.activate_organization($1,1,'Synthetic setup') id",[req])).rows[0].id;
  const setup=(await as('org'+label,'select public.request_scope_setup($1,$2,$3) id',[org,auth[label],'Synthetic scope'])).rows[0].id;
  scope[label]=(await as(label,"select public.complete_scope_setup($1,'Synthetic address',null,'declaration','Synthetic source',(now() at time zone 'Europe/Sofia')::date) id",[setup])).rows[0].id;
  unit[label]=(await as(label,"select public.create_unit($1,'03','apartment',source_kind=>'declaration',source_reference=>'Synthetic source',known_from=>(now() at time zone 'Europe/Sofia')::date) id",[scope[label]])).rows[0].id;
  for(let i=0;i<(label==='A'?2:1);i++)person[label].push((await as(label,"select public.save_scoped_person($1,null,0,'physical',$2,null,null,'active','declaration','Synthetic source',(now() at time zone 'Europe/Sofia')::date) id",[scope[label],'Synthetic '+label+i])).rows[0].id);
  if(label==='A')await as('orgA',"select public.assign_staff_role($1,$2,$3,'controller',array['read_registry'])",[org,auth.controller,scope.A]);
 }
 const today=(await db.query("select (now() at time zone 'Europe/Sofia')::date::text d")).rows[0].d;
 const tomorrow=(await db.query('select ($1::date+1)::text d',[today])).rows[0].d;
 const sql="select public.apply_occupancy_changes($1,$2,$3,$4::jsonb,'Synthetic occupancy change','document','Synthetic occupancy source',$5,'Known only from supplied date; no invented earlier history') ids";
 const apply=(changes,label='A',key=randomUUID(),s=scope[label],u=unit[label])=>as(label,sql,[s,u,key,JSON.stringify(changes),today]);
 const aggregate=(units,target=null,from=today,to=null)=>({count_mode:'aggregate',occupant_kind:'aggregate',person_id:null,units,target,valid_from:from,valid_to:to});
 const individual=(pid,kind='other_resident',target=null,from=today,to=null)=>({count_mode:'individual',occupant_kind:kind,person_id:pid,units:'1',target,valid_from:from,valid_to:to});
 const read=async(label='A',date=today,s=scope[label],u=unit[label])=>(await as(label,'select public.read_occupancy($1,$2,$3) value',[s,u,date])).rows[0].value;
 const deny=fn=>assert.rejects(fn,e=>['42501','23514','23505','23P01','23503','23502','22000','22007','22008','22P02'].includes(e.code));
 const review=(target=null,label='A',date=today)=>as(label,"select public.review_occupancy($1,$2,$3,$4,'Synthetic declaration reviewed')",[scope[label],unit[label],target,date]);
 const check=async(name,fn)=>{await fn();groups++;console.log('PASS: '+name);};
 let unknown,zero,positive,people;
 await check('missing and unknown counts are null, never default zero; unknown cannot be verified',async()=>{
  assert.equal((await read()).count_value,null);assert.equal((await read()).applicable_count,0);
  unknown=(await apply([aggregate(null)])).rows[0].ids[0];const data=await read();assert.equal(data.count_value,null);assert.equal(data.unknown_count,1);
  await deny(()=>review(unknown));await deny(()=>review());
 });
 await check('declared zero is separate from reviewed zero; idempotent exact packet; changed payload refused',async()=>{
  const key=randomUUID(),changes=[aggregate('0',unknown)];zero=(await apply(changes,'A',key)).rows[0].ids[0];
  assert.equal((await apply(changes,'A',key)).rows[0].ids[0],zero);await deny(()=>apply([aggregate('2',unknown)],'A',key));
  assert.equal((await read()).count_value,'0.0000');assert.equal((await read()).set_reviewed,false);
  await review(zero);assert.equal((await read()).set_reviewed,false);await review();assert.equal((await read()).set_reviewed,true);
  assert.equal((await read()).records.find(r=>r.id===unknown).household_units,null);
 });
 await check('reviewed zero correction preserves history and invalidates set review',async()=>{
  positive=(await apply([aggregate('2',zero)])).rows[0].ids[0];const data=await read();assert.equal(data.count_value,'2.0000');assert.equal(data.set_reviewed,false);
  assert.equal(data.records.find(r=>r.id===zero).verification_status,'verified');assert.equal(data.records.find(r=>r.id===zero).record_state,'superseded');
  assert.equal(data.records.find(r=>r.id===positive).verification_status,'needs_review');await deny(()=>apply([aggregate('1',zero)]));
 });
 await check('aggregate and individual overlap, duplicate aggregate, fractional counts and invalid periods refused atomically',async()=>{
  await deny(()=>apply([individual(person.A[0])]));await deny(()=>apply([aggregate('1')]));
  await deny(()=>apply([aggregate('0.5',positive)]));await deny(()=>apply([aggregate('-1',positive)]));await deny(()=>apply([aggregate('1',positive,tomorrow,today)]));
  assert.equal((await read()).records.find(r=>r.id===positive).record_state,'current');assert.equal((await read()).count_value,'2.0000');
 });
 await check('atomic aggregate-to-individual switch; owner/user/tenant/resident never summed twice for same person',async()=>{
  people=(await apply([{target:positive,void:true},individual(person.A[0],'owner_resident'),individual(person.A[1],'right_of_use_resident')])).rows[0].ids;
  assert.equal((await read()).count_value,'2.0000');await deny(()=>apply([individual(person.A[0],'tenant_resident')]));
  const data=await read();assert.equal(data.records.filter(r=>r.record_state==='current').length,2);
  assert.deepEqual(data.records.filter(r=>r.record_state==='current').map(r=>r.occupant_kind).sort(),['owner_resident','right_of_use_resident']);
  for(const target of people)await review(target);await review();assert.equal((await read()).set_reviewed,true);
 });
 await check('adjacent periods and atomic corrections preserve originals; no unknown outside coverage',async()=>{
  const ids=(await apply([individual(person.A[0],'owner_resident',people[0],today,tomorrow),individual(person.A[1],'right_of_use_resident',people[1],today,tomorrow),aggregate(null,null,tomorrow)])).rows[0].ids;
  assert.equal((await read()).count_value,'2.0000');assert.equal((await read('A',tomorrow)).count_value,null);
  assert.equal((await read()).records.find(r=>r.id===people[0]).record_state,'superseded');
  await deny(()=>apply([individual(person.A[0],'tenant_resident',null,'2000-01-01')]));
  assert.equal((await read()).records.find(r=>r.id===ids[0]).valid_to,tomorrow);
 });
 await check('cross scope/person, admin/pending/anonymous and direct mutations denied; controller can only read',async()=>{
  for(const label of ['B','pending','orgA','platform'])await deny(()=>apply([aggregate('1')],label,randomUUID(),scope.A,unit.A));
  await deny(()=>apply([individual(person.B[0])]));await deny(()=>read('B',today,scope.A,unit.A));
  assert.equal((await as('B','select * from public.occupancy_periods')).rows.length,0);
  assert.equal((await read('controller',today,scope.A,unit.A)).count_value,'2.0000');await deny(()=>apply([aggregate('1')],'controller',randomUUID(),scope.A,unit.A));
  await deny(()=>review(null,'controller'));await deny(()=>as('A','update public.occupancy_periods set household_units=0'));await deny(()=>as('A','delete from public.occupancy_periods'));
  await deny(()=>as('anon','select * from public.occupancy_periods'));await deny(()=>as('anon','select public.read_occupancy($1,$2,$3)',[scope.A,unit.A,today]));
 });
 await check('no ownership/account link/access or financial side effects',async()=>{
  assert.equal((await db.query('select count(*)::int n from public.ownership_periods')).rows[0].n,0);
  assert.equal((await as('pending','select * from public.user_roles')).rows.length,0);
  assert.equal((await db.query("select to_regclass('public.account_person_links') is null absent")).rows[0].absent,true);
  for(const t of ['occupancy_periods','occupancy_set_reviews'])assert.equal((await db.query("select has_table_privilege('anon',$1,'SELECT,INSERT,UPDATE,DELETE') allowed",['public.'+t])).rows[0].allowed,false);
 });
 await check('legal entities cannot be counted; person revision changes invalidate review until corrected',async()=>{
  const legal=(await as('B',"select public.save_scoped_person($1,null,0,'legal','Synthetic legal entity',null,null,'active','document','Synthetic legal source',$2) id",[scope.B,today])).rows[0].id;
  await assert.rejects(()=>apply([individual(legal)],'B'),e=>e.code==='23514'&&e.message.includes('Physical person'));
  const active=(await read()).records.filter(r=>r.record_state==='current'&&r.count_mode==='individual');
  for(const r of active)await review(r.id);await review();assert.equal((await read()).set_reviewed,true);
  await as('A',"select public.save_scoped_person($1,$2,1,'physical','Synthetic corrected name',null,null,'active','document','Synthetic identity correction',$3)",[scope.A,person.A[0],today]);
  let data=await read();assert.equal(data.set_reviewed,false);assert.equal(data.subject_conflict_count,1);await deny(()=>review());
  const old=active.find(r=>r.person_id===person.A[0]);await deny(()=>review(old.id));
  const corrected=(await apply([individual(person.A[0],old.occupant_kind,old.id,old.valid_from,old.valid_to)])).rows[0].ids[0];await review(corrected);await review();data=await read();assert.equal(data.subject_conflict_count,0);assert.equal(data.set_reviewed,true);
 });
 console.log(`PASS: ${groups} targeted occupancy PostgreSQL groups; no unrelated Auth/password/ownership suites rerun.`);
}catch(error){console.error(`FAIL: occupancy local DB ${error.code||error.name}: ${error.message}`);process.exitCode=1;}
finally{await db.close();}
