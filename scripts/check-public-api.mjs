import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
try { loadEnvFile('.env.local'); } catch {}
const url=process.env.VITE_SUPABASE_URL;
const key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
assert.equal(url,'https://qfybswnezdzzahmozikr.supabase.co');
assert.ok(key?.startsWith('sb_publishable_'));
const headers={apikey:key,'Content-Type':'application/json'};
const settings=await fetch(`${url}/auth/v1/settings`,{headers});
assert.equal(settings.status,200);
const auth=await settings.json();
assert.equal(auth.external.email,true);
assert.equal(auth.external.anonymous_users,false);
assert.equal(auth.disable_signup,false);
assert.equal(auth.mailer_autoconfirm,false);
console.log('PASS: email signup enabled, confirmation required, anonymous sign-ins disabled.');
const schemas=await fetch(`${url}/rest/v1/profiles?select=id`,{headers:{...headers,'Accept-Profile':'private'}});
assert.equal(schemas.status,406);
const schemaError=await schemas.json();
assert.equal(schemaError.code,'PGRST106');
assert.match(schemaError.hint,/public, graphql_public/);
console.log('PASS: private schema rejected; exposed schemas public, graphql_public.');
for(const table of ['profiles','organizations','user_roles','buildings','units','audit_events','access_requests','scope_setup_requests']) {
 const response=await fetch(`${url}/rest/v1/${table}?select=id`,{headers});
 const body=await response.json();
 assert.ok([401,403].includes(response.status),`anon unexpectedly accessed ${table}`);
 assert.equal(body.code,'42501');
}
console.log('PASS: anonymous reads rejected for profile, access, registry and audit tables.');
const rpc=await fetch(`${url}/rest/v1/rpc/ensure_profile`,{method:'POST',headers,body:'{}'});
assert.ok([401,403].includes(rpc.status));
assert.equal((await rpc.json()).code,'42501');
console.log('PASS: anonymous ensure_profile RPC rejected. No signup requests or user sessions used.');
const nil='00000000-0000-4000-8000-000000000000';
for (const [name,body] of [
 ['request_scope_setup',{org:nil,target_auth_user_id:nil,label:'Anonymous denial probe'}],
 ['complete_scope_setup',{request_id:nil,address:'Anonymous denial probe',entrance_code:null,source_kind:'declaration',source_reference:'Anonymous denial probe',known_from:'2026-01-01'}],
 ['organization_staff',{org:nil}],
 ['revise_organization_request',{request_id:nil,expected_revision:1,name:'Anonymous denial probe',organization_kind:'self_managed'}],
 ['close_organization_request',{request_id:nil,expected_revision:1,decision:'revoked',note:'Anonymous denial probe'}],
 ['activate_organization',{request_id:nil,expected_revision:1,review_note:'Anonymous denial probe'}],
 ['verify_registry_record',{scope:nil,kind:'unit',target:nil,note:'Anonymous denial probe'}],
]) {
 const response=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(body)});
 assert.ok([401,403].includes(response.status),`anon unexpectedly reached ${name}`);
 assert.equal((await response.json()).code,'42501',name);
}
console.log('PASS: new scope, staff, lifecycle and provenance RPCs are present and reject anon execution.');
