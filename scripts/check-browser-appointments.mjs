import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

for (const file of ['.env.local', '.env.rls.local']) loadEnvFile(file);
const m = JSON.parse(await readFile('.local/rls-fixtures.json', 'utf8'));
const base = 'https://propertyhub-ilopolo.netlify.app';
const path = '.local/browser-qa-live/appointments-report.json';
const label = 'DEV-02 browser QA accepted scope';
const report = { checks: [], phase: 'login' };
const save = () => writeFile(path, JSON.stringify(report, null, 2));
const unwrap = r => { assert.ok(!r.error, 'Ordinary-session API operation failed'); return r.data; };
const client = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let browser;
try {
  assert.equal(m.project, 'https://qfybswnezdzzahmozikr.supabase.co');
  assert.equal(process.env.VITE_SUPABASE_URL, m.project);
  assert.match(process.env.RLS_A_EMAIL, /^rls-a-[a-f0-9]+@propertyhub\.invalid$/);
  unwrap(await client.auth.signInWithPassword({ email: process.env.RLS_A_EMAIL, password: process.env.RLS_A_PASSWORD }));
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 375, height: 1000 }, colorScheme: 'light' });
  const errors = [];
  page.on('pageerror', () => errors.push('pageerror'));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('console.error'); });
  await page.goto(`${base}/pages/login.html`);
  await page.locator('#login-email').fill(process.env.RLS_A_EMAIL);
  await page.locator('#login-password').fill(process.env.RLS_A_PASSWORD);
  await page.locator('#login button').click(); await page.waitForURL('**/pages/account.html');
  const requests = () => client.from('scope_setup_requests').select('id,status,scope_id').eq('organization_id', m.org.A).eq('label', label);
  let setup = unwrap(await requests()); assert.ok(setup.length <= 1, 'Duplicate setup requires inspection');
  if (!setup.length) {
    report.phase = 'submit setup'; await save();
    await page.goto(`${base}/pages/organization-admin.html`); await page.waitForLoadState('networkidle');
    await page.locator('#setup-label').fill(label); await page.locator('#setup-target').fill(m.users.A);
    await page.locator('#scope-setup button').click();
    await page.locator('#setups article').filter({ hasText: label }).waitFor();
    setup = unwrap(await requests());
  }
  assert.equal(setup.length, 1); report.request = setup[0].id; await save();
  if (setup[0].status === 'pending') {
    report.phase = 'inbox visual matrix then accept setup'; await save();
    await page.goto(`${base}/pages/buildings.html`); await page.waitForLoadState('networkidle');
    assert.ok(await page.locator('#setup-inbox').isVisible());
    for (const width of [375, 1440]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 1000 });
      if (await page.locator('html').getAttribute('data-bs-theme') !== theme) await page.locator('#theme-toggle').click();
      await page.reload(); await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('html').getAttribute('data-bs-theme'), theme);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `.local/browser-qa-live/inbox-${width}-${theme}.png`, fullPage: true });
    }
    await page.locator('#setup-request').selectOption(report.request);
    await page.locator('#setup-address').fill('Synthetic browser scope address A');
    await page.locator('#setup-entrance').fill('QA');
    await page.locator('#setup-known').fill('2026-10-29');
    await page.locator('#setup-reference').fill('Synthetic browser scope declaration');
    await page.locator('#complete-setup button').click();
    await page.waitForFunction(label => [...document.querySelectorAll('#scope option')].some(e => e.textContent.includes(label)), label);
    setup = unwrap(await requests());
  }
  assert.equal(setup[0].status, 'fulfilled'); report.scope = setup[0].scope_id; assert.ok(report.scope); await save();
  m.extraScopes ||= {}; m.extraScopes.A = [...new Set([...(m.extraScopes.A || []), report.scope])];
  await writeFile('.local/rls-fixtures.json', JSON.stringify(m, null, 2));
  const scope = unwrap(await client.from('management_units').select('id,source_reference,verification_status').eq('id', report.scope).single());
  assert.equal(scope.source_reference, 'Synthetic browser scope declaration'); assert.equal(scope.verification_status, 'needs_review');
  const managers = unwrap(await client.from('user_roles').select('id,permissions').eq('profile_id', m.profiles.A).eq('scope_id', report.scope).eq('role_code', 'manager').is('valid_to', null));
  assert.equal(managers.length, 1); assert.deepEqual(managers[0].permissions, ['read_registry', 'manage_registry']);
  report.manager = managers[0].id; report.checks.push('UI exact-recipient setup accepted; persisted scope/provenance and separate manager grant'); await save();
  await page.goto(`${base}/pages/organization-admin.html`); await page.waitForLoadState('networkidle');
  const controllers = () => client.from('user_roles').select('id,valid_to,permissions').eq('profile_id', m.profiles.A).eq('scope_id', report.scope).eq('role_code', 'controller');
  let roles = unwrap(await controllers()); assert.ok(roles.length <= 1, 'Unexpected extra controller roles require inspection');
  if (!roles.length) {
    report.phase = 'assign self-controller in exact new synthetic scope'; await save();
    await page.locator('#staff-context').selectOption(report.scope);
    await page.locator('#staff-auth').fill(m.users.A);
    await page.locator('#staff-role').selectOption('controller');
    await page.locator('#assign-staff button').click();
    await page.waitForFunction(() => document.querySelector('#staff')?.textContent.includes('controller'));
    roles = unwrap(await controllers()); assert.equal(roles.length, 1); assert.equal(roles[0].valid_to, null);
  }
  assert.deepEqual(roles[0].permissions, ['read_registry']); report.controller = roles[0].id; await save();
  if (!roles[0].valid_to) {
    report.phase = 'revoke exact synthetic controller'; await save();
    await page.locator('#staff article').filter({ hasText: report.controller }).getByRole('button').click();
    await page.locator('#staff article').filter({ hasText: report.controller }).filter({ hasText: 'извън текущ период' }).waitFor();
  }
  assert.ok(unwrap(await controllers())[0].valid_to);
  assert.equal(unwrap(await client.from('user_roles').select('id').eq('id', report.manager).is('valid_to', null)).length, 1);
  report.checks.push('UI controller assigned with read_registry only, then exact grant revoked; independent manager retained');
  assert.deepEqual(errors, []); report.phase = 'complete; inbox screenshots need visual inspection'; await save();
  console.log('PASS: live UI scope acceptance and staff assign/revoke; actual ordinary-session rows checked.');
} catch {
  await save(); console.error(`FAIL: appointments at ${report.phase}; inspect local report and current server rows before retry.`); process.exitCode = 1;
} finally { await browser?.close(); await client.auth.signOut({ scope: 'local' }); }
