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
for(const table of ['profiles','organizations','user_roles','buildings','units','audit_events']) {
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
