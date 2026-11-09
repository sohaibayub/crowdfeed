import test from 'node:test';
import assert from 'node:assert/strict';
import { newCode, sign, tokenFor, parseToken, formatForDisplay } from '../server/coupons.js';

test('codes are ten characters from the Crockford alphabet', () => {
  for (let i = 0; i < 50; i++) assert.match(newCode(), /^[0-9A-HJKMNP-TV-Z]{10}$/);
});

test('tokens round-trip and tolerate human input', () => {
  const code = newCode();
  const token = tokenFor(code);
  assert.equal(parseToken(token), code);
  assert.equal(parseToken(token.toLowerCase()), code);
  assert.equal(parseToken(`https://example.org/r/${token}`), code);
  assert.equal(parseToken(formatForDisplay(token).replace(/ /g, '')), null, 'display form without the dash is not a token');
  assert.equal(parseToken(`${code.slice(0, 5)} ${code.slice(5)}-${sign(code)}`), code);
});

test('a tampered code or signature is rejected', () => {
  const code = newCode();
  const token = tokenFor(code);
  const flipped = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
  assert.equal(parseToken(flipped), null);
  assert.equal(parseToken(`${code}-AAAAAAAA`), null);
  assert.equal(parseToken('nonsense'), null);
});
