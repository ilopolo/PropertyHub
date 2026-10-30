import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';

const git = args => execFileSync('git', args, { encoding: 'utf8' });
const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
const patterns = [/sb_secret_[A-Za-z0-9_-]{15,}/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/];
const localSecrets=[];
for(const path of ['.env.rls.local','.env.operator.local','.env.auth-qa.local','.env.auth-qa-secrets.local']) {
  try { localSecrets.push(...Object.values(parseEnv(await readFile(path,'utf8'))).filter(v=>v.length>=8)); }
  catch(e) { if(e.code!=='ENOENT') throw e; }
}
const inspect=(content,file)=>{
  assert.ok(!patterns.some(r=>r.test(content)),`Credential-shaped content in ${file}; value suppressed`);
  assert.ok(!localSecrets.some(value=>content.includes(value)),`Local test credential leaked into ${file}; value suppressed`);
};
const forbidden = p => /^(docs\/(?!public\/)|assignment\/|references\/|history\/|START_HERE\.md$|\.local\/|\.netlify\/)/.test(p) || /^\.env(?:\.|$)/.test(p) && p !== '.env.example';
for (const file of files) {
  assert.ok(!forbidden(file), `Private path tracked/staged: ${file}`);
  let content;
  try { content = await readFile(file, 'utf8'); } catch(e) { if(e.code==='ENOENT') continue; throw e; }
  inspect(content,file);
}
async function inspectBuild(path) {
  let entries;try{entries=await readdir(path,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
  for(const entry of entries) {
    const file=`${path}/${entry.name}`;
    if(entry.isDirectory()) await inspectBuild(file); else inspect(await readFile(file,'utf8'),file);
  }
}
await inspectBuild('dist');
for (const file of ['.env.local', '.env.rls.local', '.env.operator.local', '.env.auth-qa.local', '.env.auth-qa-secrets.local']) {
  assert.equal(git(['ls-files', '--', file]).trim(), '', `Credential path tracked: ${file}`);
  execFileSync('git', ['check-ignore', '--quiet', file]);
}
console.log(`PASS: ${files.length} tracked/staged paths checked; local credential files ignored/untracked. Pattern scan is limited, not proof that every possible secret is absent.`);
