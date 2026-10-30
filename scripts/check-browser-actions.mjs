import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

// Intentionally writes only stable, isolated synthetic fixtures. Inspect actual rows before retrying.
for (const f of ['.env.local', '.env.rls.local']) loadEnvFile(f);
const m = JSON.parse(await readFile('.local/rls-fixtures.json', 'utf8'));
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:4173';
const report = { checks: [], next: 'login' };
const save = () => writeFile('.local/browser-qa/actions-report.json', JSON.stringify(report, null, 2));
const unwrap = result => { assert.ok(!result.error, 'Ordinary-session API operation failed'); return result.data; };
const client = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let browser;
try {
  assert.equal(process.env.VITE_SUPABASE_URL, m.project);
  assert.match(process.env.RLS_A_EMAIL, /^rls-a-[a-f0-9]+@propertyhub\.invalid$/);
  unwrap(await client.auth.signInWithPassword({ email: process.env.RLS_A_EMAIL, password: process.env.RLS_A_PASSWORD }));
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 375, height: 1000 } });
  await page.goto(`${base}/pages/login.html`);
  await page.locator('#login-email').fill(process.env.RLS_A_EMAIL);
  await page.locator('#login-password').fill(process.env.RLS_A_PASSWORD);
  await page.locator('#login button').click(); await page.waitForURL('**/pages/account.html');
  await page.goto(`${base}/pages/organization-admin.html`); await page.waitForLoadState('networkidle');
  const label = 'DEV-02 browser QA revoked setup';
  let requests = unwrap(await client.from('scope_setup_requests').select('id,status,scope_id').eq('organization_id', m.org.A).eq('label', label));
  assert.ok(requests.length <= 1, 'Duplicate synthetic requests require inspection');
  if (!requests.length) {
    report.next = 'submit initial setup through browser'; await save();
    await page.locator('#setup-label').fill(label); await page.locator('#setup-target').fill(m.users.A);
    await page.locator('#scope-setup button').click(); await page.waitForLoadState('networkidle');
    await page.locator('#setups article').filter({ hasText: label }).waitFor();
    requests = unwrap(await client.from('scope_setup_requests').select('id,status,scope_id').eq('organization_id', m.org.A).eq('label', label));
  }
  assert.equal(requests.length, 1); report.request = requests[0].id; await save();
  if (requests[0].status === 'pending') {
    assert.equal(requests[0].scope_id, null);
    report.next = 'revoke exact synthetic setup through browser'; await save();
    await page.locator('#setups article').filter({ hasText: label }).getByRole('button').click();
    await page.waitForFunction(() => [...document.querySelectorAll('#setups article')].some(e => e.textContent.includes('DEV-02 browser QA revoked setup') && e.textContent.includes('оттеглена')));
  }
  const closed = unwrap(await client.from('scope_setup_requests').select('status,scope_id').eq('id', report.request).single());
  assert.equal(closed.status, 'revoked'); assert.equal(closed.scope_id, null);
  report.checks.push('initial setup submitted/revoked through UI; real row revoked with no scope'); await save();
  report.next = 'create stable synthetic unit through browser'; await save();
  await page.goto(`${base}/pages/buildings.html`); await page.waitForLoadState('networkidle');
  const number = 'BROWSER-QA-01';
  let units = unwrap(await client.from('units').select('id,area,verification_status,recorded_by,source_reference').eq('building_id', m.building.A).eq('unit_number', number));
  assert.ok(units.length <= 1, 'Duplicate synthetic units require inspection');
  if (!units.length) {
    await page.locator('#number').fill(number);
    await page.locator('#unit-known').fill('2026-10-29');
    await page.locator('#unit-reference').fill('DEV-02 synthetic browser declaration');
    await page.locator('#create-unit button').click();
    await page.locator('#units li').filter({ hasText: number }).waitFor();
    units = unwrap(await client.from('units').select('id,area,verification_status,recorded_by,source_reference').eq('building_id', m.building.A).eq('unit_number', number));
    assert.equal(units[0]?.verification_status, 'needs_review');
  }
  assert.equal(units.length, 1); report.unit = units[0].id; await save();
  assert.equal(units[0].area, null); assert.equal(units[0].recorded_by, m.profiles.A);
  assert.equal(units[0].source_reference, 'DEV-02 synthetic browser declaration');
  report.checks.push('UI unit creation persisted provenance and unknown area');
  report.next = 'verify exact synthetic unit through browser'; await save();
  if (units[0].verification_status !== 'verified') {
    const form = page.locator(`#verify-${report.unit}`);
    await form.locator('input').fill('Synthetic supplied values reviewed; unknown area remains unknown');
    await form.locator('button').click();
    await page.locator('#units li').filter({ hasText: number }).filter({ hasText: 'проверени въведени стойности' }).waitFor();
  }
  const actual = unwrap(await client.from('units').select('verification_status,verified_by,area').eq('id', report.unit).single());
  assert.equal(actual.verification_status, 'verified'); assert.equal(actual.verified_by, m.profiles.A); assert.equal(actual.area, null);
  report.checks.push('UI separate verification persisted reviewer; unknown area stayed NULL');
  report.next = 'complete'; await save();
  console.log('PASS: synthetic UI setup/revoke and unit create/verify; actual rows checked with ordinary A session.');
} catch {
  await save(); console.error(`FAIL: browser action stage ${report.next}; inspect local report and server state before retry.`); process.exitCode = 1;
} finally { await browser?.close(); await client.auth.signOut({ scope: 'local' }); }
