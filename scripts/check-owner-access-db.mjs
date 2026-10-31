import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
const db=new PGlite({extensions:{btree_gist}}),passed=[];
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema extensions;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,is_anonymous boolean default false,raw_app_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 alter default privileges in schema public grant all on tables to anon,authenticated;
 alter default privileges in schema public grant execute on functions to anon,authenticated;`);
 const files=(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
 for(const file of files)await db.exec('begin;'+await readFile('supabase/migrations/'+file,'utf8')+'commit;');
 const auth={},profile={},scope={},unit={},person={},org={};
 for(const label of ['platform','orgA','orgB','A','B','owner','pending']){auth[label]=randomUUID();await db.query('insert into auth.users(id,email_confirmed_at) values($1,now())',[auth[label]]);}
 const as=async(label,sql,args=[])=>{await db.exec('set role '+(label==='anon'?'anon':'authenticated'));await db.query("select set_config('request.jwt.claim.sub',$1,false)",[auth[label]||'']);try{return await db.query(sql,args);}finally{await db.exec('reset role');}};
 const deny=async(fn,codes=['42501','23514','23505'])=>{let caught;try{await fn();}catch(e){caught=e;}assert.ok(caught,'Expected refusal');assert.ok(codes.includes(caught.code),'Unexpected SQL code: '+caught.code);};
 const check=async(name,fn)=>{await fn();passed.push(name);console.log('PASS: '+name);};
 for(const label of Object.keys(auth))profile[label]=(await as(label,"select public.ensure_profile($1) id",['Synthetic '+label])).rows[0].id;
 await db.query('select private.bootstrap_platform_admin($1)',[auth.platform]);
 const today=(await db.query("select (now() at time zone 'Europe/Sofia')::date::text d")).rows[0].d;
 for(const label of ['A','B']){
  const request=(await as('org'+label,"insert into public.access_requests(request_kind,requester_profile_id,request_payload) values('organization_onboarding',$1,$2) returning id",[profile['org'+label],{name:'Synthetic '+label,organization_kind:'self_managed'}])).rows[0].id;
  org[label]=(await as('platform',"select public.activate_organization($1,1,'Synthetic org source') id",[request])).rows[0].id;
  const setup=(await as('org'+label,'select public.request_scope_setup($1,$2,$3) id',[org[label],auth[label],'Synthetic scope '+label])).rows[0].id;
  scope[label]=(await as(label,"select public.complete_scope_setup($1,'Synthetic address',null,'document','Synthetic setup',$2) id",[setup,today])).rows[0].id;
  unit[label]=(await as(label,"select public.create_unit($1,'03','apartment',source_kind=>'document',source_reference=>'Synthetic unit',known_from=>$2) id",[scope[label],today])).rows[0].id;
  person[label]=(await as(label,"select public.save_scoped_person($1,null,0,'physical',$2,null,null,'active','document','Synthetic identity',$3) id",[scope[label],'Synthetic owner '+label,today])).rows[0].id;
  await as(label,"select public.verify_scoped_person($1,$2,1,'Synthetic identity checked')",[scope[label],person[label]]);
  const changes=[{person_id:person[label],fraction:'1',valid_from:today,valid_to:null}];
  const ids=(await as(label,"select public.apply_ownership_changes($1,$2,$3,$4,'Synthetic ownership','document','Synthetic ownership source',$5,'Known only from supplied date') ids",[scope[label],unit[label],randomUUID(),JSON.stringify(changes),today])).rows[0].ids;
  await as(label,"select public.review_ownership($1,$2,$3,$4,'Synthetic row checked')",[scope[label],unit[label],ids[0],today]);
 }
 const role=(await as('A',"select id from public.user_roles where scope_id=$1 and role_code='manager'",[scope.A])).rows[0].id;
 const grant=(enabled=true)=>as('orgA',"select public.set_owner_verifier($1,$2,'Synthetic delegation basis')",[role,enabled]);
 const key=randomUUID();
 const confirm=(label='A',target=auth.owner,p=person.A,s=scope.A,k=key,revision=1)=>as(label,'select public.confirm_owner_link($1,$2,$3,$4,$5,$6,$7) id',[s,target,p,revision,'Synthetic identity and ownership evidence','Synthetic verification basis',k]);
 const owned=async(label='owner')=>(await as(label,'select * from public.my_owned_units()')).rows;
 await check('no inherited capability from registry, org or platform',async()=>{for(const label of ['A','orgA','platform','pending'])await deny(()=>confirm(label));assert.deepEqual(await owned(),[]);});
 await check('explicit other-manager delegation; self grant and generic bypass denied',async()=>{
  await deny(()=>as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['read_registry','verify_owner_access'])",[org.A,auth.orgA,scope.A]));
  await deny(()=>as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['read_registry','verify_owner_access'])",[org.A,auth.owner,scope.A]));
  await deny(()=>as('B',"select public.set_owner_verifier($1,true,'Foreign delegation')",[role]));await grant();
 });
 await check('self confirmation, foreign scope/person and stale evidence refused',async()=>{
  await deny(()=>confirm('A',auth.A));await deny(()=>confirm('A',auth.owner,person.B));await deny(()=>confirm('A',auth.owner,person.B,scope.B));await deny(()=>confirm('A',auth.owner,person.A,scope.A,randomUUID(),2));
 });
 let id;
 await check('exact owner projection, no operational grants, replay and duplicate identity',async()=>{
  id=(await confirm()).rows[0].id;assert.equal((await confirm()).rows[0].id,id);const rows=await owned();assert.deepEqual(rows.map(r=>r.unit_id),[unit.A]);assert.equal(Object.keys(rows[0]).length,7);
  assert.equal((await as('owner','select * from public.user_roles')).rows.length,0);assert.equal((await as('owner','select * from public.units')).rows.length,0);assert.equal((await as('owner','select * from public.persons')).rows.length,0);
  await deny(()=>confirm('A',auth.pending,person.A,scope.A,randomUUID()));assert.deepEqual(await owned('pending'),[]);
 });
 await check('direct writes and unauthorized history denied; verifier history retained',async()=>{
  await deny(()=>as('owner','update public.account_person_links set profile_id=$1 where id=$2',[profile.owner,id]));await deny(()=>as('owner','delete from public.account_person_links where id=$1',[id]));
  assert.equal((await as('owner','select * from public.account_person_links')).rows.length,0);assert.equal((await as('A','select * from public.account_person_links')).rows.length,1);
 });
 const revoke=label=>as(label,"select public.revoke_owner_link($1,$2,'Synthetic revocation evidence','Synthetic withdrawal')",[scope.A,id]);
 await check('revoked verifier loses ability in same session, existing owner identity independent',async()=>{
  await grant(false);await deny(()=>revoke('A'));assert.equal((await owned()).length,1);await grant();
 });
 await check('link revocation removes current access in same session; replay does not restore',async()=>{
  await deny(()=>revoke('owner'));await deny(()=>revoke('B'));await revoke('A');assert.deepEqual(await owned(),[]);await confirm();assert.deepEqual(await owned(),[]);
  const history=(await as('A','select * from public.account_person_links')).rows[0];assert.equal(history.verified_by,profile.A);assert.equal(history.revoked_by,profile.A);assert.ok(history.revoked_at);
  await deny(()=>db.query('delete from public.account_person_links where id=$1',[id]));
 });
 await check('fresh link is a new history entry; person revision invalidates current projection',async()=>{
  const next=(await confirm('A',auth.owner,person.A,scope.A,randomUUID())).rows[0].id;assert.notEqual(next,id);assert.equal((await owned()).length,1);
  await as('A',"select public.save_scoped_person($1,$2,1,'physical','Synthetic revised identity',null,null,'active','document','New identity source',$3)",[scope.A,person.A,today]);assert.deepEqual(await owned(),[]);
 });
 await check('anonymous functions denied and history audit exists',async()=>{await deny(()=>as('anon','select * from public.my_owned_units()'));const events=(await db.query("select action from public.audit_events where action like '%owner%'")).rows;assert.ok(events.length>=6);});
 await mkdir('.local/owner-access-qa',{recursive:true});await writeFile('.local/owner-access-qa/local-report.json',JSON.stringify({status:'PASS',migrations:files.length,groups:passed,hosted:false},null,2));
 console.log(`PASS: ${passed.length} targeted owner-access PostgreSQL groups; no unrelated Auth/registry suites rerun.`);
}catch(error){console.error(`FAIL: owner-access PostgreSQL ${error.code||error.name}: ${error.message}`);process.exitCode=1;}
finally{await db.close();}
