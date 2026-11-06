// Disposable local regressions only. Controlled SQL boundaries are NOT native MVCC.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {unitFileFixture} from './helpers/unit-file-fixture.mjs';
import {expenseFixture} from './helpers/expense-fixture.mjs';

const migration='20261106204645_current_write_access_guards.sql',out='.local/access-correction';
const correction=await readFile('supabase/migrations/'+migration,'utf8'),checks=[],boundaryProofs=[];
let f;
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
function sessions(x){
 x.as=async(who,sql,args=[])=>{await x.db.exec('set role '+(who==='anon'?'anon':'authenticated'));await x.db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[x.auth[who]||'',JSON.stringify({sub:x.auth[who],session_id:x.session[who]})]);let error;try{return await x.db.query(sql,args);}catch(e){error=e;throw e;}finally{try{await x.db.exec('reset role');}catch(e){if(!error)throw e;}}};return x;
}
const jsonState=async()=>JSON.stringify((await f.db.query(`select jsonb_build_object(
 'accounts',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.cash_accounts x),
 'memberships',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.organization_memberships x),
 'profiles',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.profiles x),
 'rules',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.allocation_rule_versions x),
 'resolutions',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.resolutions x),
 'account_versions',(select coalesce(jsonb_agg(to_jsonb(x) order by account_id,revision),'[]') from public.cash_account_versions x),
 'funds',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.funds x),
 'classifications',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.fund_classifications x),
 'lines',(select coalesce(jsonb_agg(to_jsonb(x) order by classification_id,fund_id),'[]') from public.fund_movement_lines x),
 'payments',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.payments x),
 'movements',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.money_movements x),
 'allocations',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.payment_allocations x),
 'expenses',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.expenses x),
 'expense_payments',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.expense_payments x),
 'batches',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.charge_batches x),
 'charges',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.charges x),
 'parties',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.obligation_parties x),
 'documents',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.documents x),
 'previews',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.financial_previews x),
 'roles',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.user_roles x),
 'operations',jsonb_build_object(
  'cash',(select coalesce(jsonb_agg(to_jsonb(x) order by actor_id,request_key),'[]') from private.cash_account_operations x),
  'fund',(select coalesce(jsonb_agg(to_jsonb(x) order by actor_id,request_key),'[]') from private.fund_operations x),
  'inbound',(select coalesce(jsonb_agg(to_jsonb(x) order by actor_id,request_key),'[]') from private.inbound_payment_operations x),
  'payment',(select coalesce(jsonb_agg(to_jsonb(x) order by actor_id,request_key),'[]') from private.payment_operations x),
  'expense',(select coalesce(jsonb_agg(to_jsonb(x) order by actor_id,request_key),'[]') from private.expense_operations x),
  'charge',(select coalesce(jsonb_agg(to_jsonb(x) order by actor_id,request_key),'[]') from private.charge_operations x)),
 'audit',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.audit_events x)
 ) s`)).rows[0].s);
