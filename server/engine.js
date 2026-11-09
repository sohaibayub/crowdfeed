// Adaptive question selection.
//
// A session is served one question at a time. After each answer the server
// picks the next question from the venue's bank by a transparent, rule-based
// procedure:
//
//   1. drop questions already shown in this session, inactive ones, and ones
//      whose conditions do not match the respondent (gender, age band, visit
//      frequency, time of day, presence) or whose follow-up requirements are
//      not yet satisfied by earlier answers;
//   2. score the rest: base priority, a large boost for a follow-up whose
//      trigger was the answer just given, a penalty for repeating the widget
//      type of the previous question (variety keeps short sessions engaging),
//      and a small bonus for questions that have been asked less often across
//      respondents (balances exposure of the bank);
//   3. return the best scoring question, breaking ties at random.

import { parseJson } from './util.js';

export const DEFAULT_WEIGHTS = Object.freeze({
  followUpBoost: 100, // a follow-up to the answer just given is asked next
  sameWidgetPenalty: 15, // avoid two questions of the same answer type in a row
  exposureWeight: 5 // favour questions that have been asked less often overall
});

export function compare(actual, op, expected) {
  if (actual == null) return false;
  switch (op) {
    case '==':
      return String(actual) === String(expected);
    case '!=':
      return String(actual) !== String(expected);
    case '<':
      return Number(actual) < Number(expected);
    case '<=':
      return Number(actual) <= Number(expected);
    case '>':
      return Number(actual) > Number(expected);
    case '>=':
      return Number(actual) >= Number(expected);
    case 'in':
      return Array.isArray(expected) && expected.map(String).includes(String(actual));
    case 'includes':
      return Array.isArray(actual) && actual.map(String).includes(String(expected));
    case 'first':
      return Array.isArray(actual) && String(actual[0]) === String(expected);
    default:
      return false;
  }
}

function matchesList(conditionValue, actual) {
  if (!conditionValue || (Array.isArray(conditionValue) && conditionValue.length === 0)) return true;
  const list = Array.isArray(conditionValue) ? conditionValue : [conditionValue];
  return list.includes(actual);
}

export function isEligible(question, { profile, context, answersByKey, askedIds }) {
  if (!question.active) return false;
  if (askedIds.has(question.id)) return false;
  const c = typeof question.conditions === 'string' ? parseJson(question.conditions, {}) : question.conditions || {};
  if (!matchesList(c.gender, profile.gender)) return false;
  if (!matchesList(c.ageBand, profile.ageBand)) return false;
  if (!matchesList(c.visits, profile.visits)) return false;
  if (!matchesList(c.timeOfDay, context.timeOfDay)) return false;
  if (!matchesList(c.presence, context.presence)) return false;
  if (Array.isArray(c.requires)) {
    for (const rule of c.requires) {
      const answer = answersByKey.get(rule.key);
      if (!answer || answer.skipped) return false;
      if (!compare(answer.value, rule.op, rule.value)) return false;
    }
  }
  return true;
}

export function pickNextQuestion(questions, state, weights = DEFAULT_WEIGHTS) {
  const { lastAnsweredKey, lastWidget } = state;
  const candidates = [];
  for (const q of questions) {
    if (!isEligible(q, state)) continue;
    const c = typeof q.conditions === 'string' ? parseJson(q.conditions, {}) : q.conditions || {};
    let score = Number(q.priority) || 0;
    if (Array.isArray(c.requires) && lastAnsweredKey && c.requires.some((r) => r.key === lastAnsweredKey)) {
      score += weights.followUpBoost;
    }
    if (lastWidget && q.widget === lastWidget) score -= weights.sameWidgetPenalty;
    score -= weights.exposureWeight * Math.log1p(Number(q.asked_count) || 0);
    candidates.push({ q, score });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0].score;
  const ties = candidates.filter((c) => top - c.score < 0.5);
  const random = typeof weights.random === 'function' ? weights.random : Math.random;
  return ties[Math.floor(random() * ties.length)].q;
}

export function publicQuestion(q) {
  return {
    id: q.id,
    key: q.key,
    text: q.text,
    widget: q.widget,
    options: typeof q.options === 'string' ? parseJson(q.options, []) : q.options || [],
    required: Boolean(q.required)
  };
}

// Validate an answer value for a widget. Returns the cleaned value.
export function cleanAnswer(question, value) {
  const options = typeof question.options === 'string' ? parseJson(question.options, []) : question.options || [];
  switch (question.widget) {
    case 'radio':
    case 'segmented':
      if (!options.includes(value)) throw new RangeError('Choose one of the offered options');
      return value;
    case 'rank': {
      if (!Array.isArray(value) || value.length !== options.length) throw new RangeError('Rank all the options');
      const sorted = [...value].sort();
      const expected = [...options].sort();
      if (sorted.some((v, i) => v !== expected[i])) throw new RangeError('Ranking does not match the options');
      return value;
    }
    case 'stars':
    case 'smileys': {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 5) throw new RangeError('Pick a value from 1 to 5');
      return n;
    }
    case 'slider': {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 10) throw new RangeError('Pick a value from 0 to 10');
      return Math.round(n);
    }
    case 'smileyslider': {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new RangeError('Pick a value from 0 to 100');
      return Math.round(n);
    }
    case 'thumbs':
      if (value !== 'up' && value !== 'down') throw new RangeError('Choose thumbs up or thumbs down');
      return value;
    case 'text': {
      if (typeof value !== 'string') throw new RangeError('Enter some text');
      const t = value.trim();
      if (t.length === 0) throw new RangeError('Enter some text');
      if (t.length > 500) throw new RangeError('Please keep it under 500 characters');
      return t;
    }
    default:
      throw new RangeError('Unknown question type');
  }
}
