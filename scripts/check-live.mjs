import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

loadEnvFile('.env.rls.local');
const base = 'https://propertyhub-ilopolo.netlify.app';
const pages = ['index', 'dashboard', 'buildings', 'account', 'admin', 'login', 'register', 'platform-admin', 'organization-admin'];
const output = '.local/browser-qa-live';
await mkdir(output, { recursive: true });
const checks = [];
let phase = 'launch';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', () => errors.push('pageerror'));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error'); });
  for (const name of pages) {
    phase = `deep link ${name}`;
    const response = await page.goto(`${base}/${name === 'index' ? 'index.html' : `pages/${name}.html`}`);
    assert.equal(response.status(), 200);
    const headers = await response.allHeaders();
    assert.equal(headers['x-content-type-options'], 'nosniff');
    assert.equal(headers['x-frame-options'], 'DENY');
    assert.equal(headers['referrer-policy'], 'no-referrer');
    assert.ok(headers['content-security-policy'].includes("script-src 'self'"));
    assert.ok(!headers['content-security-policy'].includes('unsafe-inline'));
    await page.waitForLoadState('networkidle');
    await page.locator('#theme-toggle').click();
    const theme = await page.locator('html').getAttribute('data-bs-theme');
    await page.reload(); await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('html').getAttribute('data-bs-theme'), theme);
    assert.deepEqual(errors, []);
    checks.push(`${name}: real browser load/reload/theme + security headers`);
  }
  phase = 'synthetic pending login/logout/relogin';
  assert.match(process.env.RLS_PENDING_EMAIL, /^rls-pending-[a-f0-9]+@propertyhub\.invalid$/);
  async function login() {
    await page.goto(`${base}/pages/login.html`);
    await page.locator('#login-email').fill(process.env.RLS_PENDING_EMAIL);
    await page.locator('#login-password').fill(process.env.RLS_PENDING_PASSWORD);
    await page.locator('#login button').click(); await page.waitForURL('**/pages/account.html');
    await page.waitForLoadState('networkidle');
    assert.ok(await page.locator('#signed-in').isVisible());
    assert.match(await page.locator('#account-status').innerText(), /очаква проверено назначение/);
  }
  await login();
  await page.locator('#logout').click(); await page.waitForLoadState('networkidle');
  await page.reload(); await page.waitForLoadState('networkidle');
  assert.ok(await page.locator('#signed-out').isVisible());
  await login();
  await page.locator('#logout').click(); await page.waitForLoadState('networkidle');
  checks.push('live real pending login/logout/reload/relogin, pending preserved');
  phase = 'negative callback handling';
  for (const code of ['otp_expired', 'flow_state_not_found']) {
    await page.goto(`${base}/pages/account.html?error=access_denied&error_code=${code}&error_description=synthetic-marker-must-not-reflect`);
    await page.waitForLoadState('networkidle');
    assert.equal(new URL(page.url()).search, ''); assert.equal(new URL(page.url()).hash, '');
    const body = await page.locator('body').innerText();
    assert.ok(!body.includes('synthetic-marker-must-not-reflect'));
    assert.match(await page.locator('#message').innerText(), code === 'otp_expired' ? /изтекла/ : /Автоматичното влизане не завърши/);
    await page.screenshot({ path: `${output}/callback-${code}.png`, fullPage: true });
  }
  checks.push('negative live callbacks classified and URL/error payload removed; no successful email confirmation claimed');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/live-smoke-report.json`, JSON.stringify({ base, checks, status: 'pass', cleanEmailConfirmation: 'not tested' }, null, 2));
  console.log(`PASS: ${checks.length} live smoke groups; fresh email confirmation remains unverified.`);
} catch {
  await writeFile(`${output}/live-smoke-report.json`, JSON.stringify({ base, phase, checks, status: 'failed' }, null, 2));
  console.error(`FAIL: live smoke at ${phase}; credentials and raw browser messages suppressed.`); process.exitCode = 1;
} finally { await browser.close(); }
