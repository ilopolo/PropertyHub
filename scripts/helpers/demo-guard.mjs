import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const path=fileURLToPath(new URL('../../.local/demo-context/manifest.json',import.meta.url));
export const qaIsolationAllows=manifest=>manifest?.marker==='PH-DEMO-V1'&&manifest.state==='retired'&&manifest.retirement?.verified===true;
export function assertHostedQaAllowed(){
  let manifest;
  try{manifest=JSON.parse(readFileSync(path,'utf8'));}catch{throw Error('Hosted QA blocked: durable-demo isolation manifest missing or unreadable. Establish the target/profile cleanup boundary before running QA.');}
  if(!qaIsolationAllows(manifest))
    throw Error('Hosted QA blocked: PH-DEMO-V1 reserves durable profiles/resources. Do not restore old profile states, revoke their grants or run QA cleanup. Use an explicitly reviewed isolated context.');
}
