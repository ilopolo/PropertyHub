// Uses the existing native pg.Client interface; no driver/framework/env/network imports.
import assert from 'node:assert/strict';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function observedTransactionRace({connect,holderAction,contenderAction,holderClaims,contenderClaims,deadlineMs=12000,onObserved}){
 let holder,contender,observer,pending;const evidence={pass:false};
 async function begin(c,claims){
  assert(claims?.role==='authenticated'&&claims.sub&&claims.session_id,'Validated ordinary-session claims required');
  await c.query('begin');await c.query("set local statement_timeout='15000ms'");await c.query("set local lock_timeout='14000ms'");await c.query("set local idle_in_transaction_session_timeout='20000ms'");
  await c.query('set local role authenticated');await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)]);
  assert.equal((await c.query('select auth.uid()::text uid')).rows[0].uid,claims.sub);
 }
 try{
  holder=await connect('holder');contender=await connect('contender');observer=await connect('observer');
  const pid=async c=>(await c.query('select pg_backend_pid() pid')).rows[0].pid;
  evidence.pids={holder:await pid(holder),contender:await pid(contender),observer:await pid(observer)};
  assert.equal(new Set(Object.values(evidence.pids)).size,3,'Independent PostgreSQL connections required');
  await begin(holder,holderClaims);await begin(contender,contenderClaims);
  const holderResult=await holderAction(holder); // Actual uncommitted ordinary-user publish/correction, not a sleep-based race.
  // pg.Result also contains parser functions and cannot be structured-cloned or journaled.
  evidence.holder={rows:holderResult.rows,rowCount:holderResult.rowCount,command:holderResult.command};
  evidence.locks=(await observer.query('select locktype,mode,relation::regclass::text relation,granted from pg_locks where pid=$1',[evidence.pids.holder])).rows;
  assert(evidence.locks.some(l=>l.granted),'Holder locks were not observed');
  // Convert both branches immediately so a timeout/rejection cannot become an unhandled promise.
  pending=Promise.resolve().then(()=>contenderAction(contender)).then(result=>({ok:true,result}),error=>({ok:false,code:error.code||'UNKNOWN'}));
  const until=Date.now()+deadlineMs;
  while(Date.now()<until){
   const rows=(await observer.query('select pid,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[evidence.pids.contender])).rows;
   if(rows.some(r=>r.wait_event_type==='Lock'&&r.blockers.includes(evidence.pids.holder))){evidence.waiter=rows[0];evidence.observedAt=new Date().toISOString();break;}
   await delay(75);
  }
  assert(evidence.waiter,'No controlled waiter observed: do not claim MVCC PASS');
  await onObserved?.(structuredClone(evidence));
  await holder.query('commit');evidence.releasedAt=new Date().toISOString();
  evidence.contender=await pending;
  if(evidence.contender.ok)await contender.query('commit');else await contender.query('rollback');
  evidence.pass=true;return evidence; // Caller MUST assert domain result/count/snapshot invariants, not just this transport evidence.
 }finally{
  // Releasing the holder first releases our waiters; never cancel/terminate someone else's backend.
  if(holder)await holder.query('rollback').catch(()=>{});
  if(pending)await pending.catch(()=>{});
  for(const c of [contender,holder,observer])if(c){await c.query('rollback').catch(()=>{});await c.end().catch(()=>{});}
 }
}
