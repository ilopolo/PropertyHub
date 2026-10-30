import assert from 'node:assert/strict';
import { registryDate, registryToday } from '../src/domain/registry.js';
assert.equal(registryDate('2024-02-29'), '2024-02-29');
for (const value of ['', '2025-02-29', '2026-04-31', '2026-13-01', '0000-01-01', '2026-01-01,scope_id.eq.other']) assert.throws(() => registryDate(value));
assert.equal(registryToday(new Date('2026-10-29T22:30:00Z')), '2026-10-30');
assert.equal(registryToday(new Date('2026-10-29T21:30:00Z')), '2026-10-29');
console.log('PASS: strict calendar dates, invalid filter input and Europe/Sofia midnight. No Auth or DB operations.');
