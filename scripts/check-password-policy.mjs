import assert from 'node:assert/strict';
import { validNewPassword, requireNewPassword } from '../src/domain/password.js';
for (const [value, expected] of [['abcdef1',false], ['abcdefgh',false], ['abcdefg1',true], ['12345678',true], ['парола12',true], ['a'.repeat(256)+'1',false]]) {
  assert.equal(validNewPassword(value),expected);
  if (!expected) assert.throws(()=>requireNewPassword(value));
}
console.log('PASS: new-password boundaries, digit-only and lowercase permitted (domain, not hosted API).');
