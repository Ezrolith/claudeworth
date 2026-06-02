import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, planFromKey, weeklyCost } from '../src/plans.js';

const closeTo = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('weeklyCost prorates monthly by 4.345 weeks', () => {
  closeTo(weeklyCost(PLANS.pro), 20 / 4.345);
  closeTo(weeklyCost(PLANS.max5), 100 / 4.345);
  closeTo(weeklyCost(PLANS.max20), 200 / 4.345);
});

test('planFromKey returns the named plan and falls back to max5 for unknown keys', () => {
  assert.equal(planFromKey('pro'), PLANS.pro);
  assert.equal(planFromKey('max20'), PLANS.max20);
  assert.equal(planFromKey('bogus'), PLANS.max5);
  assert.equal(planFromKey(undefined), PLANS.max5);
});

test('each plan carries the fields the dashboard actually uses', () => {
  for (const key of ['pro', 'max5', 'max20']) {
    assert.equal(typeof PLANS[key].label, 'string');
    assert.equal(typeof PLANS[key].monthly, 'number');
  }
});
