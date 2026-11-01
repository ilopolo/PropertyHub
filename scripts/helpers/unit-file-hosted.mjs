import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolve,relative,isAbsolute} from 'node:path';
export const PROJECT='qfybswnezdzzahmozikr',URL=`https://${PROJECT}.supabase.co`,BUCKET='unit-private-files',MAX_BYTES=5242880;
export const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function options(args){
 const o={phase:'plan',execute:false,fixture:'.local/storage-hosted-qa/fixture.json',journal:'.local/storage-hosted-qa/run.json'};
 for(let i=0;i<args.length;i++){
  const key=args[i];if(key==='--execute')o.execute=true;else if(key==='--external-membership-cleanup')o.externalCleanup=true;
  else if(['--phase','--project','--fixture','--journal'].includes(key)){assert.ok(args[i+1]&&!args[i+1].startsWith('--'),'Missing option value');o[key.slice(2)]=args[++i];}
  else throw Error('Unsupported option');
 }
 assert.ok(['plan','setup','assertions','cleanup'].includes(o.phase),'Unsupported phase');
 if(o.phase!=='plan')assert.ok(o.execute&&o.project===PROJECT,'Execution requires --execute --project '+PROJECT);
 if(o.project)assert.equal(o.project,PROJECT,'Wrong project');
 for(const key of ['fixture','journal']){const rel=relative(resolve('.local'),resolve(o[key]));assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'QA paths must stay in ignored .local');}
 return o;
}
export function validateFixture(f){
 assert.equal(f.project,PROJECT);for(const id of [f.org,f.scope,f.unit,f.foreignScope,f.foreignUnit,f.person?.id,...Object.values(f.auth||{}),...Object.values(f.profiles||{})])assert.ok(uuid(id),'Invalid fixture UUID');
 for(const role of ['A','B','OWNER'])assert.ok(uuid(f.auth?.[role])&&uuid(f.profiles?.[role]));
 assert.equal(new Set(Object.values(f.auth)).size,3);assert.notEqual(f.scope,f.foreignScope);assert.notEqual(f.unit,f.foreignUnit);assert.ok(Number.isInteger(f.person.revision)&&f.person.revision>0);return f;
}
export function validateJournal(j,f){
 assert.equal(j.project,PROJECT);assert.ok(uuid(j.run));assert.equal(j.fixtureHash,sha(Buffer.from(JSON.stringify(f))));
 assert.ok(Array.isArray(j.roles)&&Array.isArray(j.documents));for(const role of j.roles)assert.ok(uuid(role.id)&&uuid(role.membership_id));
 for(const doc of j.documents){assert.ok(uuid(doc.id));assert.equal(doc.filename,`storage-qa-${j.run}-${doc.kind}.pdf`);assert.match(doc.kind,/^[a-z-]+$/);assert.equal(doc.path,`${f.scope}/${f.unit}/${doc.id}.pdf`);}
 for(const p of j.probes||[]){assert.ok(uuid(p.id)&&uuid(p.scope)&&uuid(p.unit));assert.ok(p.filename.startsWith('storage-qa-'+j.run+'-'));assert.ok(['pending','refused'].includes(p.state));}
 if(j.link)assert.ok(uuid(j.link));if(j.membership)assert.ok(uuid(j.membership));return j;
}
export function membershipCleanupSql(j,f){
 validateFixture(f);validateJournal(j,f);assert.ok(j.membership&&j.membershipOwned,'No owned membership');assert.ok(!j.baseline.memberships.some(m=>m.id===j.membership),'Baseline membership cannot be cleaned');
 return `update public.organization_memberships m set status='inactive' where m.id='${j.membership}'::uuid and m.profile_id='${f.profiles.B}'::uuid and m.organization_id='${f.org}'::uuid and not exists(select 1 from public.user_roles r where r.membership_id=m.id and r.valid_from<=now() and (r.valid_to is null or now()<r.valid_to)) returning m.id,m.status;`;
}
export function syntheticPdf(marker,size){
 assert.match(marker,/^[a-zA-Z0-9 -]+$/);let text='%PDF-1.4\n',offsets=[0];
 const stream=`BT /F1 12 Tf 20 80 Td (${marker}) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 120] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 for(const [i,obj]of objects.entries()){offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${obj}\nendobj\n`;}
 const xref=Buffer.byteLength(text);text+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 const bytes=Buffer.from(text);if(size===undefined)return bytes;assert.ok(size>=bytes.length);return Buffer.concat([bytes,Buffer.alloc(size-bytes.length,0x20)]);
}
export const PLAN={project:PROJECT,default:'OFFLINE PLAN: no env loading, login, HTTP or mutation',phases:['setup: ordinary synthetic sessions; baseline checks; journaled temporary B role and exact owner link','assertions: real SDK bytes/hash, default privacy, owner opt-in, anonymous/foreign and same-session revoke, MIME/size and incomplete upload/removal','cleanup: only journal-owned marked documents/link/roles; optional operator membership deactivation, history retained'],credentials:['VITE_SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY','RLS_A_EMAIL','RLS_A_PASSWORD','RLS_B_EMAIL','RLS_B_PASSWORD','PASSWORD_QA_EMAIL','PASSWORD_QA_PASSWORD','STORAGE_QA_MANAGEMENT_TOKEN (only optional operator cleanup; never access assertions)'],releasePrerequisite:'Separately authorized migration apply and read-only policy/bucket/hash review; script never applies DDL',hostedPass:false};