async function tx(fn){await f.db.exec('begin');try{return await fn();}finally{await f.db.exec('rollback');}}
async function denied(fn,reason){const hasBoundary=(await f.db.query("select to_regclass('private.qa_access_boundary_hits') x")).rows[0].x;const prior=hasBoundary?(await f.db.query('select last_value::text value,is_called from private.qa_access_boundary_hits')).rows[0]:null;await f.db.exec('savepoint refusal');try{await assert.rejects(fn,e=>e.code==='42501'&&(!reason||e.message===reason));}finally{await f.db.exec('rollback to savepoint refusal');}if(prior){const after=(await f.db.query('select last_value::text value,is_called from private.qa_access_boundary_hits')).rows[0];assert(after.is_called&&(!prior.is_called||BigInt(after.value)>BigInt(prior.value)),'Entry refusal before the selected boundary is not interleaving evidence');boundaryProofs.push({reason:reason??'42501',boundaryReached:true});}}
const def=async name=>(await f.db.query("select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.prosrc body,p.provolatile volatility,p.prosecdef definer,p.proconfig config from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=$1",[name])).rows[0];
// The callback changes authority immediately after one actual SQL lock statement.
// No shared helper or deployed SQL file is edited; everything rolls back locally.
async function boundary(name,needle,{role=null,member=null,mode='revoke'}={}){
 const d=await def(name);assert(d.body.includes(needle),'Missing exact boundary '+name);
 // Sequence advancement survives a failed statement/savepoint rollback. It proves
 // the selected boundary really ran; an early entry refusal cannot pass this test.
 await f.db.exec(`create sequence private.qa_access_boundary_hits;
 create function private.qa_current_access_boundary() returns boolean language plpgsql volatile security definer set search_path='' as $$begin
 perform nextval('private.qa_access_boundary_hits'::regclass);
 if current_setting('phqa.loss',true)='status' then
  update public.organization_memberships set status='inactive' where id=nullif(current_setting('phqa.member',true),'')::uuid;
 elsif current_setting('phqa.loss',true)='expiry' then perform pg_sleep(0.25);
 else update public.user_roles set valid_to=greatest(clock_timestamp(),valid_from+interval '1 microsecond') where id=nullif(current_setting('phqa.role',true),'')::uuid;
 end if;
 return false;end$$;revoke all on function private.qa_current_access_boundary() from public,anon,authenticated;`);
 await f.db.query("select set_config('phqa.role',$1,true),set_config('phqa.member',$2,true),set_config('phqa.loss',$3,true)",[role??'',member??'',mode]);
 await f.db.exec(d.definition.replace(d.body,()=>d.body.replaceAll(needle,()=>needle+"\n if private.qa_current_access_boundary() then null;end if;")));
}
const catalog=async()=>(await f.db.query(`select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),p.proacl::text,p.prosecdef,p.proconfig) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')),
 'tables',(select jsonb_agg(jsonb_build_array(c.oid,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity) order by c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private') and c.relkind='r'),
 'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p)) s`)).rows[0].s;

