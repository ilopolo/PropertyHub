import assert from 'node:assert/strict';
import {validateUnitFile,fileDigest,assertFileBytes,UNIT_FILE_MAX_BYTES} from '../src/domain/unit-file.js';
const valid={name:'synthetic.pdf',type:'application/pdf',size:1};
assert.equal(validateUnitFile(valid),null);assert.equal(validateUnitFile({...valid,size:UNIT_FILE_MAX_BYTES}),null);
for(const invalid of [{size:0},{size:null},{size:UNIT_FILE_MAX_BYTES+1},{type:'text/html'},{name:'../a.pdf'},{name:'a\\b.pdf'},{name:'a\u0000.pdf'},{name:'test.svg'},{name:'a'.repeat(121)+'.pdf'}])assert.ok(validateUnitFile({...valid,...invalid}));
const blob=new Blob(['%PDF-1.4\n% synthetic\n%%EOF\n']),sha256=await fileDigest(blob);assert.match(sha256,/^[0-9a-f]{64}$/);await assertFileBytes(blob,{sha256,size_bytes:blob.size});
await assert.rejects(()=>assertFileBytes(new Blob(['different']),{sha256,size_bytes:blob.size}));await assert.rejects(()=>assertFileBytes(blob,{sha256:'0'.repeat(64),size_bytes:blob.size}));
console.log('PASS: file validation boundaries, unknown/zero size, MIME/name and exact SHA256 corruption refusal.');
