// OFFLINE preparation only. No env loading, provider clients, DB connections or mutation dispatcher.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export const projectRef='qfybswnezdzzahmozikr';
export const candidate={version:'20261103171619',file:'supabase/migrations/20261103171619_financial_coowner_publish.sql',lfTrimSHA256:'9b56f89120652bf4f668898e0e0cfd3bdcd446c8aa5c01ecd3c0c599a9ce7b2e'};
export const acceptancePlan={
 status:'PREPARATION ONLY — NOT HOSTED PASS',projectRef,candidate,
 execution:'This file is an offline plan only. The implemented run-financial-coowner-hosted.mjs CLI requires explicit online/execute/isolation/project/run gates; hosted acceptance is unexecuted.',
 reuse:{
  localOracle:'src/domain/personal-allocation.js; scripts/check-financial-coowner.mjs; scripts/helpers/financial-coowner-fixture.mjs — specification only, do not run local fixtures against hosted',
  earlierRun:'Ignored original-checkout .local/publish-hosted-qa/{run.mjs,native-db.mjs}: use journal/ordinary RPC/.retry(false)/TLS/barrier patterns, NOT its old resources or cleanup',
  native:'Existing ignored .local/financial-hosted-qa/native-tools pg and supabase-ca.crt; no package/framework addition',
  blocker:'Old hosted helpers invoke assertHostedQaAllowed and intentionally refuse active PH-DEMO-V1. Do not import/run them, retire the demo, or bypass/remove that guard. Use the implemented run-specific driver with a fresh reviewed isolated manifest; legacy entrypoints remain blocked.'
 },
 credentials:[
  {file:'.env.migration.local',keys:['SUPABASE_ACCESS_TOKEN'],purpose:'Exact apply only, database_write + database_pooling_config_read; no Edge/Storage/secrets scopes'},
  {file:'.env.finance-mvcc.local',keys:['FINANCE_QA_DATABASE_URL'],purpose:'Existing Session pooler port5432, exact project, CONNECT/pg_read_all_stats/MAINTAIN ownership_set_reviews and existing narrowly required fixture operations. Verify actual privileges later; no CREATE ROLE/GRANT'},
  {file:'.env.local',keys:['VITE_SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY'],purpose:'Public project/client configuration'},
  {file:'.env.rls.local',keys:['RLS_A_EMAIL','RLS_A_PASSWORD','RLS_B_EMAIL','RLS_B_PASSWORD'],purpose:'Existing synthetic ordinary sessions; verify full Auth/profile IDs against saved manifest before mutation. Do not change passwords'}
 ],
 phases:[
  {id:'preflight',steps:[
   'Future separate authorization only: exact target/TLS/read-only history, candidate absence/hash, complete applied history including separate PR8; one pending candidate exact dry-run. No repair or old SQL edit.',
   'SELECT baseline immutable A batches/charges/parties/publication+audit fingerprints and durable-demo/personal records. Save run UUID, protected IDs, before-state and unknown-operation journal before any write.',
   'Scope marker PH-QA-B2-<run UUID>; new isolated org/building/scope and four explicit units, separate scoped persons; never select demo resources by broad name/role. Existing confirmed synthetic Auth profiles only. No demo role/membership restoration.'
  ]},
  {id:'setup',steps:[
   'After exact apply/post-apply checks: guarded application operations for isolated scope/membership/assignments; record only newly created IDs and exact prior state. Explicit prepare/read/publish/correct capabilities; no inherited admin finance.',
   'Qualified clearly synthetic FND-F05 basis, reviewed activation, exact verified building shares and fixed preview. At least one unit has verified ordinary 0.6/0.4 owners, one 0.5/0.5 with an odd fixed cent to exercise UUID tie. Complete four-unit denominator; no approximate thirds.',
   'Explicit supplied ownership coverage [M,T+1), verified full set at L and preview D, person revisions/source evidence; M<=L,D<=server Sofia T; separate due P. Server-derived B2 inputs and motivated per-person proportional-liability reviews, not legal certification.',
   'Separate marked invalid variants for incomplete/split/changed/unverified roster, unsupported regime/representation; never mutate PH-DEMO-V1 or baseline A artifacts.'
  ]},
  {id:'assertions',cases:[
   ['positive','v2 ordinary-session load/save/review/publish; compare server allocation to existing allocator on server-derived quotas; each personal sum=its fixed unit cents; all units sum=R; numerator/remainder/policy/snapshots pinned'],
   ['denials','foreign scope, forged person/amount/snapshot, direct DML, unsupported/SIO/disputed/rational-required, incomplete or changed set => whole-batch refusal, unchanged charge/event counts; config/transport failure is not deny PASS'],
   ['stale-revoke','change exact source/review after preparation => timely HTTP409, one request/no retries/no rows; remove only run-created publish assignment, same JWT => authorization denial; restore only that explicit temporary test context if needed, never a demo grant'],
   ['duplicates','same receipt returns same batch; different key for same business operation cannot publish a second batch; preserve actual results after unknown response before any retry'],
   ['correction','explicit unpaid whole-batch 0.5/0.5->0.6/0.4 source correction/new reviewed input, all N parties reversed/replaced atomically, unchanged unit amounts/R, before/after lineage. Reject changed unit sum or payment-aware case'],
   ['legacy','old API rejects B writes/loads; old feed A-only, v2 includes all N parties; original A baseline fingerprints byte-identical after B work; payer remains distinct, no auto owner rights']
  ]},
  {id:'mvcc',steps:[
   'Use independent holder, contender and observer PostgreSQL sessions with distinct backend PIDs/application_name PH_QA_B2_<run>_<role>. TLS rejectUnauthorized:true + saved official CA; no global clock/session settings.',
   'BEGIN holder under authenticated role and ordinary Auth.getUser-validated claims. Perform actual publish (or correction) without COMMIT, retain scope publication advisory/row/input SHARE locks. Observer records granted pg_locks and contender pg_stat_activity + pg_blocking_pids chain before release.',
   'Compete same/different-key publish, and correction/correction on the same current tip. Release holder only after observed waiter. Accept exactly one original/replacement, replay same result or timely409; no partial charge/party/snapshot/audit state.',
   'Writer-first: hold an ordinary source review mutation uncommitted; observe RowExclusive lock on ownership_set_reviews. Competing publication must hit expected NOWAIT/PT409 without partial records. ROLLBACK the intentionally uncommitted writer.',
   'Publisher-first: hold real publication/correction uncommitted; ordinary source writer or role revoker must be observed blocked (or publisher must refuse after current-right recheck); release deterministically and compare pinned before/after input versions. Never count mixed snapshots as acceptable.',
   'Bounded polling only (e.g. 75ms, max12s observer deadline) with query/lock deadlines. If no barrier/waiter observed, record UNPROVEN. On timeout/unknown outcome, inspect exact PID/operation/journal and persisted state before replay; rollback/end only own connections.'
  ]},
  {id:'cleanup',steps:[
   'Write retained manifest of marked scopes, basis/activation/share/ownership versions, all batches/charges/parties/reversals/audit and their actual status. Preserve financial/audit history; no DELETE to simulate an empty DB.',
   'Revoke only role/assignment/link IDs created in this run; restore exact prior membership state only if this run changed it. Refuse any protected/demo ID or absent before-state. Close/sign out only own captured Auth session IDs, not all A/B sessions.',
   'Rollback/end own native transactions; verify no own active transactions/retries, exact sums/lineage, unchanged A/demo/personal baseline. Unknown operation blocks cleanup/replay until reconciled.',
   'Clear temporary local CLI/DB operator credentials only after reconciled verification; never print credentials/JWT/URI. No new accounts, SQL roles/GRANT, deployments or broad cleanup. Natural Publish A rollover remains a separate04Nov+ task.'
  ]}
 ],
 observerSQL:{
  waiters:"select pid,application_name,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where application_name like $1 and pid<>pg_backend_pid()",
  locks:"select pid,relation::regclass::text relation,locktype,mode,granted from pg_locks where pid=any($1::int[])",
  sums:"select c.id,c.unit_id,c.amount,sum(p.assessed_amount) personal_sum from public.charges c join public.obligation_parties p on p.charge_id=c.id where c.batch_id=$1 group by c.id,c.unit_id,c.amount having sum(p.assessed_amount)<>c.amount"
 }
};
export function executionGate(argv){
 if(!argv.includes('--execute'))return{offline:true};
 const index=argv.indexOf('--project-ref');
 if(index<0||argv[index+1]!==projectRef)throw Error('Exact project ref required; no environment or network accessed.');
 throw Error('This file is offline only. Use the separately reviewed run-financial-coowner-hosted.mjs CLI; no mutations dispatched.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--self-test')){
  assert.deepEqual(executionGate([]),{offline:true});
  for(const args of [['--execute'],['--execute','--project-ref','wrong'],['--execute','--project-ref',projectRef]])assert.throws(()=>executionGate(args));
  assert.equal(acceptancePlan.phases.length,5);assert.equal(acceptancePlan.phases.find(p=>p.id==='assertions').cases.length,6);
  console.log('PASS offline plan/guard only; no env, network, DB or product tests.');
 }else{try{executionGate(process.argv.slice(2));console.log(JSON.stringify(acceptancePlan,null,2));}catch(e){console.error(e.message);process.exitCode=2;}}
}
