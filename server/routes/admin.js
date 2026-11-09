import { Router } from 'express';
import { config } from '../config.js';
import { db, now } from '../db.js';
import { loginAdmin, logoutAdmin, requireAdmin, hashPin } from '../auth.js';
import { sendToVenue, pushEnabled } from '../push.js';
import { HttpError, str, oneOf, num, slugify, rateLimiter, parseJson, csvEscape, publicOrigin, WIDGETS, VENUE_TYPES } from '../util.js';

export const adminRouter = Router();

const loginLimiter = rateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

adminRouter.post('/login', loginLimiter, async (req, res, next) => {
  try {
    await loginAdmin((req.body || {}).password, res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/logout', async (req, res, next) => {
  try {
    await logoutAdmin(req, res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.use(requireAdmin);

adminRouter.get('/me', (req, res) => {
  res.json({ ok: true, pushEnabled, venueTypes: VENUE_TYPES, widgets: WIDGETS, survey: config.survey });
});

// Venues -------------------------------------------------------------------

function venueInput(body, existing = {}) {
  const name = str(body.name, { max: 80, required: true, name: 'name' });
  const slug = slugify(body.slug || existing.slug || name);
  if (!slug) throw new HttpError(400, 'A web address slug is required');
  const lat = num(body.lat, { min: -90, max: 90, name: 'latitude', optional: true });
  const lng = num(body.lng, { min: -180, max: 180, name: 'longitude', optional: true });
  if ((lat == null) !== (lng == null)) throw new HttpError(400, 'Give both latitude and longitude, or neither');
  return {
    slug,
    name,
    type: oneOf(body.type, VENUE_TYPES, 'venue type', existing.type || 'general'),
    lat,
    lng,
    radius_m: num(body.radiusM, { min: 10, max: 2000, name: 'radius', optional: true }) ?? existing.radius_m ?? config.survey.defaultRadiusM,
    reward: str(body.reward, { max: 120, required: true, name: 'reward' }),
    reward_terms: str(body.rewardTerms, { max: 300 }),
    active: body.active === false ? 0 : 1
  };
}

adminRouter.get('/venues', async (req, res, next) => {
  try {
    const origin = publicOrigin(req, config.baseUrl);
    const rows = await db.all(
      `SELECT v.*,
        (SELECT COUNT(*) FROM sessions s WHERE s.venue_id = v.id) AS sessions,
        (SELECT COUNT(*) FROM sessions s WHERE s.venue_id = v.id AND s.status = 'finished') AS finished,
        (SELECT COUNT(*) FROM coupons c WHERE c.venue_id = v.id AND c.status = 'used') AS redeemed,
        (SELECT COUNT(*) FROM push_subscriptions p WHERE p.venue_id = v.id) AS subscribers,
        (SELECT COUNT(*) FROM questions q WHERE q.venue_id = v.id AND q.active = 1) AS own_questions,
        (SELECT COUNT(*) FROM questions q WHERE q.venue_id IS NULL AND q.venue_type = v.type AND q.active = 1) AS template_questions
       FROM venues v ORDER BY v.name`
    );
    res.json({
      venues: rows.map((v) => ({
        id: v.id, slug: v.slug, name: v.name, type: v.type, lat: v.lat, lng: v.lng, radiusM: v.radius_m, reward: v.reward,
        rewardTerms: v.reward_terms || '', active: Boolean(v.active), hasPin: Boolean(v.staff_pin_hash), url: `${origin}/v/${v.slug}`,
        scanUrl: `${origin}/scan?venue=${v.slug}`, sessions: v.sessions, finished: v.finished, redeemed: v.redeemed,
        subscribers: v.subscribers, ownQuestions: v.own_questions, templateQuestions: v.template_questions, createdAt: v.created_at
      }))
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/venues', async (req, res, next) => {
  try {
    const body = req.body || {};
    const v = venueInput(body);
    const pin = str(body.staffPin, { max: 32 });
    const result = await db.run(
      `INSERT INTO venues (slug, name, type, lat, lng, radius_m, reward, reward_terms, staff_pin_hash, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [v.slug, v.name, v.type, v.lat, v.lng, v.radius_m, v.reward, v.reward_terms, pin ? hashPin(pin) : null, v.active, now()]
    );
    res.status(201).json({ id: result.lastId, slug: v.slug });
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return next(new HttpError(409, 'That slug is already in use'));
    next(err);
  }
});

adminRouter.put('/venues/:id', async (req, res, next) => {
  try {
    const id = num(req.params.id, { min: 1, max: 1e9, name: 'id' });
    const existing = await db.get('SELECT * FROM venues WHERE id = ?', [id]);
    if (!existing) throw new HttpError(404, 'Venue not found');
    const body = req.body || {};
    const v = venueInput(body, existing);
    const pin = str(body.staffPin, { max: 32 });
    await db.run(
      `UPDATE venues SET slug = ?, name = ?, type = ?, lat = ?, lng = ?, radius_m = ?, reward = ?, reward_terms = ?, active = ?,
       staff_pin_hash = COALESCE(?, staff_pin_hash) WHERE id = ?`,
      [v.slug, v.name, v.type, v.lat, v.lng, v.radius_m, v.reward, v.reward_terms, v.active, pin ? hashPin(pin) : null, id]
    );
    res.json({ ok: true, slug: v.slug });
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return next(new HttpError(409, 'That slug is already in use'));
    next(err);
  }
});

adminRouter.delete('/venues/:id', async (req, res, next) => {
  try {
    const id = num(req.params.id, { min: 1, max: 1e9, name: 'id' });
    const used = await db.get('SELECT COUNT(*) AS n FROM sessions WHERE venue_id = ?', [id]);
    if (used.n > 0) {
      await db.run('UPDATE venues SET active = 0 WHERE id = ?', [id]);
      return res.json({ ok: true, deactivated: true });
    }
    await db.batch([
      { sql: 'DELETE FROM questions WHERE venue_id = ?', args: [id] },
      { sql: 'DELETE FROM push_subscriptions WHERE venue_id = ?', args: [id] },
      { sql: 'DELETE FROM venues WHERE id = ?', args: [id] }
    ]);
    res.json({ ok: true, deleted: true });
  } catch (err) {
    next(err);
  }
});

// Questions ----------------------------------------------------------------

function questionInput(body) {
  const widget = oneOf(body.widget, WIDGETS, 'question type');
  const options = Array.isArray(body.options) ? body.options.map((o) => str(o, { max: 60, name: 'option' })).filter(Boolean) : [];
  if (['radio', 'segmented', 'rank'].includes(widget) && options.length < 2) throw new HttpError(400, 'This question type needs at least two options');
  if (widget === 'segmented' && options.length > 5) throw new HttpError(400, 'Segmented controls work best with up to five options');
  let conditions = {};
  if (body.conditions && typeof body.conditions === 'object') conditions = body.conditions;
  else if (typeof body.conditions === 'string' && body.conditions.trim()) {
    conditions = parseJson(body.conditions, null);
    if (!conditions || typeof conditions !== 'object') throw new HttpError(400, 'Conditions must be valid JSON');
  }
  if (conditions.requires && !Array.isArray(conditions.requires)) throw new HttpError(400, 'requires must be a list of rules');
  for (const rule of conditions.requires || []) {
    if (!rule.key || !['==', '!=', '<', '<=', '>', '>=', 'in', 'includes', 'first'].includes(rule.op)) throw new HttpError(400, 'Each rule needs a key, an operator and a value');
  }
  const venueId = num(body.venueId, { min: 1, max: 1e9, name: 'venueId', optional: true });
  const venueType = venueId ? null : oneOf(body.venueType, VENUE_TYPES, 'venue type');
  return {
    venue_id: venueId,
    venue_type: venueType,
    key: slugify(str(body.key, { max: 40, required: true, name: 'key' })).replace(/-/g, '_'),
    text: str(body.text, { max: 200, required: true, name: 'question text' }),
    widget,
    options: JSON.stringify(options),
    conditions: JSON.stringify(conditions),
    priority: num(body.priority, { min: 0, max: 1000, name: 'priority', optional: true }) ?? 50,
    required: body.required ? 1 : 0,
    active: body.active === false ? 0 : 1
  };
}

adminRouter.get('/questions', async (req, res, next) => {
  try {
    const venueId = num(req.query.venueId, { min: 1, max: 1e9, name: 'venueId', optional: true });
    const venueType = req.query.venueType ? oneOf(req.query.venueType, VENUE_TYPES, 'venue type') : null;
    let rows;
    if (venueId) {
      const venue = await db.get('SELECT type FROM venues WHERE id = ?', [venueId]);
      if (!venue) throw new HttpError(404, 'Venue not found');
      rows = await db.all('SELECT * FROM questions WHERE venue_id = ? OR (venue_id IS NULL AND venue_type = ?) ORDER BY venue_id IS NULL, priority DESC, id', [venueId, venue.type]);
    } else if (venueType) {
      rows = await db.all('SELECT * FROM questions WHERE venue_id IS NULL AND venue_type = ? ORDER BY priority DESC, id', [venueType]);
    } else {
      rows = await db.all('SELECT * FROM questions ORDER BY venue_type, venue_id, priority DESC, id');
    }
    res.json({
      questions: rows.map((q) => ({
        id: q.id, venueId: q.venue_id, venueType: q.venue_type, key: q.key, text: q.text, widget: q.widget,
        options: parseJson(q.options, []), conditions: parseJson(q.conditions, {}), priority: q.priority,
        required: Boolean(q.required), active: Boolean(q.active), askedCount: q.asked_count
      }))
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/questions', async (req, res, next) => {
  try {
    const q = questionInput(req.body || {});
    const result = await db.run(
      `INSERT INTO questions (venue_id, venue_type, key, text, widget, options, conditions, priority, required, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [q.venue_id, q.venue_type, q.key, q.text, q.widget, q.options, q.conditions, q.priority, q.required, q.active, now()]
    );
    res.status(201).json({ id: result.lastId });
  } catch (err) {
    next(err);
  }
});

adminRouter.put('/questions/:id', async (req, res, next) => {
  try {
    const id = num(req.params.id, { min: 1, max: 1e9, name: 'id' });
    const q = questionInput(req.body || {});
    const result = await db.run(
      `UPDATE questions SET venue_id = ?, venue_type = ?, key = ?, text = ?, widget = ?, options = ?, conditions = ?, priority = ?, required = ?, active = ? WHERE id = ?`,
      [q.venue_id, q.venue_type, q.key, q.text, q.widget, q.options, q.conditions, q.priority, q.required, q.active, id]
    );
    if (result.changes === 0) throw new HttpError(404, 'Question not found');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminRouter.delete('/questions/:id', async (req, res, next) => {
  try {
    const id = num(req.params.id, { min: 1, max: 1e9, name: 'id' });
    const used = await db.get('SELECT COUNT(*) AS n FROM answers WHERE question_id = ?', [id]);
    if (used.n > 0) {
      await db.run('UPDATE questions SET active = 0 WHERE id = ?', [id]);
      return res.json({ ok: true, deactivated: true });
    }
    await db.run('DELETE FROM questions WHERE id = ?', [id]);
    res.json({ ok: true, deleted: true });
  } catch (err) {
    next(err);
  }
});

// Results ------------------------------------------------------------------

function count(rows, pick) {
  const out = {};
  for (const r of rows) {
    const k = pick(r);
    if (k == null) continue;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

adminRouter.get('/venues/:id/stats', async (req, res, next) => {
  try {
    const id = num(req.params.id, { min: 1, max: 1e9, name: 'id' });
    const venue = await db.get('SELECT * FROM venues WHERE id = ?', [id]);
    if (!venue) throw new HttpError(404, 'Venue not found');
    const sessions = await db.all('SELECT * FROM sessions WHERE venue_id = ? ORDER BY started_at', [id]);
    const coupons = await db.all('SELECT status, issued_at, redeemed_at FROM coupons WHERE venue_id = ?', [id]);
    const answers = await db.all(
      `SELECT a.*, q.key, q.text, q.widget, q.options FROM answers a JOIN questions q ON q.id = a.question_id
       JOIN sessions s ON s.id = a.session_id WHERE s.venue_id = ? ORDER BY a.id`,
      [id]
    );
    const finished = sessions.filter((s) => s.status === 'finished');
    const durations = finished.map((s) => new Date(s.finished_at).getTime() - new Date(s.started_at).getTime()).filter((d) => d > 0 && d < 3600000);
    const ctx = sessions.map((s) => ({ ...parseJson(s.context, {}), profile: parseJson(s.profile, {}), presence: s.presence, source: s.source }));

    const perQuestion = new Map();
    for (const a of answers) {
      if (!perQuestion.has(a.question_id)) {
        perQuestion.set(a.question_id, { id: a.question_id, key: a.key, text: a.text, widget: a.widget, options: parseJson(a.options, []), n: 0, skipped: 0, values: [], texts: [], elapsed: [] });
      }
      const entry = perQuestion.get(a.question_id);
      if (a.skipped) {
        entry.skipped += 1;
        continue;
      }
      entry.n += 1;
      const v = parseJson(a.value, null);
      if (a.elapsed_ms != null) entry.elapsed.push(a.elapsed_ms);
      if (a.widget === 'text') entry.texts.push({ text: v, at: a.answered_at });
      else entry.values.push(v);
    }
    const questions = [...perQuestion.values()].map((e) => {
      const summary = { id: e.id, key: e.key, text: e.text, widget: e.widget, answered: e.n, skipped: e.skipped, medianSeconds: median(e.elapsed) == null ? null : Math.round(median(e.elapsed) / 1000) };
      if (['radio', 'segmented', 'thumbs'].includes(e.widget)) {
        const labels = e.widget === 'thumbs' ? ['up', 'down'] : e.options;
        summary.distribution = labels.map((label) => ({ label, count: e.values.filter((v) => v === label).length }));
      } else if (['stars', 'smileys'].includes(e.widget)) {
        summary.distribution = [1, 2, 3, 4, 5].map((k) => ({ label: String(k), count: e.values.filter((v) => v === k).length }));
        summary.mean = e.values.length ? Number((e.values.reduce((s, v) => s + v, 0) / e.values.length).toFixed(2)) : null;
      } else if (e.widget === 'slider' || e.widget === 'smileyslider') {
        const max = e.widget === 'slider' ? 10 : 100;
        const bins = e.widget === 'slider' ? [...Array(11).keys()] : [0, 20, 40, 60, 80];
        summary.distribution = bins.map((b, i) => {
          const hi = e.widget === 'slider' ? b : bins[i + 1] ?? max + 1;
          const countIn = e.widget === 'slider' ? e.values.filter((v) => v === b).length : e.values.filter((v) => v >= b && v < hi).length;
          return { label: e.widget === 'slider' ? String(b) : `${b} to ${Math.min(hi - 1, max)}`, count: countIn };
        });
        summary.mean = e.values.length ? Number((e.values.reduce((s, v) => s + v, 0) / e.values.length).toFixed(1)) : null;
      } else if (e.widget === 'rank') {
        const scores = {};
        for (const order of e.values) {
          if (!Array.isArray(order)) continue;
          order.forEach((opt, idx) => {
            scores[opt] = (scores[opt] || 0) + (order.length - idx);
          });
        }
        summary.distribution = Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([label, score]) => ({ label, count: score }));
        summary.note = 'Borda count, higher is ranked higher';
      } else if (e.widget === 'text') {
        summary.texts = e.texts.slice(-30).reverse();
      }
      return summary;
    });

    res.json({
      venue: { id: venue.id, name: venue.name, slug: venue.slug, type: venue.type, reward: venue.reward },
      totals: {
        started: sessions.length,
        finished: finished.length,
        active: sessions.filter((s) => s.status === 'active').length,
        expired: sessions.filter((s) => s.status === 'expired').length,
        completionRate: sessions.length ? Number(((finished.length / sessions.length) * 100).toFixed(1)) : null,
        medianDurationSeconds: median(durations) == null ? null : Math.round(median(durations) / 1000),
        couponsIssued: coupons.length,
        couponsRedeemed: coupons.filter((c) => c.status === 'used').length,
        answers: answers.filter((a) => !a.skipped).length
      },
      breakdown: {
        presence: count(ctx, (c) => c.presence),
        source: count(ctx, (c) => c.source),
        timeOfDay: count(ctx, (c) => c.timeOfDay),
        device: count(ctx, (c) => c.device),
        displayMode: count(ctx, (c) => c.displayMode),
        connection: count(ctx, (c) => c.connection),
        gender: count(ctx, (c) => c.profile.gender),
        ageBand: count(ctx, (c) => c.profile.ageBand),
        visits: count(ctx, (c) => c.profile.visits)
      },
      byDay: Object.entries(count(sessions, (s) => s.started_at.slice(0, 10))).map(([day, n]) => ({ day, started: n, finished: finished.filter((s) => s.started_at.startsWith(day)).length })),
      questions
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/venues/:id/export.csv', async (req, res, next) => {
  try {
    const id = num(req.params.id, { min: 1, max: 1e9, name: 'id' });
    const venue = await db.get('SELECT * FROM venues WHERE id = ?', [id]);
    if (!venue) throw new HttpError(404, 'Venue not found');
    const rows = await db.all(
      `SELECT s.id AS session_id, s.started_at, s.finished_at, s.status, s.presence, s.distance_m, s.source, s.context, s.profile,
              q.key, q.widget, a.value, a.skipped, a.elapsed_ms, a.answered_at
       FROM sessions s LEFT JOIN answers a ON a.session_id = s.id LEFT JOIN questions q ON q.id = a.question_id
       WHERE s.venue_id = ? ORDER BY s.started_at, a.id`,
      [id]
    );
    const header = ['session_id', 'started_at', 'finished_at', 'status', 'presence', 'distance_m', 'source', 'time_of_day', 'device', 'display_mode', 'connection', 'age_band', 'gender', 'visits', 'question_key', 'widget', 'value', 'skipped', 'elapsed_ms', 'answered_at'];
    const lines = [header.join(',')];
    for (const r of rows) {
      const c = parseJson(r.context, {});
      const p = parseJson(r.profile, {});
      lines.push([
        r.session_id, r.started_at, r.finished_at, r.status, r.presence, r.distance_m, r.source, c.timeOfDay, c.device, c.displayMode, c.connection,
        p.ageBand, p.gender, p.visits, r.key, r.widget, r.value == null ? '' : parseJson(r.value, r.value), r.skipped, r.elapsed_ms, r.answered_at
      ].map(csvEscape).join(','));
    }
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="crowdfeed-${venue.slug}-${now().slice(0, 10)}.csv"`);
    res.send(lines.join('\r\n'));
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/venues/:id/coupons', async (req, res, next) => {
  try {
    const id = num(req.params.id, { min: 1, max: 1e9, name: 'id' });
    const rows = await db.all('SELECT code, reward, status, issued_at, expires_at, redeemed_at FROM coupons WHERE venue_id = ? ORDER BY issued_at DESC LIMIT 200', [id]);
    res.json({ coupons: rows.map((c) => ({ code: c.code, reward: c.reward, status: c.status, issuedAt: c.issued_at, expiresAt: c.expires_at, redeemedAt: c.redeemed_at })) });
  } catch (err) {
    next(err);
  }
});

// Notifications ------------------------------------------------------------

adminRouter.post('/venues/:id/push', async (req, res, next) => {
  try {
    const id = num(req.params.id, { min: 1, max: 1e9, name: 'id' });
    const venue = await db.get('SELECT * FROM venues WHERE id = ?', [id]);
    if (!venue) throw new HttpError(404, 'Venue not found');
    const body = req.body || {};
    const title = str(body.title, { max: 60, required: true, name: 'title' });
    const text = str(body.body, { max: 160, required: true, name: 'message' });
    const origin = publicOrigin(req, config.baseUrl);
    const result = await sendToVenue(id, { title, body: text, url: `${origin}/v/${venue.slug}?src=push`, venue: venue.slug, tag: `crowdfeed-${venue.slug}` });
    await db.run('INSERT INTO events (venue_id, type, detail, created_at) VALUES (?, ?, ?, ?)', [id, 'push_sent', JSON.stringify({ title, ...result }), now()]);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
