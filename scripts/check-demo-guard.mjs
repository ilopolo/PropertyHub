import assert from 'node:assert/strict';
import {qaIsolationAllows,assertHostedQaAllowed} from './helpers/demo-guard.mjs';
for(const m of [null,{}, {marker:'PH-DEMO-V1',state:'reserved'}, {marker:'PH-DEMO-V1',state:'active'},{marker:'PH-DEMO-V1',state:'retired'},{marker:'other',state:'retired',retirement:{verified:true}}])assert.equal(qaIsolationAllows(m),false);
assert.equal(qaIsolationAllows({marker:'PH-DEMO-V1',state:'retired',retirement:{verified:true}}),true);
// In the working demo environment (or clean checkout without a manifest), fail before any login.
assert.throws(()=>assertHostedQaAllowed(),/Hosted QA blocked/);
console.log('PASS: missing/unreadable/reserved/active/unverified durable demo blocks hosted QA; no login or cleanup executed.');
