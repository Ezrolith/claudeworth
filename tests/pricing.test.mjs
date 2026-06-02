import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelInfo, priceEvent, familyOf, CACHE_MULTIPLIERS, pricingTable } from '../src/pricing.js';

const ev = (o) => ({
  input: 0, output: 0, cacheRead: 0,
  cacheCreate5m: 0, cacheCreate1h: 0, cacheCreateTotal: 0,
  ...o,
});
const closeTo = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('modelInfo: Opus 4.5+ pricing applies to 4.5 through current 4.8 (and dated/two-digit forms)', () => {
  for (const id of [
    'claude-opus-4-5', 'opus-4.6', 'claude-opus-4-7', 'claude-opus-4-8',
    'claude-opus-4-9', 'claude-opus-4-5-20251101', 'claude-opus-4-10-20260101',
  ]) {
    const i = modelInfo(id);
    assert.equal(i.family, 'opus-4.5+', id);
    assert.equal(i.input, 5, id);
    assert.equal(i.output, 25, id);
  }
});

test('modelInfo: legacy Opus (4.1, dated 4.0, Claude-3 Opus) keeps $15/$75 — not the $5/$25 catch-all', () => {
  assert.deepEqual(
    [modelInfo('claude-opus-4-1-20250805').input, modelInfo('claude-opus-4-1-20250805').output],
    [15, 75]
  );
  // Dated bare Opus 4.0 must NOT be fooled into the 4.5+ rule by the date digits.
  assert.equal(modelInfo('claude-opus-4-20250514').family, 'opus-4');
  assert.equal(modelInfo('claude-opus-4-20250514').input, 15);
  assert.equal(modelInfo('claude-opus-4').input, 15);
  // Claude-3 Opus has the version BEFORE the name.
  assert.equal(modelInfo('claude-3-opus-20240229').family, 'opus-3');
  assert.equal(modelInfo('claude-3-opus-20240229').input, 15);
});

test('modelInfo: Sonnet is $3/$15 across tiers; reversed-order 3.x ids get the right label', () => {
  assert.equal(modelInfo('claude-sonnet-4-6').input, 3);
  assert.equal(modelInfo('claude-sonnet-4-6').output, 15);
  assert.equal(modelInfo('claude-sonnet-4-5').family, 'sonnet-4');
  assert.equal(modelInfo('claude-3-5-sonnet-20241022').family, 'sonnet-3.5');
  assert.equal(modelInfo('claude-3-7-sonnet-20250219').family, 'sonnet-3.7');
});

test('modelInfo: Haiku 3.5 reversed-order id is $0.80/$4, not the bare-Haiku $0.25/$1.25', () => {
  assert.equal(modelInfo('claude-3-5-haiku-20241022').family, 'haiku-3.5');
  assert.equal(modelInfo('claude-3-5-haiku-20241022').input, 0.8);
  assert.equal(modelInfo('claude-3-5-haiku-20241022').output, 4);
  assert.equal(modelInfo('claude-haiku-4-5-20251001').family, 'haiku-4.5');
  assert.equal(modelInfo('claude-haiku-4-5-20251001').input, 1);
  // Haiku 3.0 stays at the entry rate.
  assert.equal(modelInfo('claude-3-haiku-20240307').input, 0.25);
});

test('modelInfo: unknown / synthetic strings fall back to Sonnet rate and are flagged', () => {
  const i = modelInfo('<synthetic>');
  assert.equal(i.unknown, true);
  assert.equal(i.input, 3);
  assert.equal(i.output, 15);
  assert.equal(familyOf('totally-made-up'), 'unknown');
});

test('priceEvent: per-token arithmetic and the missing-breakdown -> 5m cache fallback', () => {
  assert.equal(priceEvent(ev({ model: 'claude-opus-4-5', input: 1e6 })), 5);
  assert.equal(priceEvent(ev({ model: 'claude-sonnet-4', output: 1e6 })), 15);
  closeTo(priceEvent(ev({ model: 'claude-sonnet-4', cacheRead: 1e6 })), 0.3); // 3 * 0.1
  // No 5m/1h split -> treated as a 5m write at 1.25x base input (3 * 1.25 = 3.75)
  assert.equal(priceEvent(ev({ model: 'claude-sonnet-4', cacheCreateTotal: 1e6 })), 3.75);
  assert.equal(priceEvent(ev({ model: 'claude-sonnet-4', cacheCreate1h: 1e6 })), 6); // 3 * 2.0
});

test('CACHE_MULTIPLIERS are the exact published rates (the methodology promise)', () => {
  assert.deepEqual(CACHE_MULTIPLIERS, { read: 0.1, write5m: 1.25, write1h: 2.0 });
});

test('pricingTable surfaces the headline families with correct base rates', () => {
  const byFamily = Object.fromEntries(pricingTable().map(r => [r.family, r]));
  assert.equal(byFamily['opus-4.5+'].input, 5);
  assert.equal(byFamily['opus-4.5+'].output, 25);
  assert.equal(byFamily['opus-4'].input, 15);
  assert.equal(byFamily['sonnet-4'].input, 3);
  assert.equal(byFamily['haiku-4.5'].input, 1);
  // Derived cache columns line up with the multipliers.
  assert.equal(byFamily['opus-4.5+'].cacheRead, 0.5);  // 5 * 0.1
  assert.equal(byFamily['opus-4.5+'].cache1h, 10);     // 5 * 2.0
});