try{
 f=sessions(await unitFileFixture({beforeMigration:'20261105131317'}));
 for(const file of['20261106170356_registry_units_csv.sql','20261106185945_registry_csv_current_rights.sql'])await f.db.exec('begin;'+await readFile('supabase/migrations/'+file,'utf8')+'commit;');
 const oldManager=(await f.db.query("select id from public.user_roles where scope_id=$1 and profile_id=$2 and role_code='manager' and valid_to is null",[f.scope.A,f.profile.A])).rows[0].id;
 await f.as('orgA','select public.revoke_staff_role($1)',[oldManager]);
 const role=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'manager',array['manage_cash_accounts']) id",[f.org.A,f.auth.A,f.scope.A])).rows[0].id;
 const payload={account_type:'cash',currency:'EUR',label:'Synthetic correction account',purpose:'Local current rights test',holder_label:null,account_reference:null},key=randomUUID();
 const save=async(k=key,p=payload)=>(await f.as('A',"select public.save_cash_account($1,null,0,$2,$3,'Synthetic correction') id",[f.scope.A,k,p])).rows[0].id;
 const account=await save();
 const docArgs=[f.scope.A,f.unit.A,'synthetic.pdf','application/pdf',42,'a'.repeat(64),'staff',randomUUID()];
 const prepare=async(args=docArgs)=>(await f.as('doc','select public.prepare_unit_document($1,$2,$3,$4,$5,$6,$7,$8) id',args)).rows[0].id;
 const doc=await prepare(),member=(await f.db.query('select membership_id from public.user_roles where id=$1',[f.docRole])).rows[0].membership_id;
 const orgMember=(await f.db.query('select id from public.organization_memberships where organization_id=$1 and profile_id=$2',[f.org.A,f.profile.orgA])).rows[0].id;
 const assign=async()=>(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'controller',array['read_registry']) id",[f.org.A,f.auth.B,f.scope.A])).rows[0].id;
 const orgLock="perform pg_advisory_xact_lock(hashtextextended(org::text,0));",docLock="perform pg_advisory_xact_lock(hashtextextended(scope::text||unit::text,0));";

 await check('old clock expiry and explicit revoke both allow stale cash replay/write in an older transaction',async()=>{
  for(const mode of['expiry','revoke'])await tx(async()=>{
   if(mode==='expiry'){await f.db.query("update public.user_roles set valid_to=clock_timestamp()+interval '0.20 second' where id=$1",[role]);await new Promise(r=>setTimeout(r,250));}
   else{await new Promise(r=>setTimeout(r,5));await f.as('orgA','select public.revoke_staff_role($1)',[role]);}
   const t=(await f.db.query('select now()<valid_to old_valid,clock_timestamp()>=valid_to live_expired from public.user_roles where id=$1',[role])).rows[0];assert(t.old_valid&&t.live_expired);
   assert.equal(await save(),account);assert(await save(randomUUID()));
  });
 });
 await check('old org-admin and document replay gaps reproduce after actual lock boundaries',async()=>{
  await tx(async()=>{await boundary('assign_staff_role',orgLock,{member:orgMember,mode:'status'});assert(await assign());assert.equal((await f.db.query('select status from public.organization_memberships where id=$1',[orgMember])).rows[0].status,'inactive');});
  await tx(async()=>{await boundary('prepare_unit_document',docLock,{member,mode:'status'});assert.equal(await prepare(),doc);assert.equal((await f.db.query('select status from public.organization_memberships where id=$1',[member])).rows[0].status,'inactive');});
 });
 const beforeCatalog=await catalog(),beforeState=await jsonState();
 await check('unknown installed body fails closed and the failed migration transaction leaves no partial helper or patch',async()=>{
  await tx(async()=>{const d=await def('assign_staff_role');await f.db.exec(d.definition.replace(d.body,()=>d.body+'\n-- unexpected dependency change\n'));await f.db.exec('savepoint candidate');await assert.rejects(()=>f.db.exec(correction),e=>e.message.includes('current_write_guard_dependency_changed'));await f.db.exec('rollback to savepoint candidate');assert.equal((await f.db.query("select to_regprocedure('private.current_write_permission(uuid,text)') x")).rows[0].x,null);});
 });
 await f.db.exec('begin;'+correction+'commit;');
 await check('correction applies on exact 40-version local baseline without CALC or data/ACL/RLS changes',async()=>{
  assert.equal(await jsonState(),beforeState);const after=await catalog();const oldNames=new Set(beforeCatalog.functions.map(x=>x.slice(0,3).join('|')));assert.deepEqual(after.functions.filter(x=>oldNames.has(x.slice(0,3).join('|'))),beforeCatalog.functions);assert.deepEqual(after.tables,beforeCatalog.tables);assert.deepEqual(after.policies,beforeCatalog.policies);assert.equal((await f.db.query("select to_regclass('public.monthly_context_reviews') x")).rows[0].x,null);
 });
 await check('new helper grants are closed; volatility/search_path and fixed-snapshot refusal are explicit',async()=>{
  const rows=(await f.db.query("select proname,provolatile,prosecdef,proconfig,has_function_privilege('authenticated',oid,'execute') a,has_function_privilege('anon',oid,'execute') n from pg_proc where pronamespace='private'::regnamespace and proname like 'current_write_%'")).rows;assert.equal(rows.length,3);for(const r of rows){assert.equal(r.provolatile,'v');assert(r.prosecdef&&!r.a&&!r.n);assert(r.proconfig.includes('search_path=""'));}
  for(const who of['A','anon'])await assert.rejects(()=>f.as(who,"select private.current_write_permission($1,'manage_cash_accounts')",[f.scope.A]),e=>e.code==='42501');
  await f.db.exec('begin isolation level repeatable read');try{await denied(()=>save(),'current_write_isolation_unsupported');}finally{await f.db.exec('rollback');}
 });
 await check('all enumerated workers retain VOLATILE definer identity and guard every explicit lock and return',async()=>{
  const targets=['cash_account_operation','fund_operation','classify_fund_movement','inbound_payment_operation','manual_payment_operation','manual_payment_operation_before_inbound','expense_operation','publish_charge_batch','activate_financial_rule','create_financial_preview','assign_staff_role','prepare_unit_document'];
  let locks=0,exits=0;
  for(const name of targets){const d=await def(name),body=d.body;assert.equal(d.volatility,'v');assert(d.definer&&d.config.includes('search_path=""'));assert(!body.includes('private.has_scope_permission('));assert(!body.includes('private.is_org_admin('));assert(!body.includes('private.can_manage_unit_documents('));
   for(const m of body.matchAll(/^[ \t]*(?:perform|select)[^\n]*(?:pg_advisory_xact_lock|for update|for share)[^\n]*;/gm)){assert(/^\s*if not\(private\.current_write_/.test(body.slice(m.index+m[0].length)),name+' lock guard');locks++;}
   for(const m of body.matchAll(/\breturn\s+[^;]+;/gi)){assert(/private\.current_write_[\s\S]*?using errcode='42501';end if;\s*$/.test(body.slice(Math.max(0,m.index-700),m.index)),name+' exit guard');exits++;}
  }assert(locks>30&&exits>15);
  const stable=(await f.db.query("select provolatile,prosrc from pg_proc where oid='private.has_scope_permission(uuid,text)'::regprocedure")).rows[0];assert.equal(stable.provolatile,'s');assert(stable.prosrc.includes('r.valid_from<=now()'));
 });
 await check('expiry and guarded revoke are separate fixed denials; replay and new write preserve all data',async()=>{
  for(const mode of['expiry','revoke'])await tx(async()=>{
   if(mode==='expiry'){await f.db.query("update public.user_roles set valid_to=clock_timestamp()+interval '0.20 second' where id=$1",[role]);await new Promise(r=>setTimeout(r,250));}
   else{await new Promise(r=>setTimeout(r,5));await f.as('orgA','select public.revoke_staff_role($1)',[role]);}
   const before=await jsonState();await denied(()=>save());await denied(()=>save(randomUUID()));assert.equal(await jsonState(),before);
  });assert.equal(await save(),account);
 });
 await check('cash advisory wait boundary rejects revoke and real expiry, with an allowed replay control',async()=>{
  for(const mode of['revoke','expiry'])await tx(async()=>{
   if(mode==='expiry')await f.db.query("update public.user_roles set valid_to=clock_timestamp()+interval '0.20 second' where id=$1",[role]);
   await boundary('cash_account_operation',"perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||':cash-account:'||request_key::text,0));",{role,mode});const before=await jsonState();await denied(()=>save(),'cash_account_manage_forbidden');assert.equal(await jsonState(),before);
  });assert.equal(await save(),account);
 });
 await check('membership expiry is checked independently of role expiry and does not become a stale replay',async()=>{
  const m=(await f.db.query('select membership_id from public.user_roles where id=$1',[role])).rows[0].membership_id;
  await tx(async()=>{await f.db.query("update public.organization_memberships set valid_to=clock_timestamp()+interval '0.20 second' where id=$1",[m]);await new Promise(r=>setTimeout(r,250));await denied(()=>save());});assert.equal(await save(),account);
 });
 await check('staff grant and identical replay require current caller authority after org and role locks',async()=>{
  await tx(async()=>{await boundary('assign_staff_role',orgLock,{member:orgMember,mode:'status'});const before=await jsonState();await denied(assign,'Forbidden');assert.equal(await jsonState(),before);});
  const granted=await assign();assert.equal(await assign(),granted);
  for(const needle of[orgLock,"select id into result from public.user_roles where membership_id=member and scope_id=scope and role_code=role and valid_to is null for update;"])await tx(async()=>{await boundary('assign_staff_role',needle,{member:orgMember,mode:'status'});const before=await jsonState();await denied(assign,'Forbidden');assert.equal(await jsonState(),before);});
  await assert.rejects(()=>f.as('A',"select public.assign_staff_role($1,$2,$3,'controller',array['read_registry'])",[f.org.A,f.auth.A,f.scope.A]),e=>e.code==='42501');
 });
 await check('org-admin interval expiry is independent of status revocation',async()=>{
  const adminRole=(await f.db.query("select id from public.user_roles where profile_id=$1 and role_code='org_admin'",[f.profile.orgA])).rows[0].id;
  await tx(async()=>{await f.db.query("update public.user_roles set valid_to=clock_timestamp()+interval '0.20 second' where id=$1",[adminRole]);await boundary('assign_staff_role',orgLock,{role:adminRole,mode:'expiry'});await denied(assign,'Forbidden');});
 });
 await check('document preparation rejects revoked replay/new metadata after wait; history is preserved',async()=>{
  assert.equal(await prepare(),doc);
  await tx(async()=>{await f.as('doc',"select public.remove_unit_document($1,'Synthetic metadata lifecycle')",[doc]);const fresh=await prepare([...docArgs.slice(0,7),randomUUID()]);assert.notEqual(fresh,doc);assert.equal((await f.db.query('select status from public.documents where id=$1',[doc])).rows[0].status,'removed');});
  for(const args of[docArgs,[...docArgs.slice(0,7),randomUUID()]])await tx(async()=>{await boundary('prepare_unit_document',docLock,{member,mode:'status'});const before=await jsonState();await denied(()=>prepare(args),'document_prepare_forbidden');assert.equal(await jsonState(),before);});
  await tx(async()=>{await f.db.query("update public.user_roles set valid_to=clock_timestamp()+interval '0.20 second' where id=$1",[f.docRole]);await boundary('prepare_unit_document',docLock,{role:f.docRole,mode:'expiry'});await denied(prepare,'document_prepare_forbidden');});
 });
 await f.db.close();f=null;

 // Existing vertical fixture exercises activation/publication under the new guards;
 // it also proves the optional local CALC publisher extensions were not overwritten.
 f=sessions(await expenseFixture());
 const cashRole=(await f.as('orgA',"select public.assign_staff_role($1,$2,$3,'cashier',array['record_payments','prepare_charges']) id",[f.org.A,f.auth.A,f.scope.A])).rows[0].id;
 await check('existing activation/publication setup succeeds and exact published snapshots/totals remain intact',async()=>{
  const b=(await f.db.query('select status,publication_snapshot from public.charge_batches where id=$1',[f.batch])).rows[0];assert.equal(b.status,'published');assert(b.publication_snapshot);
  const sums=(await f.db.query('select sum(c.amount)::text charges,(select sum(p.assessed_amount)::text from public.obligation_parties p join public.charges c on c.id=p.charge_id where c.batch_id=$1) parties from public.charges c where c.batch_id=$1',[f.batch])).rows[0];assert.equal(sums.charges,sums.parties);
  const pub=await def('publish_charge_batch');assert(pub.body.includes('calc04-published-charge-v1'));assert(pub.body.includes('current_write_permission'));
 });
 await check('preview replay old gap is reproduced then fixed without leaking inaccessible receipt',async()=>{
  const r=(await f.db.query('select id,request_key,request_input from public.financial_previews where id=$1',[f.preview])).rows[0],p=r.request_input;
  const call=()=>f.as('A','select public.create_financial_preview($1,$2,$3,$4,$5) id',[f.scope.A,p.payload,p.expected_token,r.request_key,p.note]);
  assert.equal((await call()).rows[0].id,r.id);
  const lock="perform pg_advisory_xact_lock(hashtextextended(private.actor()::text||':preview:'||request_key::text,0));";
  const oldSql=(await readFile('supabase/migrations/20261102152437_financial_preview.sql','utf8')).match(/create function private\.create_financial_preview\([\s\S]*?end \$\$;/)[0].replace('create function','create or replace function');
  await tx(async()=>{await f.db.exec(oldSql);await boundary('create_financial_preview',lock,{role:cashRole});assert.equal((await call()).rows[0].id,r.id);});
  await tx(async()=>{await boundary('create_financial_preview',lock,{role:cashRole});const before=await jsonState();await denied(call,'preview_current_rights_changed');assert.equal(await jsonState(),before);});
 });
 let receipt,movement,classification,expense,payment;
 await check('allowed inbound/allocation/fund versions preserve exact amounts and one movement',async()=>{
  receipt=await f.record(f.paymentPayload('100.00'));const m=await f.move(receipt);movement=m.id;await f.allocate(receipt,1,f.parties[0].id,'10.01');
  const lines=[{fund_id:f.general,fund_revision:1,amount:'60.00'},{fund_id:f.repair,fund_revision:1,amount:'40.00'}];classification=await f.classify(movement,lines);
  assert.equal((await f.state(receipt)).unallocated,'89.99');assert.equal((await f.db.query('select count(*)::int n from public.money_movements where payment_id=$1',[receipt])).rows[0].n,1);
  const c=await f.classify(movement,[{...lines[0],amount:'70.00'},{...lines[1],amount:'30.00'}],1);assert.notEqual(c,classification);
  assert.equal((await f.db.query('select sum(amount)::text amount from public.fund_movement_lines where classification_id=$1',[c])).rows[0].amount,'100.00');
 });
 await check('config and classification row waits refuse current permission loss before mutation/replay',async()=>{
  await tx(async()=>{await boundary('cash_account_operation','select * into old from public.cash_accounts where id=target and scope_id=scope for update;',{role:f.configRole});const before=await jsonState();await denied(()=>f.as('doc',"select public.save_cash_account($1,$2,1,$3,$4,'Synthetic config correction')",[f.scope.A,f.bank,randomUUID(),{label:'Changed synthetic',purpose:'Synthetic'}]));assert.equal(await jsonState(),before);});
  await tx(async()=>{await boundary('fund_operation','select * into old from public.funds where id=target and scope_id=scope for update;',{role:f.configRole});const before=await jsonState();await denied(()=>f.deactivateFund(f.general,1,randomUUID(),'doc'),'fund_manage_forbidden');assert.equal(await jsonState(),before);});
  await tx(async()=>{await boundary('classify_fund_movement','select * into m from public.money_movements where id=movement and scope_id=scope for update;',{role:cashRole});const before=await jsonState();await denied(()=>f.classify(movement,[{fund_id:f.general,fund_revision:1,amount:'100.00'}],2),'fund_classify_forbidden');assert.equal(await jsonState(),before);});
 });
 await check('allocation payment row wait and inbound account wait refuse loss without partial money or debt rows',async()=>{
  await tx(async()=>{await boundary('manual_payment_operation_before_inbound','select * into p from public.payments where id=target and scope_id=scope for update;',{role:cashRole});const before=await jsonState();await denied(()=>f.allocate(receipt,2,f.parties[0].id,'1.00'),'payment_operation_forbidden');assert.equal(await jsonState(),before);});
  await tx(async()=>{await boundary('inbound_payment_operation','select * into a from public.cash_accounts where id=account_id and scope_id=scope for share;',{role:cashRole});const before=await jsonState();await denied(()=>f.record(f.paymentPayload('12.34')),'payment_operation_forbidden');assert.equal(await jsonState(),before);});
 });
 await check('expense document/partial payment controls preserve exact outbound and fund totals',async()=>{
  expense=await f.saveExpense();payment=await f.payExpense(expense,f.settlement('40.00'));
  const state=await f.expenseState(expense);assert.equal(state.remaining,'60.00');
  const m=(await f.db.query('select id,amount::text amount from public.money_movements where expense_payment_id=$1',[payment])).rows;assert.equal(m.length,1);assert.equal(m[0].amount,'40.00');
  assert.equal((await f.db.query('select sum(l.amount)::text amount from public.fund_movement_lines l join public.fund_classifications c on c.id=l.classification_id where c.movement_id=$1',[m[0].id])).rows[0].amount,'40.00');
 });
 await check('expense document row wait rejects loss and rolls back all settlement/audit records',async()=>{
  await tx(async()=>{await boundary('expense_operation','select * into e from public.expenses where id=target and scope_id=scope for update;',{role:f.expenseRole});const before=await jsonState();await denied(()=>f.payExpense(expense,f.settlement('60.00'),1),'expense_current_rights_changed');assert.equal(await jsonState(),before);});
 });
 await check('late loss during inbound/expense writes rolls back original, mirror, allocations and operation receipts',async()=>{
  for(const [name,needle,call] of[
   ['inbound_payment_operation','insert into private.inbound_payment_operations values(private.actor(),request_key,input,result);',()=>f.reverse(receipt,2)],
   ['expense_operation','insert into private.expense_operations values(private.actor(),request_key,input,business_hash,result);',()=>f.reverseExpense(payment)]
  ])await tx(async()=>{await boundary(name,needle,{role:f.expenseRole});const before=await jsonState();await denied(call);assert.equal(await jsonState(),before);});
 });
 await check('allowed historical compensation/replacement keeps originals and mirrored fund amounts exact',async()=>{
  const replacement=await f.replace(receipt,2,f.paymentPayload('100.00'));assert.notEqual(replacement,receipt);
  const original=await f.move(receipt),reverse=(await f.db.query('select id,amount::text amount from public.money_movements where reversal_of_id=$1',[original.id])).rows;assert.equal(reverse.length,1);assert.equal(reverse[0].amount,'100.00');
  assert.equal((await f.db.query('select count(*)::int n from public.fund_classifications where movement_id=(select id from public.money_movements where payment_id=$1)',[replacement])).rows[0].n,0);
  await f.reverseExpense(payment);assert.equal((await f.expenseState(expense)).remaining,'100.00');assert.equal((await f.db.query('select count(*)::int n from public.expense_payments where reversal_of_id=$1',[payment])).rows[0].n,1);
 });
 await check('publisher and activation replay deny authority loss after their actual advisory boundary',async()=>{
  const batch=(await f.db.query("select input from private.charge_operations where result_id=$1 and input->>'action'='publish' limit 1",[f.batch])).rows[0].input;
  const pub=await def('publish_charge_batch'),activation=await def('activate_financial_rule');
  const active=(await f.db.query('select activation_input from public.allocation_rule_versions where id=$1',[f.active])).rows[0].activation_input;
  const keys=(await f.db.query("select request_key from private.charge_operations where result_id=$1 and input->>'action'='publish' limit 1",[f.batch])).rows[0];
  const akey=(await f.db.query('select activation_request_key from public.allocation_rule_versions where id=$1',[f.active])).rows[0].activation_request_key;
  const requests=[
   ['publish_charge_batch',pub.body.match(/perform pg_advisory_xact_lock\([^\n]+;/)[0],()=>f.as('doc','select public.publish_charge_batch_v2($1,$2,$3,$4,$5)',[f.scope.A,f.batch,batch.revision,keys.request_key,batch.note])],
   ['activate_financial_rule',activation.body.match(/perform pg_advisory_xact_lock\([^\n]+;/)[0],()=>f.as('doc','select public.activate_financial_rule($1,$2,$3,$4,$5,$6,$7)',[f.scope.A,active.target,active.expected_revision,active.basis_revision,akey,active.supersedes,active.note])]
  ];
  for(const[name,needle,call]of requests){await call();await tx(async()=>{await boundary(name,needle,{role:f.publisherRole});const before=await jsonState();await denied(call);assert.equal(await jsonState(),before);});}
 });
 await check('foreign scope and legacy record bypass remain denied with current guards',async()=>{
  await assert.rejects(()=>f.as('doc',"select public.save_cash_account($1,null,0,$2,$3,'Synthetic')",[f.scope.B,randomUUID(),{account_type:'cash',currency:'EUR',label:'Foreign',purpose:'Synthetic',holder_label:null,account_reference:null}]),e=>e.code==='42501');
  await assert.rejects(()=>f.as('A',"select private.manual_payment_operation_before_inbound($1,'record',null,null,$2,$3,'Bypass')",[f.scope.A,randomUUID(),f.paymentPayload()]),e=>e.code==='42501');
 });
 await mkdir(out,{recursive:true});await writeFile(out+'/report.json',JSON.stringify({pass:true,localOnly:true,hosted:false,mvcc:false,migration,sqlSha256:createHash('sha256').update(correction.replaceAll('\r\n','\n')).digest('hex'),checks,boundaryProofs,interleaving:'Exact lock/write boundaries in disposable functions only; role/status loss or short real expiry. A fixture-only nontransactional sequence proves each denied boundary was reached. Not independent sessions, committed revoker or observed PG waiter.',cleanup:'Disposable databases closed in finally; no env/credentials/hosted connections.'},null,2));
}catch(e){await mkdir(out,{recursive:true});await writeFile(out+'/failure.json',JSON.stringify({checks,code:e.code,message:e.message,query:e.query,position:e.position,where:e.where},null,2));console.error('Current write access regression failed',e.code??e.name,e.message?.slice(0,450),e.where?.slice(0,700),e.position,e.query?.slice(Math.max(0,Number(e.position)-100),Number(e.position)+100));process.exitCode=1;}finally{await f?.db.close();}
