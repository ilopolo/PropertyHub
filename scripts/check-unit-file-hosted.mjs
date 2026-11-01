import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rename,access,open,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {loadEnvFile} from 'node:process';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createClient} from '@supabase/supabase-js';
import {PROJECT,URL,BUCKET,MAX_BYTES,options,validateFixture,validateJournal,membershipCleanupSql,sha,syntheticPdf,PLAN} from './helpers/unit-file-hosted.mjs';
const active=r=>Date.parse(r.valid_from)<=Date.now()&&(!r.valid_to||Date.now()<Date.parse(r.valid_to));
const ok=result=>{if(result.error)throw Error('API refusal or transport failure');return result.data;};
const refused=(r,codes)=>{assert.ok(r.error,'Expected refusal');if(codes)assert.ok(codes.includes(r.error.code),'Unexpected refusal category');else assert.ok([400,401,403,404,409,413].includes(Number(r.error.status||r.error.statusCode)),'Unexpected Storage/transport failure');};
export async function main(args=process.argv.slice(2)){
 const o=options(args);if(o.phase==='plan'){console.log(JSON.stringify(PLAN,null,2));return;}
 const f=validateFixture(JSON.parse(await readFile(o.fixture,'utf8'))),fixtureHash=sha(Buffer.from(JSON.stringify(f)));
 const existing=o.phase==='setup'?null:validateJournal(JSON.parse(await readFile(o.journal,'utf8')),f);
 if(existing?.phase==='cleaned-history-retained'){console.log('RETAIN: cleanup journal complete; no network request or fresh hosted PASS');return;}
 for(const p of ['.env.local','.env.rls.local','.env.password-policy.local','.env.storage-qa.local'])try{loadEnvFile(p);}catch(e){if(e.code!=='ENOENT')throw Error('Invalid local env file');}
 assert.equal(process.env.VITE_SUPABASE_URL,URL);assert.ok(process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_'),'Publishable key required');
 const clients={},claims={},report=[],markerFor=j=>'Storage QA '+j.run;let j,lock;
 const guardedFetch=(input,init={})=>{assert.equal(new globalThis.URL(typeof input==='string'?input:input.url).origin,URL);return fetch(input,{...init,redirect:'error',signal:init.signal??AbortSignal.timeout(60000)});};
 try{
  await mkdir(dirname(o.journal),{recursive:true});lock=await open(o.journal+'.lock','wx');await lock.writeFile(JSON.stringify({phase:o.phase,startedAt:new Date().toISOString()}));
  if(o.phase==='setup'){
   let exists=true;try{await access(o.journal);}catch(e){if(e.code==='ENOENT')exists=false;else throw e;}assert.ok(!exists,'Journal exists; inspect/cleanup before starting another setup');
   j={project:PROJECT,run:randomUUID(),fixtureHash,startedAt:new Date().toISOString(),roles:[],documents:[],baseline:{},phase:'preflight'};
  }else j=existing;
  const save=async()=>{await mkdir(dirname(o.journal),{recursive:true});await writeFile(o.journal+'.tmp',JSON.stringify(j,null,2));await rename(o.journal+'.tmp',o.journal);};
  for(const label of ['A','B','OWNER']){
   const email=label==='OWNER'?process.env.PASSWORD_QA_EMAIL:process.env[`RLS_${label}_EMAIL`],password=label==='OWNER'?process.env.PASSWORD_QA_PASSWORD:process.env[`RLS_${label}_PASSWORD`];assert.match(email||'',/@propertyhub\.invalid$/);assert.ok(password,'Missing local ordinary-session credential');
   const c=createClient(URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{global:{fetch:guardedFetch},auth:{persistSession:false,autoRefreshToken:false}});clients[label]=c;const auth=ok(await c.auth.signInWithPassword({email,password}));assert.equal(auth.user.id,f.auth[label]);assert.ok(auth.user.email_confirmed_at);claims[label]=auth.session.access_token;
   const p=ok(await c.from('profiles').select('id,status').single());assert.equal(p.id,f.profiles[label]);assert.equal(p.status,'active');
  }
  const {A,B,OWNER}=clients,anon=createClient(URL,process.env.VITE_SUPABASE_PUBLISHABLE_KEY,{global:{fetch:guardedFetch},auth:{persistSession:false,autoRefreshToken:false}}),marker=markerFor(j);
  const rpc=async(c,name,args)=>ok(await c.rpc(name,args));
  const roles=async()=>ok(await B.from('user_roles').select('id,membership_id,scope_id,role_code,permissions,valid_from,valid_to'));
  const documents=()=>rpc(B,'unit_documents',{scope:f.scope,unit:f.unit});
  const check=async(name,fn)=>{j.inFlight=name;await save();await fn();report.push(name);j.passed=[...report];j.inFlight=null;await save();console.log('PASS: '+name);};
  async function grant(){
   assert.ok(!j.roleIntention,'Uncertain role creation: operator reconciliation required; do not retry blindly');
   const current=(await roles()).filter(r=>active(r)&&r.scope_id===f.scope&&r.role_code==='manager');assert.equal(current.length,0,'Existing manager must not be adopted or replaced');
   j.roleIntention=true;await save();const id=await rpc(A,'assign_staff_role',{org:f.org,target_auth_user_id:f.auth.B,scope:f.scope,role:'manager',permissions:['read_registry','manage_documents']});
   const r=(await roles()).find(r=>r.id===id);assert.ok(r&&!j.baseline.roles.includes(r.id));assert.deepEqual(r.permissions,['read_registry','manage_documents']);j.roles.push({id:r.id,membership_id:r.membership_id});j.roleIntention=false;
   if(!j.baseline.memberships.some(m=>m.id===r.membership_id)){if(j.membership)assert.equal(j.membership,r.membership_id);j.membership=r.membership_id;j.membershipOwned=true;}await save();
   await rpc(A,'set_owner_verifier',{role_id:id,enabled:true,note:marker});return id;
  }
  async function ownRole(){
   const r=(await roles()).find(r=>active(r)&&r.scope_id===f.scope&&r.role_code==='manager');
   if(!r)return null;assert.ok(j.roles.some(x=>x.id===r.id&&x.membership_id===r.membership_id),'Unowned active role blocks cleanup');assert.ok(!j.baseline.roles.includes(r.id),'Baseline role cannot be revoked');assert.ok(r.permissions.every(p=>['read_registry','manage_documents','verify_owner_access'].includes(p)));return r;
  }
  async function revokeLink(){
   const links=await rpc(B,'owner_access_records',{scope:f.scope}),link=links.find(l=>l.id===j.link);
   assert.ok(link&&link.profile_id===f.profiles.OWNER&&link.person_id===f.person.id&&link.verification_note===marker,'Link ownership mismatch');
   if(!link.revoked_at)await rpc(B,'revoke_owner_link',{scope:f.scope,link_id:j.link,evidence:marker,note:marker});
   j.linkRevoked=true;await save();
  }
  async function remove(doc){
   const row=ok(await B.from('documents').select('id,scope_id,unit_id,uploader_id,original_filename,status,removed_at,removed_by,removal_note,bytes_deleted_at').eq('id',doc.id).maybeSingle());if(!row){assert.ok(!doc.prepareIntention,'Uncertain prepare request: reconcile final server outcome before cleanup');return;}
   assert.equal(row.scope_id,f.scope);assert.equal(row.unit_id,f.unit);assert.equal(row.uploader_id,f.profiles.B);assert.equal(row.original_filename,doc.filename);
   await rpc(B,'remove_unit_document',{document:doc.id,note:marker});
   ok(await B.storage.from(BUCKET).remove([doc.path]));await rpc(B,'finish_unit_document_removal',{document:doc.id});
   const actual=ok(await B.from('documents').select('status,removed_by,removal_note,removed_at,bytes_deleted_at').eq('id',doc.id).single());assert.equal(actual.status,'removed');assert.equal(actual.removed_by,f.profiles.B);assert.equal(actual.removal_note,marker);assert.ok(actual.removed_at&&actual.bytes_deleted_at);doc.cleaned=true;await save();
  }
  if(o.phase==='setup'){
   // Missing/unapplied RPCs are setup failures, NEVER a successful access denial.
   assert.deepEqual(await rpc(B,'unit_documents',{scope:f.scope,unit:f.unit}),[]);
   const catalog=ok(await A.from('role_permissions').select('role_code,permission_code').eq('permission_code','manage_documents'));assert.ok(catalog.some(r=>r.role_code==='manager'));
   const admin=ok(await A.from('user_roles').select('role_code,membership_id,permissions,valid_from,valid_to')).filter(r=>active(r)&&r.role_code==='org_admin'&&r.permissions.includes('manage_members'));
   const memberships=ok(await A.from('organization_memberships').select('id,organization_id,status,valid_from,valid_to'));assert.ok(admin.some(r=>memberships.some(m=>m.id===r.membership_id&&m.organization_id===f.org&&m.status==='active'&&active(m))));
   const prior=await roles();assert.ok(prior.some(r=>active(r)&&r.scope_id===f.foreignScope));assert.ok(!prior.some(r=>active(r)&&r.scope_id===f.scope));j.baseline.roles=prior.map(r=>r.id);j.baseline.memberships=ok(await B.from('organization_memberships').select('id,organization_id,status'));
   if(!j.baseline.memberships.some(m=>m.organization_id===f.org&&m.status==='active'))assert.ok(process.env.STORAGE_QA_MANAGEMENT_TOKEN||o.externalCleanup,'New membership requires optional operator token or explicit --external-membership-cleanup');
   assert.deepEqual(await rpc(OWNER,'my_owned_units',{}),[]);assert.equal(ok(await OWNER.from('user_roles').select('id')).length,0);
   const person=ok(await A.from('persons').select('id,scope_id,revision,status,verification_status').eq('id',f.person.id).single());assert.equal(person.scope_id,f.scope);assert.equal(person.revision,f.person.revision);assert.equal(person.status,'active');assert.equal(person.verification_status,'verified');
   const ownership=await rpc(A,'read_ownership',{scope:f.scope,unit:f.unit,as_of:new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Sofia'}).format(new Date())});assert.ok(ownership.records.some(r=>r.person_id===f.person.id&&r.record_state==='current'&&r.verification_status==='verified'));
   j.phase='setup-started';j.linkRequest=randomUUID();await save();await grant();
   assert.ok(!(await documents()).some(d=>d.status!=='removed'),'Unit has an existing active file; do not overwrite');
   assert.ok(!(await rpc(B,'owner_access_records',{scope:f.scope})).some(l=>l.person_id===f.person.id&&!l.revoked_at),'Person already linked; do not replace');
   j.linkIntention=true;await save();j.link=await rpc(B,'confirm_owner_link',{scope:f.scope,target_auth_user_id:f.auth.OWNER,person:f.person.id,expected_person_revision:f.person.revision,evidence:marker,note:marker,request_key:j.linkRequest});j.linkIntention=false;await save();
   assert.ok((await rpc(OWNER,'my_owned_units',{})).some(u=>u.unit_id===f.unit&&u.scope_id===f.scope));j.phase='setup-complete';await save();console.log('PASS: setup completed; assertions NOT run');
  }else if(o.phase==='assertions'){
   assert.equal(j.phase,'setup-complete','Interrupted/completed assertions require cleanup and a fresh journal, not blind replay');assert.ok(await ownRole());j.phase='assertions-started';await save();
   async function prepare(kind,audience='staff',bytes=syntheticPdf('Storage QA '+j.run)){
    const id=randomUUID(),doc={id,kind,filename:`storage-qa-${j.run}-${kind}.pdf`,path:`${f.scope}/${f.unit}/${id}.pdf`,prepareIntention:true};j.documents.push(doc);await save();
    assert.equal(await rpc(B,'prepare_unit_document',{scope:f.scope,unit:f.unit,filename:doc.filename,mime:'application/pdf',bytes:bytes.length,digest:sha(bytes),audience,request_key:id}),id);doc.prepareIntention=false;await save();return doc;
   }
   const download=async(c,doc,bytes)=>{const blob=ok(await c.storage.from(BUCKET).download(doc.path,{}, {cache:'no-store'}));assert.equal(sha(Buffer.from(await blob.arrayBuffer())),sha(bytes));};
   async function deniedPrepare(args,code){
    const probe={id:args.request_key,scope:args.scope,unit:args.unit,filename:args.filename,state:'pending'};j.probes??=[];j.probes.push(probe);await save();
    const response=await B.rpc('prepare_unit_document',args);if(response.error?.code===code)probe.state='refused';await save();refused(response,[code]);
   }
   const small=syntheticPdf('Storage QA '+j.run),large=syntheticPdf('Storage QA '+j.run,MAX_BYTES);let staff,owners;
   await check('pending, server input limits and bucket MIME/size rejection',async()=>{
    staff=await prepare('staff');refused(await B.rpc('complete_unit_document',{document:staff.id}),['23514']);assert.equal((await rpc(OWNER,'unit_documents',{scope:f.scope,unit:f.unit})).length,0);
    for(const override of [{bytes:0},{bytes:MAX_BYTES+1},{mime:'text/html'}])await deniedPrepare({scope:f.scope,unit:f.unit,filename:staff.filename,mime:'application/pdf',bytes:small.length,digest:sha(small),audience:'staff',request_key:randomUUID(),...override},'23514');
    refused(await B.storage.from(BUCKET).upload(staff.path,small,{contentType:'text/html',upsert:false}));refused(await B.storage.from(BUCKET).upload(staff.path,syntheticPdf('oversize',MAX_BYTES+1),{contentType:'application/pdf',upsert:false}));
   });
   await check('real staff-only PDF bytes/hash; anonymous/public/signed and unentitled owner denied',async()=>{
    ok(await B.storage.from(BUCKET).upload(staff.path,small,{contentType:'application/pdf',upsert:false,cacheControl:'0'}));await download(B,staff,small);await rpc(B,'complete_unit_document',{document:staff.id});
    assert.equal((await documents()).find(d=>d.id===staff.id).visibility,'staff');refused(await OWNER.storage.from(BUCKET).download(staff.path));refused(await anon.storage.from(BUCKET).download(staff.path));refused(await anon.rpc('unit_documents',{scope:f.scope,unit:f.unit}),['42501']);refused(await B.storage.from(BUCKET).createSignedUrl(staff.path,1));
    const response=await guardedFetch(`${URL}/storage/v1/object/public/${BUCKET}/${staff.path}`,{headers:{apikey:process.env.VITE_SUPABASE_PUBLISHABLE_KEY}});assert.ok([400,403,404].includes(response.status));
    await rpc(B,'remove_unit_document',{document:staff.id,note:marker});refused(await B.rpc('finish_unit_document_removal',{document:staff.id}),['23514']);refused(await B.storage.from(BUCKET).download(staff.path));await remove(staff);
   });
   await check('explicit current owner; exact5MiB bytes/hash; owner cannot remove',async()=>{
    owners=await prepare('owners','owners',large);ok(await B.storage.from(BUCKET).upload(owners.path,large,{contentType:'application/pdf',upsert:false,cacheControl:'0'}));refused(await OWNER.storage.from(BUCKET).download(owners.path));await download(B,owners,large);await rpc(B,'complete_unit_document',{document:owners.id});await download(OWNER,owners,large);
    assert.ok((await rpc(OWNER,'unit_documents',{scope:f.scope,unit:f.unit})).some(d=>d.id===owners.id));refused(await OWNER.rpc('remove_unit_document',{document:owners.id,note:marker}),['42501']);refused(await A.storage.from(BUCKET).download(owners.path));
    for(const [scope,unit]of [[f.foreignScope,f.unit],[f.scope,f.foreignUnit]])await deniedPrepare({scope,unit,filename:owners.filename,mime:'application/pdf',bytes:small.length,digest:sha(small),audience:'staff',request_key:randomUUID()},'42501');
   });
   await check('same B JWT becomes foreign-only after role revocation; existing bytes still readable by owner',async()=>{
    const role=await ownRole();await rpc(A,'set_owner_verifier',{role_id:role.id,enabled:false,note:marker});await rpc(A,'revoke_staff_role',{role_id:role.id});refused(await B.storage.from(BUCKET).download(owners.path));assert.deepEqual(await documents(),[]);await download(OWNER,owners,large);
    assert.ok(ok(await B.auth.getSession()).session.access_token===claims.B,'Session unexpectedly changed');await grant();
   });
   await check('same owner JWT loses actual bytes and metadata after exact link revocation',async()=>{
    await revokeLink();refused(await OWNER.storage.from(BUCKET).download(owners.path));assert.deepEqual(await rpc(OWNER,'unit_documents',{scope:f.scope,unit:f.unit}),[]);assert.ok(ok(await OWNER.auth.getSession()).session.access_token===claims.OWNER,'Session unexpectedly changed');await download(B,owners,large);await remove(owners);
    const pending=await prepare('incomplete');refused(await B.rpc('complete_unit_document',{document:pending.id}),['23514']);await remove(pending);
   });
   j.phase='assertions-pass-cleanup-pending';await save();console.log('PASS: assertions; cleanup is still REQUIRED');
  }else{
   assert.ok(j.phase!=='preflight','No owned setup resources');assert.ok(!j.roleIntention,'Uncertain role creation: reconcile before cleanup');
   assert.ok(!(j.probes||[]).some(p=>p.state!=='refused'),'Uncertain/unexpected negative write: operator must reconcile exact journaled probe IDs first');
   const needsRights=j.documents.some(d=>!d.cleaned)||(j.link&&!j.linkRevoked)||(!j.link&&j.linkRequest);
   if(needsRights){const role=await ownRole();if(!role)await grant();else if((!j.linkRevoked||j.linkIntention)&&!role.permissions.includes('verify_owner_access'))await rpc(A,'set_owner_verifier',{role_id:role.id,enabled:true,note:marker});}
   // A request may have completed before a timeout; replay of the journaled link request is idempotent.
   if(!j.link&&j.linkRequest){const records=await rpc(B,'owner_access_records',{scope:f.scope});const own=records.filter(l=>l.profile_id===f.profiles.OWNER&&l.person_id===f.person.id&&l.verification_note===marker);assert.ok(own.length<=1);if(own.length){j.link=own[0].id;j.linkIntention=false;}else{assert.ok(!j.linkIntention,'Uncertain link request: confirm final server outcome before cleanup');j.linkRequest=null;}await save();}
   if(j.link&&!j.linkRevoked)await revokeLink();for(const doc of j.documents.filter(d=>!d.cleaned))await remove(doc);
   for(const r of (await roles()).filter(r=>active(r)&&j.roles.some(x=>x.id===r.id))){assert.ok(!j.baseline.roles.includes(r.id));assert.ok(j.roles.some(x=>x.id===r.id&&x.membership_id===r.membership_id));await rpc(A,'set_owner_verifier',{role_id:r.id,enabled:false,note:marker});await rpc(A,'revoke_staff_role',{role_id:r.id});}
   if(j.membershipOwned){
    const query=membershipCleanupSql(j,f);await writeFile(o.journal+'.membership-cleanup.sql',query+'\n');
    if(process.env.STORAGE_QA_MANAGEMENT_TOKEN){
     const response=await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+process.env.STORAGE_QA_MANAGEMENT_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query})});assert.ok(response.ok,'Operator cleanup failed');await response.json();
    }
    const rows=ok(await B.from('organization_memberships').select('id,status').eq('id',j.membership));assert.ok(rows.length===1&&rows[0].status==='inactive','Membership cleanup pending: execute reviewed guarded SQL through operator connector, then rerun cleanup');
   }
   j.phase='cleaned-history-retained';await save();console.log('PASS: cleanup; only journal-owned resources affected, history retained');
  }
 }catch(error){if(j){j.lastFailurePhase=o.phase;await mkdir(dirname(o.journal),{recursive:true});await writeFile(o.journal+'.failure.json',JSON.stringify({phase:o.phase,run:j.run,status:'FAIL; inspect journal, do not blindly retry',errorType:error.name,operator:error.operator,scriptFrames:String(error.stack||'').split('\n').filter(line=>line.includes('check-unit-file-hosted.mjs:'))},null,2));}throw error;}
 finally{for(const c of Object.values(clients))try{await c.auth.signOut({scope:'local'});}catch{/* No tokens/errors logged. */}if(lock){await lock.close();await unlink(o.journal+'.lock');}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('FAIL: hosted Storage preparation/run stopped; sensitive details suppressed. Inspect the ignored journal and documented recovery gates.');process.exitCode=1;});
