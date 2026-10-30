import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';

// Operator-only Node entry point. Never import this from src/ or an HTML entry.
const url = 'https://qfybswnezdzzahmozikr.supabase.co';
const operator = parseEnv(await readFile('.env.operator.local', 'utf8'));
if (!operator.SUPABASE_OPERATOR_SECRET?.startsWith('sb_secret_')) {
  throw new Error('Set SUPABASE_OPERATOR_SECRET in ignored .env.operator.local. Do not use a VITE variable.');
}
const path = '.env.rls.local';
let existing = {};
try { existing = parseEnv(await readFile(path, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
if (Object.values(existing).some(Boolean)) throw new Error('RLS credentials already exist; inspect them before creating users.');
// Check these paths are ignored before writing any password.
const { execFileSync } = await import('node:child_process');
for (const file of ['.env.operator.local', path]) {
  execFileSync('git', ['check-ignore', '--quiet', file]);
  if (execFileSync('git', ['ls-files', '--', file], { encoding: 'utf8' }).trim()) throw new Error('Credential path is tracked.');
}
if (!process.argv.includes('--create')) {
  console.log('READY: project verified; use node scripts/create-rls-users.mjs --create to create exactly A/B/PENDING synthetic users.');
  process.exit(0);
}
const client = createClient(url, operator.SUPABASE_OPERATOR_SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomBytes(8).toString('hex');
let content = '# Synthetic users only. Never commit this file.\n';
let completed = 0;
for (const label of ['A', 'B', 'PENDING']) {
  const email = `rls-${label.toLowerCase()}-${run}@propertyhub.invalid`;
  const password = randomBytes(32).toString('base64url') + 'aA1!';
  const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user?.email_confirmed_at) {
    // Preserve completed accounts locally; do not log the error payload or retry creation blindly.
    console.error(`BLOCKED: operator createUser failed for ${label} (HTTP ${error?.status || 'unknown'}). ${completed} accounts saved locally; inspect before retry.`);
    process.exit(1);
  }
  content += `RLS_${label}_EMAIL=${email}\nRLS_${label}_PASSWORD=${password}\n`;
  await writeFile(path, content, { mode: 0o600 });
  completed++;
  console.log(`CREATED: synthetic ${label}; credentials saved only in ignored local file.`);
}
console.log('READY: three confirmed Auth accounts. No organizations, grants or fixtures were created. Remove the operator secret locally after setup.');
