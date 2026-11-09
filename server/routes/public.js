import { Router } from 'express';
import { config } from '../config.js';
import { db, now } from '../db.js';
import { pickNextQuestion, publicQuestion, cleanAnswer } from '../engine.js';
import { newCode, tokenFor, parseToken, formatForDisplay } from '../coupons.js';
import { pushEnabled, saveSubscription, removeSubscription } from '../push.js';
import { verifyPin } from '../auth.js';
import {
  HttpError, sha256, randomId, haversineM, timeOfDay, str, oneOf, num, rateLimiter, publicOrigin, parseJson,
  AGE_BANDS, GENDERS, VISIT_FREQUENCIES
} from '../util.js';

export const publicRouter = Router();

const startLimiter = rateLimiter({ windowMs: 60 * 1000, max: 20 });
const redeemLimiter = rateLimiter({ windowMs: 60 * 1000, max: 30 });
const eventLimiter = rateLimiter({ windowMs: 60 * 1000, max: 60 });

function venueView(v, origin) {
  return {
    slug: v.slug,
    name: v.name,
    type: v.type,
    reward: v.reward,
    rewardTerms: v.reward_terms || '',
    hasLocation: v.lat != null && v.lng != null,
    radiusM: v.radius_m,
    url: `${origin}/v/${v.slug}`
  };
}

async function logEvent(type, { sessionId = null, venueId = null, detail = null } = {}) {
  await db.run('INSERT INTO events (session_id, venue_id, type, detail, created_at) VALUES (?, ?, ?, ?, ?)', [
    sessionId, venueId, type, detail == null ? null : JSON.stringify(detail), now()
  ]);
}

async function loadVenueBySlug(slug) {
  const venue = await db.get('SELECT * FROM venues WHERE slug = ? AND active = 1', [slug]);
  if (!venue) throw new HttpError(404, 'This venue is not taking feedback at the moment');
  return venue;
}

async function loadQuestions(venue) {
  // Venue-specific questions override the venue type templates with the same key.
  const rows = await db.all(
    `SELECT * FROM questions WHERE active = 1 AND (venue_id = ? OR (venue_id IS NULL AND venue_type = ?))
     ORDER BY venue_id IS NULL, priority DESC`,
    [venue.id, venue.type]
  );
  const seen = new Set();
  const out = [];
  for (const q of rows) {
    const scopedKey = `${q.key}:${q.conditions}`;
    if (q.venue_id == null && rows.some((o) => o.venue_id != null && o.key === q.key)) continue;
    if (seen.has(scopedKey)) continue;
    seen.add(scopedKey);
    out.push(q);
  }
  return out;
}

async function loadSession(req) {
  const id = str(req.params.id, { max: 64, required: true, name: 'session' });
  const auth = req.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'Missing session token');
  const session = await db.get('SELECT * FROM sessions WHERE id = ?', [id]);
  if (!session || session.token_hash !== sha256(token)) throw new HttpError(404, 'Session not found');
  const ttlMs = config.survey.sessionTtlHours * 3600 * 1000;
  if (session.status === 'active' && Date.now() - new Date(session.last_activity_at).getTime() > ttlMs) {
    await db.run("UPDATE sessions SET status = 'expired' WHERE id = ?", [id]);
    session.status = 'expired';
  }
  return session;
}

async function sessionState(session, venue, origin) {
  const answers = await db.all(
    `SELECT a.question_id, a.value, a.skipped, q.key, q.widget FROM answers a JOIN questions q ON q.id = a.question_id
     WHERE a.session_id = ? ORDER BY a.id`,
    [session.id]
  );
  const answered = answers.filter((a) => !a.skipped).length;
  const current = session.current_question_id
    ? await db.get('SELECT * FROM questions WHERE id = ?', [session.current_question_id])
    : null;
  const coupon = session.status === 'finished' ? await db.get('SELECT * FROM coupons WHERE session_id = ?', [session.id]) : null;
  return {
    sessionId: session.id,
    status: session.status,
    venue: venueView(venue, origin),
    presence: session.presence,
    progress: { answered, min: config.survey.minQuestions, max: config.survey.maxQuestions },
    canFinish: answered >= config.survey.minQuestions,
    question: current && session.status === 'active' ? publicQuestion(current) : null,
    coupon: coupon ? couponView(coupon, venue, origin) : null
  };
}

