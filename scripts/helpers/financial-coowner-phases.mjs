// Executable phase coordinator; provider-specific setup/assertions must be supplied by a reviewed adapter.
import assert from 'node:assert/strict';
import {withRun} from './financial-coowner-run.mjs';
const cases=['positive','denials','stale-revoke','duplicates','correction','legacy'];
export async function runCoownerPhase(file,phase,adapter){
 assert(['preflight','setup','assertions','mvcc','reconcile','cleanup'].includes(phase),'Unknown phase');
 return withRun(file,adapter,async ctx=>{
  if(phase==='reconcile')return ctx.reconcile();
  if(phase==='cleanup'){await adapter.beginCleanup?.(ctx);return ctx.cleanup();}
  if(phase==='preflight'){await ctx.preflight();await ctx.baseline();if(['new','baseline'].includes(ctx.j.phase))return ctx.checkpoint('baseline');return ctx.save();}
  if(phase==='setup'){
   assert.equal(ctx.j.phase,'baseline','Setup cannot overwrite a completed run');assert(!ctx.j.pending,'Reconcile first');
   await adapter.setup(ctx);await ctx.verifyBaseline();return ctx.checkpoint('setup-done');
  }
  if(phase==='assertions'){
   assert.equal(ctx.j.phase,'setup-done','Complete setup is mandatory; missing configuration is not deny PASS');
   assert(!ctx.j.pending,'Reconcile first');
   const checks=await adapter.assertions(ctx);
   assert.deepEqual(checks.map(c=>c.id).sort(),[...cases].sort(),'All six required assertion groups must have evidence');
   assert(checks.every(c=>c.pass===true&&c.evidence),'No unchecked group may pass');ctx.j.checks.push(...checks);await ctx.verifyBaseline();return ctx.checkpoint('assertions-done');
  }
  assert.equal(ctx.j.phase,'assertions-done');assert(!ctx.j.pending,'Reconcile first');
  const races=await adapter.mvcc(ctx);
  assert.deepEqual(races.map(r=>r.id).sort(),['publish-input','publish-publish','unpaid-correction']);
  assert(races.every(r=>r.pass===true&&r.invariants===true&&r.barrier?.waiter&&new Set(Object.values(r.barrier.pids)).size===3),'Controlled barrier plus domain invariants are required');
  ctx.j.races=races;await ctx.verifyBaseline();return ctx.checkpoint('mvcc-done');
 });
}
