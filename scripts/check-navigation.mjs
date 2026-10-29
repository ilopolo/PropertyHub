import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { modules } from '../src/domain/modules.js';

const base = new URL(process.env.CHECK_BASE_URL || 'http://127.0.0.1:4173');
const pages = ['index.html', 'pages/dashboard.html', 'pages/buildings.html', 'pages/account.html', 'pages/admin.html'];
const targets = new Set(pages);
for (const page of pages) {
  const source = await readFile(page, 'utf8');
  for (const [, href] of source.matchAll(/(?:href|src)="(\/[^"]+)"/g)) {
    if (!href.startsWith('/src/')) targets.add(href.slice(1));
  }
  const response = await fetch(new URL(page, base));
  assert.equal(response.status, 200, page);
  const html = await response.text();
  assert.match(html, /lang="bg"/);
  assert.match(html, /<title>/);
  for (const [, asset] of html.matchAll(/(?:href|src)="([^"]+\.(?:css|js))"/g)) {
    const resource = await fetch(new URL(asset, new URL(page, base)));
    assert.equal(resource.status, 200, asset);
  }
}
for (const module of modules.filter(module => module.available)) targets.add(module.href);
for (const target of targets) {
  const response = await fetch(new URL(target, base));
  assert.equal(response.status, 200, target);
  assert.match(await response.text(), /<title>/, target);
}
async function inspect(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const name = `${path}/${entry.name}`;
    if (entry.isDirectory()) {
      assert.ok(!['docs', 'assignment', 'references', 'history'].includes(entry.name), `Private directory in build: ${name}`);
      await inspect(name);
    } else {
      assert.ok(!/^(START_HERE\.md|FILE_MANIFEST\.sha256|\.env)/.test(entry.name), name);
    }
  }
}
await inspect('dist');
console.log(`PASS: ${pages.length} production HTML pages, linked routes/assets; no private package directories in dist. Browser behavior is checked separately.`);
