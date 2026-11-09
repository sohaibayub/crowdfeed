import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function randomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

// Distance in metres between two WGS84 points.
export function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function timeOfDay(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export const AGE_BANDS = ['18-24', '25-34', '35-44', '45-54', '55+', 'undisclosed'];
export const GENDERS = ['woman', 'man', 'non-binary', 'undisclosed'];
export const VISIT_FREQUENCIES = ['first', 'occasional', 'regular'];
export const WIDGETS = ['radio', 'segmented', 'rank', 'stars', 'smileys', 'slider', 'smileyslider', 'thumbs', 'text'];
export const VENUE_TYPES = ['restaurant', 'cafe', 'grocery', 'clothing', 'shoes', 'pharmacy', 'bank', 'general'];

export function str(value, { max = 200, required = false, name = 'value' } = {}) {
  if (value == null || value === '') {
    if (required) throw new HttpError(400, `${name} is required`);
    return '';
  }
  if (typeof value !== 'string') throw new HttpError(400, `${name} must be text`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, `${name} is too long`);
  return trimmed;
}

export function oneOf(value, allowed, name, fallback) {
  if (value == null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new HttpError(400, `${name} is required`);
  }
  if (!allowed.includes(value)) throw new HttpError(400, `${name} is not valid`);
  return value;
}

export function num(value, { min = -Infinity, max = Infinity, name = 'value', optional = false } = {}) {
  if (value == null || value === '') {
    if (optional) return null;
    throw new HttpError(400, `${name} is required`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name} is out of range`);
  return n;
}

// Small fixed-window rate limiter kept in memory. Good enough for one instance.
export function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, entry] of hits) if (entry.start < cutoff) hits.delete(key);
  }, windowMs).unref();
  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const entry = hits.get(key);
    const nowMs = Date.now();
    if (!entry || entry.start < nowMs - windowMs) {
      hits.set(key, { start: nowMs, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.start + windowMs - nowMs) / 1000)));
      return next(new HttpError(429, 'Too many requests, please wait a moment'));
    }
    next();
  };
}

export function publicOrigin(req, configuredBase) {
  if (configuredBase) return configuredBase;
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${req.get('host')}`;
}

export function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function csvEscape(value) {
  if (value == null) return '';
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
