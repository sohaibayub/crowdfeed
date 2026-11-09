// Simulates the question selection engine over the seeded question bank with
// synthetic respondents, and reports how each scoring term changes the
// sessions. Usage: node scripts/simulate-engine.js [venueType] [respondents]

import { pickNextQuestion, cleanAnswer, DEFAULT_WEIGHTS } from '../server/engine.js';
import { questionBank } from '../server/seed.js';

const type = process.argv[2] || 'restaurant';
const N = Number(process.argv[3] || 2000);
const MIN = 5;
const MAX = 8;

// Seeded generator so the table is reproducible.
let seed = Number(process.argv[4] || 2016) >>> 0;
function random() {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (arr) => arr[Math.floor(random() * arr.length)];
const genders = ['woman', 'man', 'non-binary', 'undisclosed'];
const ageBands = ['18-24', '25-34', '35-44', '45-54', '55+', 'undisclosed'];
const visits = ['first', 'occasional', 'regular'];
const times = ['morning', 'afternoon', 'evening', 'night'];

// A respondent has a latent satisfaction in [0,1]; low satisfaction gives low
// ratings and thumbs down, which is what triggers the follow-up questions.
function answerFor(q, satisfaction) {
  const noise = () => (random() - 0.5);
  switch (q.widget) {
    case 'radio':
    case 'segmented':
      return pick(q.options);
    case 'rank':
      return [...q.options].sort(() => random() - 0.5);
    case 'stars':
    case 'smileys':
      return Math.max(1, Math.min(5, Math.round(1 + satisfaction * 4 + noise())));
    case 'slider':
      return Math.max(0, Math.min(10, Math.round(satisfaction * 10 + noise() * 2)));
    case 'smileyslider':
      return Math.max(0, Math.min(100, Math.round(satisfaction * 100 + noise() * 20)));
    case 'thumbs':
      return random() < satisfaction ? 'up' : 'down';
    default:
      return 'free text';
  }
}

function freshBank() {
  return questionBank[type].map((q, i) => ({
    id: i + 1, key: q.key, text: q.text, widget: q.widget, options: q.options || [], conditions: q.conditions || {},
    priority: q.priority ?? 50, required: q.required ? 1 : 0, active: 1, asked_count: 0
  }));
}

function run(weights, label) {
  const bank = freshBank();
  const followUpKeys = new Set(bank.filter((q) => Array.isArray(q.conditions.requires)).map((q) => q.key));
  const paths = new Map();
  let pairs = 0;
  let samePairs = 0;
  let triggered = 0;
  let askedNext = 0;
  let askedLater = 0;
  let reachedMin = 0;
  let answersTotal = 0;
  for (let s = 0; s < N; s++) {
    const profile = { gender: pick(genders), ageBand: pick(ageBands), visits: pick(visits) };
    const context = { timeOfDay: pick(times), presence: pick(['verified', 'verified', 'unknown', 'outside']) };
    const satisfaction = random();
    const answersByKey = new Map();
    const askedIds = new Set();
    let lastAnsweredKey = null;
    let lastWidget = null;
    const path = [];
    const pending = new Map(); // follow-up key -> step at which it became eligible
    for (let step = 0; step < MAX; step++) {
      const q = pickNextQuestion(bank, { profile, context, answersByKey, askedIds, lastAnsweredKey, lastWidget }, weights);
      if (!q) break;
      askedIds.add(q.id);
      q.asked_count += 1;
      if (pending.has(q.key)) {
        if (pending.get(q.key) === step) askedNext += 1;
        else askedLater += 1;
        pending.delete(q.key);
      }
      const skip = !q.required && random() < 0.08;
      if (skip) answersByKey.set(q.key, { value: null, skipped: true });
      else {
        answersByKey.set(q.key, { value: cleanAnswer(q, answerFor(q, satisfaction)), skipped: false });
        answersTotal += 1;
      }
      if (lastWidget) {
        pairs += 1;
        if (lastWidget === q.widget) samePairs += 1;
      }
      // which follow-ups did this answer make eligible?
      for (const f of bank) {
        if (!followUpKeys.has(f.key) || askedIds.has(f.id) || pending.has(f.key)) continue;
        const rules = f.conditions.requires;
        if (!rules.some((r) => r.key === q.key)) continue;
        const state = { profile, context, answersByKey, askedIds, lastAnsweredKey: q.key, lastWidget: q.widget };
        if (pickNextQuestion([f], state, weights)) {
          triggered += 1;
          pending.set(f.key, step + 1);
        }
      }
      lastAnsweredKey = skip ? null : q.key;
      lastWidget = q.widget;
      path.push(q.key);
    }
    const answered = [...answersByKey.values()].filter((a) => !a.skipped).length;
    if (answered >= MIN) reachedMin += 1;
    const key = path.join('>');
    paths.set(key, (paths.get(key) || 0) + 1);
  }
  const counts = bank.map((q) => q.asked_count);
  const sorted = [...counts].sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  const gini = sorted.reduce((acc, x, i) => acc + (2 * (i + 1) - sorted.length - 1) * x, 0) / (sorted.length * total);
  return {
    configuration: label,
    'distinct orderings': paths.size,
    'follow-up asked next (%)': triggered ? ((100 * askedNext) / triggered).toFixed(1) : 'n/a',
    'follow-up never asked (%)': triggered ? ((100 * (triggered - askedNext - askedLater)) / triggered).toFixed(1) : 'n/a',
    'same answer type in a row (%)': ((100 * samePairs) / pairs).toFixed(1),
    'questions never asked': counts.filter((c) => c === 0).length,
    'least asked question (times)': Math.min(...counts),
    'exposure Gini': gini.toFixed(2),
    'reached 5 answers (%)': ((100 * reachedMin) / N).toFixed(1)
  };
}

const rows = [
  run({ followUpBoost: 0, sameWidgetPenalty: 0, exposureWeight: 0, random }, 'priority only'),
  run({ ...DEFAULT_WEIGHTS, sameWidgetPenalty: 0, exposureWeight: 0, random }, 'with follow-up boost'),
  run({ ...DEFAULT_WEIGHTS, exposureWeight: 0, random }, 'with variety penalty'),
  run({ ...DEFAULT_WEIGHTS, random }, 'full engine (default weights)')
];
console.log(`Venue type: ${type}, questions in bank: ${questionBank[type].length}, synthetic respondents: ${N}, up to ${MAX} questions each`);
console.table(rows);
