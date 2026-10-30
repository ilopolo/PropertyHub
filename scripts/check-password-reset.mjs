import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Real browser/application/SDK, isolated HTTP contract stubs. No email is sent and
// no real account/password/session is used. This is NOT a hosted recovery test.
const base = process.env.CHECK_BASE_URL || 'http://127.0.0.1:4173';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Local QA only');
const output = '.local/password-reset-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
let phase = 'start';
let activePage;
try {
  for (const width of [375, 1440]) for (const theme of ['light', 'dark']) {
    phase = `${width}/${theme}`;
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme });
    const page = await context.newPage();
    activePage = page;
    const errors = [];
    page.on('pageerror', () => errors.push('pageerror'));
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('422')) errors.push('console.error'); });
    page.on('response', response => { if (response.url().startsWith(base) && response.status() >= 400) errors.push('asset-http-error'); });
    let recoveryRedirect;
    let requests = 0, updates = 0, unexpected = 0;
    let rejectUpdate = false;
    const user = { id: '00000000-0000-4000-8000-000000000001', email: 'recovery-ui@example.invalid', email_confirmed_at: '2026-01-01T00:00:00Z', user_metadata: {} };
    await page.route('**/auth/v1/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      let body = {};
      let status = 200;
      if (url.pathname.endsWith('/recover')) {
        requests++;
        recoveryRedirect = new URL(url.searchParams.get('redirect_to'));
        assert.equal(recoveryRedirect.origin, base);
        assert.equal(recoveryRedirect.pathname, '/pages/account.html');
        const data = request.postDataJSON();
        assert.ok(data.code_challenge && data.code_challenge_method === 's256');
      } else if (url.pathname.endsWith('/token') && url.searchParams.get('grant_type') === 'pkce') {
        assert.ok(request.postDataJSON().code_verifier);
        body = { access_token: 'local-contract-access', refresh_token: 'local-contract-refresh', token_type: 'bearer', expires_in: 3600, user };
      } else if (url.pathname.endsWith('/user')) {
        body = user;
        if (request.method() === 'PUT') {
          updates++;
          assert.ok(Object.keys(request.postDataJSON()).every(key => ['password', 'code_challenge', 'code_challenge_method'].includes(key)));
          if (rejectUpdate) { status = 422; body = { code: 'weak_password', error_code: 'weak_password', msg: 'test-only rejected password' }; }
        }
      } else if (!url.pathname.endsWith('/logout')) { unexpected++; status = 400; }
      await route.fulfill({ status, headers: { 'x-supabase-api-version': '2024-01-01', 'access-control-expose-headers': 'x-supabase-api-version' }, contentType: 'application/json', body: JSON.stringify(body) });
    });
    // Fail closed if the tested screens attempt any database operation.
    await page.route('**/rest/v1/**', async route => { unexpected++; await route.abort(); });
    await page.goto(`${base}/pages/login.html`);
    await page.locator('#password-reset summary').click();
    await page.locator('#password-reset-request button').click();
    assert.equal(requests, 0, 'Empty email must not submit');
    await page.locator('#reset-email').fill('recovery-ui@example.invalid');
    await page.locator('#password-reset-request button').click();
    await page.getByText('Ако адресът е допустим,', { exact: false }).waitFor();
    assert.equal(requests, 1);
    assert.equal(await page.locator('#reset-email').inputValue(), '');
    assert.ok(!await page.locator('#message').textContent().then(text => text.includes(user.email)));
    for (const target of ['request', 'recovery']) {
      if (target === 'recovery') {
        recoveryRedirect.searchParams.set('code', 'local-contract-code');
        await page.goto(recoveryRedirect.href);
        await page.locator('#password-recovery:visible').waitFor();
        await page.reload();
        await page.locator('#password-recovery:visible').waitFor();
        assert.equal(new URL(page.url()).search, '');
        assert.equal(await page.locator('#signed-in').isVisible(), false);
      }
      if (await page.locator('html').getAttribute('data-bs-theme') !== theme) await page.locator('#theme-toggle').click();
      const geometry = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth, missing: [...document.images].filter(i => !i.complete || !i.naturalWidth).length }));
      assert.ok(geometry.scroll <= width + 1);
      assert.equal(geometry.missing, 0);
      const screenshot = `${output}/${target}-${width}-${theme}.png`;
      await page.screenshot({ path: screenshot, fullPage: true });
      results.push({ target, width, theme, screenshot, geometry });
    }
    await page.locator('#new-password').fill('Local-test-password-01');
    await page.locator('#new-password-confirm').fill('short');
    await page.locator('#password-update button').click();
    assert.equal(updates, 0, 'Short password must not submit');
    await page.locator('#new-password-confirm').fill('Local-test-password-02');
    await page.locator('#password-update button').click();
    await page.getByText('Паролите не съвпадат.', { exact: true }).waitFor();
    assert.equal(updates, 0);
    await page.locator('#new-password-confirm').fill('Local-test-password-01');
    phase = `${width}/${theme}/server-password-rejection`;
    rejectUpdate = true;
    await page.locator('#password-update button').click();
    await page.getByText('Паролата не отговаря на изискванията.', { exact: false }).waitFor();
    assert.equal(updates, 1);
    assert.ok(await page.locator('#password-update').isVisible());
    phase = `${width}/${theme}/update-success`;
    rejectUpdate = false;
    await page.locator('#password-update button').click();
    await page.getByText('Новата парола е запазена.', { exact: false }).waitFor();
    assert.equal(updates, 2);
    assert.equal(await page.locator('#new-password').inputValue(), '');
    assert.equal(await page.locator('#password-update').isVisible(), false);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('propertyhub.password-recovery-user')), null);
    phase = `${width}/${theme}/logout`;
    await page.locator('#recovery-logout').click();
    await page.locator('#signed-out:visible').waitFor();
    assert.equal(await page.locator('#password-recovery').isVisible(), false);
    assert.equal(unexpected, 0);
    assert.deepEqual(errors, []);
    await context.close();
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  activePage = page;
  let externalRequests = 0;
  await page.route('**/auth/v1/**', async route => { externalRequests++; await route.abort(); });
  for (const suffix of ['?type=recovery', '#error=access_denied&error_code=otp_expired', '?code=local-code-without-verifier']) {
    phase = `negative-callback-${suffix.includes('code=local') ? 'missing-verifier' : suffix.includes('otp_expired') ? 'expired' : 'url-only'}`;
    await page.goto(`${base}/pages/account.html${suffix}`);
    await page.locator('#signed-out:visible').waitFor();
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('#password-recovery').isVisible(), false);
    assert.equal(new URL(page.url()).searchParams.has('code'), false);
    assert.equal(new URL(page.url()).hash, '');
  }
  // An email follows an external verification URL and creates a fresh document.
  // Avoid turning the fixture into a same-document hash-only navigation.
  await page.goto(`${base}/pages/login.html`);
  await page.evaluate(() => sessionStorage.setItem('propertyhub.password-recovery-requested', 'true'));
  phase = 'recovery-expired-notice';
  await page.goto(`${base}/pages/account.html#error=access_denied&error_code=otp_expired`);
  await page.getByText('Възстановяването не завърши.', { exact: false }).waitFor();
  assert.equal(await page.locator('#password-recovery').isVisible(), false);
  assert.equal(externalRequests, 0, 'Invalid callbacks must not send recovery operations');
  await context.close();
  await writeFile(`${output}/report.json`, JSON.stringify({ status: 'contract-pass; visual review pending', results, hostedRecovery: 'NOT PASSED; SMTP required' }, null, 2));
  console.log(`PASS: isolated real-browser reset UI/SDK contract; ${results.length} screenshots await visual review. No hosted Auth changes/email delivery; real recovery NOT PASSED.`);
} catch (error) {
  const notice = await activePage?.locator('#message').textContent().catch(() => null);
  await writeFile(`${output}/report.json`, JSON.stringify({ status: 'failed', phase, errorType: error.name, notice, results }, null, 2));
  console.error(`FAIL: isolated reset UI contract at ${phase}; sensitive values suppressed.`);
  process.exitCode = 1;
} finally { await browser.close(); }
