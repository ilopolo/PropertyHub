// Targeted local equivalence check; no hosted credentials or network.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {financialCoownerFixture} from './helpers/financial-coowner-fixture.mjs';
const file='supabase/migrations/20261104073315_financial_coowner_legacy_feed_materialized.sql';
const sql=await readFile(file,'utf8'),prior=await readFile('supabase/migrations/20261103171619_financial_coowner_publish.sql','utf8');
const original=prior.slice(prior.indexOf('create or replace function public.charge_batch_feed()'),prior.indexOf('revoke all on function public.load_charge_batch_inputs_v2'));
assert.equal(sql.slice(sql.indexOf('create or replace')).replace('as materialized(', 'as(').trim(),original.trim(),'Only materialization of the source feed may change');
let f;try{
 f=await financialCoownerFixture();await f.db.exec(original);const b=await f.save();await f.review(b);await f.publish(b);
 const before={};for(const who of ['A','doc','orgA','platform'])before[who]=(await f.as(who,'select public.charge_batch_feed() data')).rows[0].data;
 await f.db.exec(sql);
 for(const who of ['A','doc','orgA','platform']){
  const legacy=(await f.as(who,'select public.charge_batch_feed() data')).rows[0].data;
  assert.deepEqual(legacy,before[who]);assert(!legacy.batches.some(x=>x.id===b));
 }
 const v2=(await f.as('doc','select public.charge_batch_feed_v2() data')).rows[0].data;assert(v2.batches.some(x=>x.id===b));
 assert.equal((await f.db.query("select has_function_privilege('anon','public.charge_batch_feed()','EXECUTE') allowed")).rows[0].allowed,false);
 console.log('PASS local feed equivalence, A-only legacy / v2 B visibility, unchanged grants; NOT hosted performance/MVCC');
}finally{await f?.db.close();}
