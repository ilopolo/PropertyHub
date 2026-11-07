import {readFile} from 'node:fs/promises';
import {unitFileFixture} from './unit-file-fixture.mjs';
export const orgAdminMigration='20261107091138_org_admin_lifecycle.sql';
export async function orgAdminFixture(){
 const f=await unitFileFixture({beforeMigration:'20261105131317'});
 try{
  for(const file of ['20261106170356_registry_units_csv.sql','20261106185945_registry_csv_current_rights.sql','20261106204645_current_write_access_guards.sql',orgAdminMigration])await f.db.exec('begin;'+await readFile('supabase/migrations/'+file,'utf8')+'commit;');
  f.as=async(who,sql,args=[])=>{await f.db.exec('set role '+(who==='anon'?'anon':'authenticated'));await f.db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[f.auth[who]||'',JSON.stringify({sub:f.auth[who],session_id:f.session[who]})]);let error;try{return await f.db.query(sql,args);}catch(e){error=e;throw e;}finally{try{await f.db.exec('reset role');}catch(e){if(!error)throw e;}}};
  f.directory=async(who='orgA',org=f.org.A)=>(await f.as(who,'select public.org_admin_directory($1) data',[org])).rows[0].data;
  f.member=async who=>(await f.db.query('select id from public.organization_memberships where organization_id=$1 and profile_id=$2',[f.org.A,f.profile[who]])).rows[0].id;
  f.adminRole=async who=>(await f.db.query("select r.id from public.user_roles r join public.organization_memberships m on m.id=r.membership_id where r.profile_id=$1 and m.organization_id=$2 and r.role_code='org_admin' and r.valid_to is null",[f.profile[who],f.org.A])).rows[0]?.id;
  f.operation=async({who='orgA',org=f.org.A,key,operation='grant',role=null,member=null,revision,ends=null,reason='Synthetic local authority review'})=>(await f.as(who,'select public.org_admin_operation($1,$2,$3,$4,$5,$6,$7,$8) data',[org,key,operation,role,member,revision,ends,reason])).rows[0].data;
  return f;
 }catch(e){await f.db.close();throw e;}
}
