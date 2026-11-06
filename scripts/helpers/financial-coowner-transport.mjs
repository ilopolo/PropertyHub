// Loaded only after explicit online/execute/project/run gates. Tests inject a fake transport instead.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {targetProject} from './financial-coowner-run.mjs';
export async function loadNativeTransport(root,config){
 assert.equal(config.project,targetProject);const env={};
 for(const file of ['.env.local','.env.rls.local','.env.finance-mvcc.local'])Object.assign(env,parseEnv(await readFile(resolve(root,file),'utf8')));
 const presence={database:!!env.FINANCE_QA_DATABASE_URL?.trim(),publicClient:!!env.VITE_SUPABASE_PUBLISHABLE_KEY,ca:false,A:!!(env.RLS_A_EMAIL&&env.RLS_A_PASSWORD),B:!!(env.RLS_B_EMAIL&&env.RLS_B_PASSWORD)};
 const ca=await readFile(resolve(root,'.local/financial-hosted-qa/supabase-ca.crt'),'utf8');presence.ca=ca.includes('BEGIN CERTIFICATE');
 for(const [key,value]of Object.entries(presence))assert(value,'Missing credential/configuration: '+key);
 const url='https://'+targetProject+'.supabase.co';assert.equal(env.VITE_SUPABASE_URL,url,'Wrong public client project');
 assert(!env.VITE_SUPABASE_PUBLISHABLE_KEY.startsWith('sb_secret_'),'Operator key refused as frontend identity');
 if(!env.VITE_SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')){let role;try{role=JSON.parse(Buffer.from(env.VITE_SUPABASE_PUBLISHABLE_KEY.split('.')[1],'base64url').toString()).role;}catch{}assert.equal(role,'anon','Only publishable/legacy anon client keys are allowed');}
 const uri=new URL(env.FINANCE_QA_DATABASE_URL);assert(['postgres:','postgresql:'].includes(uri.protocol));assert.equal(uri.port||'5432','5432');assert.equal(uri.pathname,'/postgres');
 assert(uri.hostname===`db.${targetProject}.supabase.co`||uri.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(uri.username).endsWith('.'+targetProject),'Wrong PostgreSQL project');
 for(const k of ['sslmode','sslcert','sslkey','sslrootcert'])uri.searchParams.delete(k);
 const {default:pg}=await import(pathToFileURL(resolve(root,'.local/financial-hosted-qa/native-tools/node_modules/pg/lib/index.js')).href);
 const {createClient}=await import('@supabase/supabase-js');
 return{project:targetProject,invocation:randomUUID(),presence:async()=>presence,
  async connect(name){const c=new pg.Client({connectionString:uri.href,ssl:{rejectUnauthorized:true,ca},connectionTimeoutMillis:15000,query_timeout:20000,application_name:('ph_b2_'+config.run+'_'+name).slice(0,63)});c.on('error',()=>{});await c.connect();return c;},
  async login(who){
   const client=createClient(url,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init={})=>{assert.equal(new URL(typeof input==='string'?input:input.url).origin,url);return fetch(input,{...init,redirect:'error',signal:init.signal??AbortSignal.timeout(18000)});}}});
   const r=await client.auth.signInWithPassword({email:env['RLS_'+who+'_EMAIL'],password:env['RLS_'+who+'_PASSWORD']});assert(!r.error&&r.data.session,'Ordinary synthetic login failed');
   const claims=JSON.parse(Buffer.from(r.data.session.access_token.split('.')[1],'base64url').toString());assert.equal(claims.role,'authenticated');assert(claims.session_id);return{client,user:r.data.user,claims};
  },
  async rpc(s,name,params){const r=await s.client.rpc(name,params).retry(false).abortSignal(AbortSignal.timeout(18000));return{status:r.status,code:r.error?.code??null,errorName:/^[a-z][a-z0-9_]*$/.test(r.error?.message||'')?r.error.message:null,data:r.error?null:r.data,id:typeof r.data==='string'?r.data:r.data?.version_id??null};}
 };
}
