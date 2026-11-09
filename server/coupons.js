// Coupon codes are random, human-readable and signed, so a QR code can be
// checked for authenticity before the database is consulted, and a photo of
// someone else's code cannot be altered into a new one.

import crypto from 'node:crypto';
import { config } from './config.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32, no I, L, O, U

function base32(buffer, length) {
  let out = '';
  for (let i = 0; out.length < length; i++) {
    out += ALPHABET[buffer[i % buffer.length] % 32];
  }
  return out;
}

export function newCode() {
  return base32(crypto.randomBytes(12), 10);
}

export function sign(code) {
  const mac = crypto.createHmac('sha256', config.couponSecret).update(code).digest();
  return base32(mac, 8);
}

export function tokenFor(code) {
  return `${code}-${sign(code)}`;
}

// Accepts "CODE-SIG", a redeem URL containing it, or a hand-typed code with
// lowercase letters and spaces. Returns the code when the signature is valid.
export function parseToken(input) {
  if (typeof input !== 'string') return null;
  let text = input.trim();
  const m = text.match(/\/r\/([0-9A-Za-z-]+)/);
  if (m) text = m[1];
  text = text.toUpperCase().replace(/[\s]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  const parts = text.split('-');
  if (parts.length !== 2) return null;
  const [code, sig] = parts;
  if (code.length !== 10 || sig.length !== 8) return null;
  const expected = sign(code);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return code;
}

export function formatForDisplay(token) {
  const [code, sig] = token.split('-');
  return `${code.slice(0, 5)} ${code.slice(5)} ${sig}`;
}