function couponView(coupon, venue, origin) {
  const token = tokenFor(coupon.code);
  return {
    token,
    display: formatForDisplay(token),
    reward: coupon.reward,
    rewardTerms: venue.reward_terms || '',
    venue: venue.name,
    venueSlug: venue.slug,
    status: coupon.status,
    issuedAt: coupon.issued_at,
    expiresAt: coupon.expires_at,
    redeemedAt: coupon.redeemed_at,
    url: `${origin}/r/${token}`
  };
}

publicRouter.get('/config', (req, res) => {
  res.json({
    pushEnabled,
    vapidPublicKey: pushEnabled ? config.vapidPublicKey : null,
    survey: { min: config.survey.minQuestions, max: config.survey.maxQuestions },
    profile: { ageBands: AGE_BANDS, genders: GENDERS, visits: VISIT_FREQUENCIES }
  });
});

publicRouter.get('/venues/nearby', async (req, res, next) => {
  try {
    const lat = num(req.query.lat, { min: -90, max: 90, name: 'lat' });
    const lng = num(req.query.lng, { min: -180, max: 180, name: 'lng' });
    const within = num(req.query.within, { min: 10, max: 5000, name: 'within', optional: true }) ?? 500;
    const origin = publicOrigin(req, config.baseUrl);
    const venues = await db.all('SELECT * FROM venues WHERE active = 1 AND lat IS NOT NULL AND lng IS NOT NULL');
    const list = venues
      .map((v) => ({ venue: v, distanceM: haversineM(lat, lng, v.lat, v.lng) }))
      .filter((x) => x.distanceM <= within)
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, 10)
      .map((x) => ({ ...venueView(x.venue, origin), distanceM: Math.round(x.distanceM) }));
    res.json({ venues: list });
  } catch (err) {
    next(err);
  }
});

publicRouter.get('/venues/:slug', async (req, res, next) => {
  try {
    const venue = await loadVenueBySlug(str(req.params.slug, { max: 64, required: true, name: 'venue' }));
    res.json({ venue: venueView(venue, publicOrigin(req, config.baseUrl)) });
  } catch (err) {
    next(err);
  }
});

