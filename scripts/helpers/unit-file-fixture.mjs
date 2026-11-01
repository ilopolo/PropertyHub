// Disposable PostgreSQL policy fixture, not a Supabase Auth/Storage emulator.
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
export async function unitFileFixture(){
 const db=new PGlite({extensions:{btree_gist}});
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema extensions;create schema storage;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,is_anonymous boolean default false,raw_app_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets,name text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;
 grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to anon,authenticated;
 create function storage.allow_only_operation(operation text) returns boolean language sql stable as $$select current_setting('storage.operation',true)='storage.'||operation$$;
 alter default privileges in schema public grant all on tables to anon,authenticated;
 alter default privileges in schema public grant execute on functions to anon,authenticated;`);
 const migrations=(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
 for(const file of migrations)await db.exec('begin;'+await readFile('supabase/migrations/'+file,'utf8')+'commit;');
 const auth={},profile={},scope={},unit={},person={},org={},session={};
 const as=async(label,sql,args=[],operation='')=>{
  await db.exec('set role '+(label==='anon'?'anon':'authenticated'));
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('storage.operation',$2,false)",[auth[label]||'',operation]);
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:auth[label],session_id:session[label]})]);
  try{return await db.query(sql,args);}finally{await db.exec('reset role');}
 };
 for(const label of ['platform','orgA','orgB','A','B','doc','owner','pending']){auth[label]=randomUUID();session[label]=randomUUID();await db.query('insert into auth.users(id,email_confirmed_at) values($1,now())',[auth[label]]);await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session[label],auth[label]]);profile[label]=(await as(label,'select public.ensure_profile($1) id',['Synthetic '+label])).rows[0].id;}
 await db.query('select private.bootstrap_platform_admin($1)',[auth.platform]);
 const today=(await db.query("select (now() at time zone 'Europe/Sofia')::date::text d")).rows[0].d;
 for(const label of ['A','B']){
  const request=(await as('org'+label,"insert into public.access_requests(request_kind,requester_profile_id,request_payload) values('organization_onboarding',$1,$2) returning id",[profile['org'+label],{name:'Synthetic '+label,organization_kind:'self_managed'}])).rows[0].id;
  org[label]=(await as('platform',"select public.activate_organization($1,1,'Synthetic source') id",[request])).rows[0].id;
  const setup=(await as('org'+label,'select public.request_scope_setup($1,$2,$3) id',[org[label],auth[label],'Synthetic scope '+label])).rows[0].id;
  scope[label]=(await as(label,"select public.complete_scope_setup($1,'Synthetic address',null,'document','Synthetic setup',$2) id",[setup,today])).rows[0].id;
  unit[label]=(await as(label,"select public.create_unit($1,'03','apartment',source_kind=>'document',source_reference=>'Synthetic unit',known_from=>$2) id",[scope[label],today])).rows[0].id;
  person[label]=(await as(label,"select public.save_scoped_person($1,null,0,'physical',$2,null,null,'active','document','Synthetic identity',$3) id",[scope[label],'Synthetic owner '+label,today])).rows[0].id;
  await as(label,"select public.verify_scoped_person($1,$2,1,'Synthetic checked')",[scope[label],person[label]]);
  const ids=(await as(label,"select public.apply_ownership_changes($1,$2,$3,$4,'Synthetic ownership','document','Synthetic ownership source',$5,'Only known from supplied date') ids",[scope[label],unit[label],randomUUID(),JSON.stringify([{person_id:person[label],fraction:'1',valid_from:today,valid_to:null}]),today])).rows[0].ids;
  await as(label,"select public.review_ownership($1,$2,$3,$4,'Synthetic checked')",[scope[label],unit[label],ids[0],today]);
 }
 const verifier=(await as('A',"select id from public.user_roles where scope_id=$1 and role_code='manager'",[scope.A])).rows[0].id;
 await as('orgA',"select public.set_owner_verifier($1,true,'Synthetic verifier')",[verifier]);
 const link=(await as('A','select public.confirm_owner_link($1,$2,$3,1,$4,$5,$6) id',[scope.A,auth.owner,person.A,'Synthetic evidence','Synthetic identity basis',randomUUID()])).rows[0].id;
 const docRole=(await as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['read_registry','manage_documents']) id",[org.A,auth.doc,scope.A])).rows[0].id;
 return {db,as,auth,profile,scope,unit,person,org,session,link,docRole,migrations};
 }catch(error){await db.close();throw error;}
}
