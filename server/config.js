// Runtime configuration, read once from the environment.
// Every setting has a development default so the app runs with no setup;
// in production the secrets must be set explicitly.

const env = process.env;
const isProd = env.NODE_ENV === 'production';

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function secret(name, devDefault) {
  if (env[name]) return env[name];
  if (isProd) {
    throw new Error(`${name} must be set when NODE_ENV=production`);
  }
  return devDefault;
}

export const config = {
  isProd,
  port: int(env.PORT, 3000),
  // Public origin used inside QR codes and push payloads, e.g. https://crowdfeed.example.org
  // When empty the origin of the incoming request is used.
  baseUrl: (env.BASE_URL || '').replace(/\/+$/, ''),
  trustProxy: env.TRUST_PROXY !== 'false',

  // SQLite file by default; a libsql:// URL plus token switches to a hosted Turso database.
  databaseUrl: env.DATABASE_URL || 'file:data/crowdfeed.db',
  databaseAuthToken: env.DATABASE_AUTH_TOKEN || undefined,

  adminPassword: secret('ADMIN_PASSWORD', 'admin'),
  sessionSecret: secret('SESSION_SECRET', 'development-session-secret'),
  couponSecret: env.COUPON_SECRET || secret('SESSION_SECRET', 'development-session-secret'),

  vapidPublicKey: env.VAPID_PUBLIC_KEY || '',
  vapidPrivateKey: env.VAPID_PRIVATE_KEY || '',
  vapidSubject: env.VAPID_SUBJECT || 'mailto:crowdfeed@example.org',

  survey: {
    minQuestions: int(env.SURVEY_MIN_QUESTIONS, 5),
    maxQuestions: int(env.SURVEY_MAX_QUESTIONS, 8),
    sessionTtlHours: int(env.SESSION_TTL_HOURS, 24),
    defaultRadiusM: int(env.PRESENCE_RADIUS_M, 75)
  },
  couponValidDays: int(env.COUPON_VALID_DAYS, 30),
  adminSessionHours: int(env.ADMIN_SESSION_HOURS, 12),
  seedOnStart: env.SEED_ON_START !== 'false'
};
