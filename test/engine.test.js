import test from 'node:test';
import assert from 'node:assert/strict';
import { pickNextQuestion, isEligible, cleanAnswer, compare } from '../server/engine.js';

const q = (id, key, widget, extra = {}) => ({ id, key, widget, active: 1, priority: 50, asked_count: 0, options: '[]', conditions: '{}', ...extra });

const base = { profile: { gender: 'woman', ageBand: '25-34', visits: 'regular' }, context: { timeOfDay: 'morning', presence: 'verified' }, answersByKey: new Map(), askedIds: new Set(), lastAnsweredKey: null, lastWidget: null };

test('conditions on profile and context filter questions', () => {
  assert.equal(isEligible(q(1, 'a', 'stars', { conditions: '{"gender":["man"]}' }), base), false);
  assert.equal(isEligible(q(2, 'b', 'stars', { conditions: '{"gender":["woman"],"timeOfDay":["morning"]}' }), base), true);
  assert.equal(isEligible(q(3, 'c', 'stars', { conditions: '{"presence":["outside"]}' }), base), false);
  assert.equal(isEligible(q(4, 'd', 'stars'), { ...base, askedIds: new Set([4]) }), false);
});

test('follow-up rules need the trigger answer', () => {
  const follow = q(5, 'taste_issue', 'radio', { conditions: '{"requires":[{"key":"taste","op":"<=","value":2}]}', options: '["Taste","Temperature"]' });
  assert.equal(isEligible(follow, base), false);
  const withAnswer = { ...base, answersByKey: new Map([['taste', { value: 2, skipped: false }]]) };
  assert.equal(isEligible(follow, withAnswer), true);
  const highAnswer = { ...base, answersByKey: new Map([['taste', { value: 4, skipped: false }]]) };
  assert.equal(isEligible(follow, highAnswer), false);
});

test('a follow-up to the answer just given wins over higher base priority', () => {
  const bank = [
    q(1, 'taste', 'stars', { priority: 80 }),
    q(2, 'taste_issue', 'radio', { priority: 60, options: '["Taste","Temperature"]', conditions: '{"requires":[{"key":"taste","op":"<=","value":2}]}' }),
    q(3, 'service', 'slider', { priority: 70 })
  ];
  const state = { ...base, answersByKey: new Map([['taste', { value: 1, skipped: false }]]), askedIds: new Set([1]), lastAnsweredKey: 'taste', lastWidget: 'stars' };
  assert.equal(pickNextQuestion(bank, state).key, 'taste_issue');
});

test('the same widget twice in a row is avoided when priorities tie', () => {
  const bank = [q(1, 'a', 'stars', { priority: 50 }), q(2, 'b', 'radio', { priority: 50, options: '["x","y"]' })];
  const state = { ...base, lastWidget: 'stars' };
  assert.equal(pickNextQuestion(bank, state).key, 'b');
});

test('exposure balancing prefers questions asked less often', () => {
  const bank = [q(1, 'a', 'stars', { asked_count: 500 }), q(2, 'b', 'smileys', { asked_count: 0 })];
  assert.equal(pickNextQuestion(bank, base).key, 'b');
});

test('returns null when nothing is eligible', () => {
  assert.equal(pickNextQuestion([q(1, 'a', 'stars')], { ...base, askedIds: new Set([1]) }), null);
});

test('answers are validated per widget', () => {
  assert.equal(cleanAnswer(q(1, 'a', 'stars'), 4), 4);
  assert.throws(() => cleanAnswer(q(1, 'a', 'stars'), 7));
  assert.equal(cleanAnswer(q(1, 'a', 'radio', { options: '["Yes","No"]' }), 'No'), 'No');
  assert.throws(() => cleanAnswer(q(1, 'a', 'radio', { options: '["Yes","No"]' }), 'Maybe'));
  assert.deepEqual(cleanAnswer(q(1, 'a', 'rank', { options: '["A","B","C"]' }), ['C', 'A', 'B']), ['C', 'A', 'B']);
  assert.throws(() => cleanAnswer(q(1, 'a', 'rank', { options: '["A","B","C"]' }), ['C', 'A']));
  assert.equal(cleanAnswer(q(1, 'a', 'slider'), 7.4), 7);
  assert.equal(cleanAnswer(q(1, 'a', 'thumbs'), 'up'), 'up');
  assert.equal(cleanAnswer(q(1, 'a', 'text'), '  Fine  '), 'Fine');
  assert.throws(() => cleanAnswer(q(1, 'a', 'text'), '   '));
});

test('comparison operators', () => {
  assert.equal(compare('down', '==', 'down'), true);
  assert.equal(compare(3, '<=', 2), false);
  assert.equal(compare('Over 20 minutes', 'in', ['10 to 20 minutes', 'Over 20 minutes']), true);
  assert.equal(compare(['Lunch', 'Dinner'], 'first', 'Lunch'), true);
  assert.equal(compare(['Lunch', 'Dinner'], 'includes', 'Dinner'), true);
});
