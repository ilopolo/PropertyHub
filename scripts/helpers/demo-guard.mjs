import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const path=fileURLToPath(new URL('../../.local/demo-context/manifest.json',import.meta.url));
export const qaIsolationAllows=manifest=>manifest?.marker==='PH-DEMO-V1'&&manifest.state==='retired'&&manifest.retirement?.verified===true;
// Separate explicit isolated B2 execution. This never unlocks any legacy hosted QA entrypoint.
export function assertIsolatedDemoBoundary(demo,run){
  if(demo?.marker!=='PH-DEMO-V1'||!run?.marker?.startsWith('PH-QA-B2-')||run.project!=='qfybswnezdzzahmozikr')throw Error('Missing reviewed isolated demo boundary');
  const protectedIds=new Set((JSON.stringify(demo).match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/gi)||[]).map(id=>id.toLowerCase()));
  const saved=new Set((run.protection?.resourceIds||[]).map(id=>id.toLowerCase()));
  if(!protectedIds.size||![...protectedIds].every(id=>saved.has(id)))throw Error('Fresh demo manifest differs from protected run baseline; review first');
  if(protectedIds.has(run.config?.org_id?.toLowerCase())||protectedIds.has(run.config?.foreign_scope_id?.toLowerCase())||[...(run.resources||[]),...(run.temporary||[])].some(r=>protectedIds.has(r.id?.toLowerCase())))throw Error('Protected demo resource is not a QA target');
}
export function assertHostedQaAllowed(){
  let manifest;
  try{manifest=JSON.parse(readFileSync(path,'utf8'));}catch{throw Error('Hosted QA blocked: durable-demo isolation manifest missing or unreadable. Establish the target/profile cleanup boundary before running QA.');}
  if(!qaIsolationAllows(manifest))
    throw Error('Hosted QA blocked: PH-DEMO-V1 reserves durable profiles/resources. Do not restore old profile states, revoke their grants or run QA cleanup. Use an explicitly reviewed isolated context.');
}
