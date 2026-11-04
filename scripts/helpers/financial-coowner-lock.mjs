import assert from 'node:assert/strict';
import {open,readFile,rename,unlink} from 'node:fs/promises';
import {hostname} from 'node:os';
import {randomUUID} from 'node:crypto';
export async function recoverDeadRunLock(file,run,expectedPid,probe=pid=>{try{process.kill(pid,0);return'alive';}catch(e){return e.code==='ESRCH'?'dead':'unknown';}}){
 const guard=file+'.recovery-lock',g=await open(guard,'wx');
 try{
  const j=JSON.parse(await readFile(file,'utf8')),raw=await readFile(file+'.lock','utf8'),lock=JSON.parse(raw);
  assert.equal(j.run,run);assert.equal(lock.host,hostname(),'Unknown lock host');assert.equal(lock.pid,expectedPid);assert(Number.isSafeInteger(expectedPid)&&expectedPid>0);
  assert.equal(await probe(expectedPid),'dead','Owner alive/unknown; age is never sufficient');
  assert.equal(await readFile(file+'.lock','utf8'),raw,'Lock changed during inspection');
  const archive=file+'.abandoned-'+randomUUID()+'.lock';await rename(file+'.lock',archive);
  return{recovered:true,archive,pending:j.pending,reconciliationRequired:!!j.pending};
 }finally{await g.close();await unlink(guard);}
}
