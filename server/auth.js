// Two kinds of privileged users: the administrator (one password, cookie
// session) and venue staff (a per-venue PIN sent with each redeem request).

import crypto from 'node:crypto';
import { config } from './config.js';
import { db, now } from './db.js';
import { HttpError, randomId } from './util.js';

const COOKIE = 'cf_admin';

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function timingSafeEqualText(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function signSessionId(id) {
  return crypto.createHmac('sha256', config.sessionSecret).update(id).digest('base64url');
}

export async function loginAdmin(password, res) {
  if (!timingSafeEqualText(password || '', config.adminPassword)) {
    throw new HttpError(401, 'Wrong password');
  }
  const id = randomId(24);
  const expires = new Date(Date.now() + config.adminSessionHours * 3600 * 1000);
  await db.run('INSERT INTO admin_sessions (id, created_at, expires_at) VALUES (?, ?, ?)', [id, now(), expires.toISOString()]);
  const value = `${id}.${signSessionId(id)}`;
  const attrs = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${config.adminSessionHours * 3600}`];
  if (config.isProd) attrs.push('Secure');
  res.set('Set-Cookie', attrs.join('; '));
}

export async function logoutAdmin(req, res) {
  const cookies = parseCookies(req.get('cookie'));
  const value = cookies[COOKIE];
  if (value) {
    const [id] = value.split('.');
    await db.run('DELETE FROM admin_sessions WHERE id = ?', [id]);
  }
  res.set('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

export async function requireAdmin(req, res, next) {
  try {
    const cookies = parseCookies(req.get('cookie'));
    const value = cookies[COOKIE];
    if (!value) throw new HttpError(401, 'Sign in required');
    const [id, sig] = value.split('.');
    if (!id || !sig || !timingSafeEqualText(sig, signSessionId(id))) throw new HttpError(401, 'Sign in required');
    const row = await db.get('SELECT id, expires_at FROM admin_sessions WHERE id = ?', [id]);
    if (!row || new Date(row.expires_at) < new Date()) throw new HttpError(401, 'Session expired, sign in again');
    next();
  } catch (err) {
    next(err);
  }
}

// Staff PINs are stored hashed with scrypt.
export function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPin(pin, stored) {
  if (!stored || typeof pin !== 'string' || pin.length === 0) return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pin, Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}
