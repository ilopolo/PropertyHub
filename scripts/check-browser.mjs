import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Real browser and ordinary synthetic user sessions; no privileged key or saved auth state.
for (const file of ['.env.local', '.env.rls.local']) { try { loadEnvFile(file); } catch {} }
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:4173';
const output = base.startsWith('https://') ? '.local/browser-qa-live' : '.local/browser-qa';
const reportPath = `${output}/${process.argv.includes('--contrast') ? 'contrast-report' : 'report'}.json`;
const fixtures = JSON.parse(await readFile('.local/rls-fixtures.json', 'utf8'));
await mkdir(output, { recursive: true });
const results = [];
let phase = 'launch';
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const role of process.argv.includes('--contrast') ? ['A'] : ['A', 'PENDING', 'B']) {
    phase = `login ${role}`;
    const email = process.env[`RLS_${role}_EMAIL`];
    const password = process.env[`RLS_${role}_PASSWORD`];
    assert.ok(/^rls-(a|b|pending)-[a-f0-9]+@propertyhub\.invalid$/.test(email || ''), 'Isolated synthetic account required');
    assert.ok(password, 'Local password required');
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', () => errors.push('pageerror'));
    page.on('console', m => { if (m.type() === 'error') errors.push('console.error'); });
    page.on('response', r => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
    page.on('requestfailed', r => errors.push(`requestfailed ${new URL(r.url()).pathname}`));
    await page.goto(`${base}/pages/login.html`);
    await page.locator('#login-email').fill(email);
    await page.locator('#login-password').fill(password);
    await page.locator('#login button').click();
    await page.waitForURL('**/pages/account.html');
    // No screenshots of account/login pages, credentials, storage, headers or network bodies.
    for (const width of role === 'B' ? [375] : [375, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of role === 'B' ? ['dark'] : ['light', 'dark']) {
        for (const target of ['organization-admin', 'buildings']) {
          if (process.argv.includes('--contrast') && target !== 'organization-admin') continue;
          phase = `${role}/${target}/${width}/${theme}`;
          await page.goto(`${base}/pages/${target}.html`);
          await page.waitForLoadState('networkidle');
          if (await page.locator('html').getAttribute('data-bs-theme') !== theme) await page.locator('#theme-toggle').click();
          await page.reload();
          await page.waitForLoadState('networkidle');
          await page.evaluate(() => document.fonts.ready);
          assert.equal(await page.locator('html').getAttribute('data-bs-theme'), theme);
          const orgPage = target === 'organization-admin';
          const gate = page.locator(orgPage ? '#org-admin' : '#registry');
          assert.equal(await gate.isVisible(), role !== 'PENDING', 'Role gate mismatch');
          if (role !== 'PENDING') {
            const options = await page.locator(orgPage ? '#organization option' : '#scope option').evaluateAll(nodes => nodes.map(n => n.value));
            assert.deepEqual(options, [orgPage ? fixtures.org[role] : fixtures.scope[role]], 'Foreign or missing context');
            if (!orgPage) assert.equal(await page.locator('#unit-create').isVisible(), true);
          } else {
            assert.equal(await page.locator(orgPage ? '#scope-setup' : '#create-unit').isVisible(), false);
          }
          assert.equal(await page.locator('#message.alert-danger:visible').count(), 0, 'Unexpected application error');
          const geometry = await page.evaluate(() => {
            const visible = [...document.querySelectorAll('main input, main select, main button')].filter(e => e.getClientRects().length);
            return {
              viewport: innerWidth, scroll: document.documentElement.scrollWidth,
              outside: visible.filter(e => { const r = e.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; }).map(e => e.id || e.tagName),
              missingImages: [...document.images].filter(i => !i.complete || !i.naturalWidth).length,
            };
          });
          const dangerContrast = await page.locator('.btn-outline-danger').evaluateAll(buttons => {
            const rgb = css => (css.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
            const luminance = c => c.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
            return buttons.map(button => {
              let parent = button;
              while (parent.parentElement && ['rgba(0, 0, 0, 0)', 'transparent'].includes(getComputedStyle(parent).backgroundColor)) parent = parent.parentElement;
              const a = luminance(rgb(getComputedStyle(button).color));
              const b = luminance(rgb(getComputedStyle(parent).backgroundColor));
              return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
            });
          });
          const screenshot = `${output}/${role}-${target}-${width}-${theme}.png`;
          await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
          results.push({ role, target, width, theme, screenshot, geometry, dangerContrast, errors: [...errors] });
          assert.ok(dangerContrast.every(ratio => ratio >= 4.5), 'Destructive button text contrast below 4.5:1');
          assert.ok(geometry.scroll <= width + 1, 'Horizontal overflow');
          assert.deepEqual(geometry.outside, [], 'Controls outside viewport');
          assert.equal(geometry.missingImages, 0);
          assert.deepEqual(errors, [], 'Browser errors');
          // Follow an actual application navigation link before the next deep-link load.
          await page.locator('a[href="/pages/account.html"]').first().click();
          await page.waitForURL('**/pages/account.html');
        }
      }
    }
    await context.close();
  }
  await writeFile(reportPath, JSON.stringify({ base, status: 'automated-pass; visual inspection pending', results }, null, 2));
  console.log(`PASS: ${results.length} real-browser role/viewport/theme cases; screenshots require human/agent inspection.`);
} catch {
  await writeFile(reportPath, JSON.stringify({ base, status: 'failed', phase, results }, null, 2));
  console.error(`FAIL: browser QA at ${phase}; no credentials or raw browser call logs emitted.`);
  process.exitCode = 1;
} finally { await browser?.close(); }
