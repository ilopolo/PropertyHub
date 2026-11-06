import{randomUUID}from'node:crypto';import{readFile}from'node:fs/promises';import{unitFileFixture}from'./unit-file-fixture.mjs';
export async function registryCsvFixture(){const f=await unitFileFixture({beforeMigration:'20261105131317'});try{
 await f.db.exec('begin;'+await readFile('supabase/migrations/20261106170356_registry_units_csv.sql','utf8')+'commit;');
 f.as=async(label,sql,args=[])=>{await f.db.exec('set role '+(label==='anon'?'anon':'authenticated'));await f.db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[f.auth[label]||'',JSON.stringify({sub:f.auth[label],session_id:f.session[label]})]);let error;try{return await f.db.query(sql,args);}catch(e){error=e;throw e;}finally{try{await f.db.exec('reset role');}catch(e){if(!error)throw e;}}};
 const today=(await f.db.query('select current_date::text d')).rows[0].d;f.today=today;
 const old=(await f.as('A','select id from public.user_roles where scope_id=$1 and valid_to is null',[f.scope.A])).rows;for(const r of old)await f.as('orgA','select public.revoke_staff_role($1)',[r.id]);
 f.importRole=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['read_registry','manage_registry','prepare_registry_import','commit_registry_import','export_registry']) id",[f.org.A,f.auth.A,f.scope.A])).rows[0].id;
 await f.as('orgA','select public.revoke_staff_role($1)',[f.docRole]);
 f.exportRole=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'controller',array['read_registry','export_registry']) id",[f.org.A,f.auth.doc,f.scope.A])).rows[0].id;
 f.commitRole=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['read_registry','manage_registry','commit_registry_import']) id",[f.org.A,f.auth.B,f.scope.A])).rows[0].id;
 f.row=(key='unit-04',extra={})=>({source_system:'synthetic-p6a',external_key:key,unit_number:key,unit_type:'apartment',floor:'',area:'',source_kind:'document',source_reference:'Синтетичен регистър, "CSV"\nвтори ред',known_from:today,...extra});
 f.stage=async(rows,who='A',scope=f.scope.A,key=randomUUID())=>(await f.as(who,'select public.stage_registry_units($1,$2,$3) data',[scope,JSON.stringify(rows),key])).rows[0].data;
 f.inspect=async(job,who='A')=>(await f.as(who,'select public.registry_units_import_job($1) data',[job.id||job])).rows[0].data;
 f.commit=async(job,who='A',key=randomUUID(),revision=job.revision,hash=job.source_hash)=>(await f.as(who,'select public.commit_registry_units($1,$2,$3,$4) data',[job.id,revision,hash,key])).rows[0].data;
 return f;
}catch(e){await f.db.close();throw e;}}