// Start a session: records consented context, checks presence, serves the first question.
publicRouter.post('/sessions', startLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const venue = await loadVenueBySlug(str(body.venue, { max: 64, required: true, name: 'venue' }));
    const profileIn = body.profile || {};
    const ctxIn = body.context || {};
    if (body.consent !== true) throw new HttpError(400, 'Consent is required to take part');
    if (body.adult !== true) throw new HttpError(400, 'You must be 18 or over to take part');

    const profile = {
      ageBand: oneOf(profileIn.ageBand, AGE_BANDS, 'age band', 'undisclosed'),
      gender: oneOf(profileIn.gender, GENDERS, 'gender', 'undisclosed'),
      visits: oneOf(profileIn.visits, VISIT_FREQUENCIES, 'visit frequency', 'occasional')
    };

    let presence = 'unknown';
    let distance = null;
    const lat = num(ctxIn.lat, { min: -90, max: 90, name: 'lat', optional: true });
    const lng = num(ctxIn.lng, { min: -180, max: 180, name: 'lng', optional: true });
    if (lat != null && lng != null && venue.lat != null && venue.lng != null) {
      distance = Math.round(haversineM(lat, lng, venue.lat, venue.lng));
      const accuracy = num(ctxIn.accuracy, { min: 0, max: 100000, name: 'accuracy', optional: true }) ?? 0;
      presence = distance <= (venue.radius_m || config.survey.defaultRadiusM) + Math.min(accuracy, 100) ? 'verified' : 'outside';
    } else if (lat == null && ctxIn.locationDenied === true) {
      presence = 'declined';
    }

    const hour = num(ctxIn.localHour, { min: 0, max: 23, name: 'hour', optional: true });
    const context = {
      timeOfDay: timeOfDay(hour ?? new Date().getHours()),
      localHour: hour,
      weekday: ctxIn.weekday != null ? num(ctxIn.weekday, { min: 0, max: 6, name: 'weekday' }) : new Date().getDay(),
      device: oneOf(ctxIn.device, ['mobile', 'tablet', 'desktop'], 'device', 'mobile'),
      connection: str(ctxIn.connection, { max: 16 }) || 'unknown',
      saveData: ctxIn.saveData === true,
      displayMode: oneOf(ctxIn.displayMode, ['browser', 'standalone'], 'display mode', 'browser'),
      language: str(ctxIn.language, { max: 16 }) || 'unknown',
      viewport: str(ctxIn.viewport, { max: 16 }),
      presence
    };
    const source = oneOf(body.source, ['qr', 'nfc', 'link', 'push', 'nearby', 'resume'], 'source', 'link');

    const questions = await loadQuestions(venue);
    const first = pickNextQuestion(questions, { profile, context, answersByKey: new Map(), askedIds: new Set(), lastAnsweredKey: null, lastWidget: null });
    if (!first) throw new HttpError(409, 'This venue has no questions set up yet');

    const id = randomId(12);
    const token = randomId(24);
    const ts = now();
    await db.batch([
      {
        sql: `INSERT INTO sessions (id, venue_id, token_hash, context, profile, status, presence, distance_m, source, current_question_id, asked, started_at, last_activity_at)
              VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
        args: [id, venue.id, sha256(token), JSON.stringify(context), JSON.stringify(profile), presence, distance, source, first.id, JSON.stringify([first.id]), ts, ts]
      },
      { sql: 'UPDATE questions SET asked_count = asked_count + 1 WHERE id = ?', args: [first.id] }
    ]);
    await logEvent('started', { sessionId: id, venueId: venue.id, detail: { source, presence, timeOfDay: context.timeOfDay, device: context.device } });

    const origin = publicOrigin(req, config.baseUrl);
    res.status(201).json({
      sessionId: id,
      token,
      venue: venueView(venue, origin),
      presence,
      distanceM: distance,
      question: publicQuestion(first),
      progress: { answered: 0, min: config.survey.minQuestions, max: config.survey.maxQuestions },
      canFinish: false
    });
  } catch (err) {
    next(err);
  }
});

publicRouter.get('/sessions/:id', async (req, res, next) => {
  try {
    const session = await loadSession(req);
    const venue = await db.get('SELECT * FROM venues WHERE id = ?', [session.venue_id]);
    res.json(await sessionState(session, venue, publicOrigin(req, config.baseUrl)));
  } catch (err) {
    next(err);
  }
});

// Save one answer (or a skip) and pick the next question.
publicRouter.post('/sessions/:id/answers', async (req, res, next) => {
  try {
    const session = await loadSession(req);
    if (session.status !== 'active') throw new HttpError(409, `This survey is ${session.status}`);
    const body = req.body || {};
    const questionId = num(body.questionId, { min: 1, max: 1e9, name: 'questionId' });
    if (questionId !== session.current_question_id) throw new HttpError(409, 'That question is not the one currently open');
    const question = await db.get('SELECT * FROM questions WHERE id = ?', [questionId]);
    if (!question) throw new HttpError(404, 'Question not found');

    const skipped = body.skip === true;
    if (skipped && question.required) throw new HttpError(400, 'This question cannot be skipped');
    let value = null;
    if (!skipped) {
      try {
        value = cleanAnswer(question, body.value);
      } catch (err) {
        throw new HttpError(400, err.message);
      }
    }
    const elapsed = num(body.elapsedMs, { min: 0, max: 3600000, name: 'elapsedMs', optional: true });
    const ts = now();
    await db.run(
      `INSERT INTO answers (session_id, question_id, value, skipped, elapsed_ms, answered_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, question_id) DO UPDATE SET value = excluded.value, skipped = excluded.skipped, elapsed_ms = excluded.elapsed_ms, answered_at = excluded.answered_at`,
      [session.id, questionId, JSON.stringify(value), skipped ? 1 : 0, elapsed, ts]
    );

    const venue = await db.get('SELECT * FROM venues WHERE id = ?', [session.venue_id]);
    const questions = await loadQuestions(venue);
    const answers = await db.all(
      'SELECT a.question_id, a.value, a.skipped, q.key FROM answers a JOIN questions q ON q.id = a.question_id WHERE a.session_id = ? ORDER BY a.id',
      [session.id]
    );
    const answersByKey = new Map();
    for (const a of answers) answersByKey.set(a.key, { value: parseJson(a.value, null), skipped: Boolean(a.skipped) });
    const asked = new Set(parseJson(session.asked, []));
    for (const a of answers) asked.add(a.question_id);
    const answeredCount = answers.filter((a) => !a.skipped).length;

    let nextQ = null;
    if (answeredCount < config.survey.maxQuestions) {
      nextQ = pickNextQuestion(questions, {
        profile: parseJson(session.profile, {}),
        context: parseJson(session.context, {}),
        answersByKey,
        askedIds: asked,
        lastAnsweredKey: skipped ? null : question.key,
        lastWidget: question.widget
      });
    }
    const statements = [];
    if (nextQ) {
      asked.add(nextQ.id);
      statements.push({ sql: 'UPDATE questions SET asked_count = asked_count + 1 WHERE id = ?', args: [nextQ.id] });
    }
    statements.push({
      sql: 'UPDATE sessions SET current_question_id = ?, asked = ?, last_activity_at = ? WHERE id = ?',
      args: [nextQ ? nextQ.id : null, JSON.stringify([...asked]), ts, session.id]
    });
    await db.batch(statements);

    res.json({
      saved: true,
      question: nextQ ? publicQuestion(nextQ) : null,
      progress: { answered: answeredCount, min: config.survey.minQuestions, max: config.survey.maxQuestions },
      canFinish: answeredCount >= config.survey.minQuestions,
      exhausted: !nextQ
    });
  } catch (err) {
    next(err);
  }
});

publicRouter.post('/sessions/:id/finish', async (req, res, next) => {
  try {
    const session = await loadSession(req);
    const venue = await db.get('SELECT * FROM venues WHERE id = ?', [session.venue_id]);
    const origin = publicOrigin(req, config.baseUrl);
    if (session.status === 'finished') {
      const existing = await db.get('SELECT * FROM coupons WHERE session_id = ?', [session.id]);
      return res.json({ coupon: couponView(existing, venue, origin) });
    }
    if (session.status !== 'active') throw new HttpError(409, `This survey is ${session.status}`);
    const row = await db.get('SELECT COUNT(*) AS n FROM answers WHERE session_id = ? AND skipped = 0', [session.id]);
    if (row.n < config.survey.minQuestions) {
      throw new HttpError(400, `Please answer at least ${config.survey.minQuestions} questions to receive the reward`);
    }
    const ts = now();
    const expires = new Date(Date.now() + config.couponValidDays * 86400 * 1000).toISOString();
    let code = newCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const clash = await db.get('SELECT code FROM coupons WHERE code = ?', [code]);
      if (!clash) break;
      code = newCode();
    }
    await db.batch([
      { sql: 'INSERT INTO coupons (code, session_id, venue_id, reward, status, issued_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)', args: [code, session.id, venue.id, venue.reward, 'new', ts, expires] },
      { sql: "UPDATE sessions SET status = 'finished', finished_at = ?, last_activity_at = ?, current_question_id = NULL WHERE id = ?", args: [ts, ts, session.id] }
    ]);
    const started = new Date(session.started_at).getTime();
    await logEvent('finished', { sessionId: session.id, venueId: venue.id, detail: { durationMs: Date.now() - started, answers: row.n } });
    const coupon = await db.get('SELECT * FROM coupons WHERE code = ?', [code]);
    res.status(201).json({ coupon: couponView(coupon, venue, origin) });
  } catch (err) {
    next(err);
  }
});

// Anyone holding a coupon can check its status; only staff with the venue PIN can redeem it.
publicRouter.get('/coupons/:token', async (req, res, next) => {
  try {
    const code = parseToken(req.params.token);
    if (!code) return res.json({ status: 'invalid' });
    const coupon = await db.get('SELECT * FROM coupons WHERE code = ?', [code]);
    if (!coupon) return res.json({ status: 'invalid' });
    const venue = await db.get('SELECT * FROM venues WHERE id = ?', [coupon.venue_id]);
    const view = couponView(coupon, venue, publicOrigin(req, config.baseUrl));
    if (view.status === 'new' && new Date(coupon.expires_at) < new Date()) view.status = 'expired';
    res.json({ status: view.status, coupon: view });
  } catch (err) {
    next(err);
  }
});

publicRouter.post('/redeem', redeemLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const code = parseToken(str(body.token, { max: 200, required: true, name: 'code' }));
    const pin = str(body.pin, { max: 32, required: true, name: 'PIN' });
    if (!code) return res.status(400).json({ ok: false, status: 'invalid', message: 'This code is not a valid CrowdFeed coupon' });
    const coupon = await db.get('SELECT * FROM coupons WHERE code = ?', [code]);
    if (!coupon) return res.status(404).json({ ok: false, status: 'invalid', message: 'Unknown coupon' });
    const venue = await db.get('SELECT * FROM venues WHERE id = ?', [coupon.venue_id]);
    if (!verifyPin(pin, venue.staff_pin_hash)) throw new HttpError(401, 'Wrong staff PIN for this venue');
    if (coupon.status === 'used') {
      return res.status(409).json({ ok: false, status: 'used', message: `Already used on ${new Date(coupon.redeemed_at).toLocaleString('en-GB')}`, reward: coupon.reward, venue: venue.name });
    }
    if (new Date(coupon.expires_at) < new Date()) {
      return res.status(409).json({ ok: false, status: 'expired', message: 'This coupon has expired', reward: coupon.reward, venue: venue.name });
    }
    const ts = now();
    await db.run("UPDATE coupons SET status = 'used', redeemed_at = ? WHERE code = ?", [ts, code]);
    await logEvent('redeemed', { sessionId: coupon.session_id, venueId: venue.id });
    res.json({ ok: true, status: 'used', reward: coupon.reward, venue: venue.name, redeemedAt: ts });
  } catch (err) {
    next(err);
  }
});

publicRouter.post('/push/subscribe', async (req, res, next) => {
  try {
    if (!pushEnabled) throw new HttpError(503, 'Notifications are not enabled on this server');
    const body = req.body || {};
    const venue = await loadVenueBySlug(str(body.venue, { max: 64, required: true, name: 'venue' }));
    await saveSubscription(venue.id, body.subscription);
    await logEvent('push_subscribed', { venueId: venue.id });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

publicRouter.post('/push/unsubscribe', async (req, res, next) => {
  try {
    const endpoint = str((req.body || {}).endpoint, { max: 2000, required: true, name: 'endpoint' });
    await removeSubscription(endpoint);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

publicRouter.post('/events', eventLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const type = oneOf(body.type, ['opened', 'push_clicked', 'installed', 'resumed', 'abandoned_view'], 'event type');
    const venueSlug = str(body.venue, { max: 64 });
    const venue = venueSlug ? await db.get('SELECT id FROM venues WHERE slug = ?', [venueSlug]) : null;
    await logEvent(type, { venueId: venue ? venue.id : null, detail: body.detail && typeof body.detail === 'object' ? body.detail : null });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
