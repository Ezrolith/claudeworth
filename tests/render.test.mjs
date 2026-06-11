import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDashboard } from '../src/render.js';
import { aggregate } from '../src/aggregate.js';
import { planFromKey } from '../src/plans.js';

const now = new Date(2026, 5, 3, 12, 0, 0);
const events = [
  {
    ts: new Date(2026, 5, 3, 11).toISOString(), model: 'claude-opus-4-8',
    sessionId: 's1', project: 'me/proj', projectRaw: 'rawA', cwd: '/home/me/proj',
    input: 2000, output: 1000, cacheRead: 50000, cacheCreate5m: 0, cacheCreate1h: 4000, cacheCreateTotal: 4000,
  },
];

test('renderDashboard returns well-formed HTML with the expected anchors', () => {
  const agg = aggregate(events, { now });
  const html = renderDashboard({
    agg, plan: planFromKey('max5'), planKey: 'max5',
    sourceDir: '/tmp/projects', generatedAt: now, version: '9.9.9',
  });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.match(html, /id="cw-mult"/);
  assert.match(html, /cw-plan-select/);
  assert.match(html, /cw-lt-mult/);          // lifetime-return block present
  assert.match(html, /% from cache/);        // renamed cache column
  assert.match(html, /\/tmp\/projects/);     // source dir echoed
  assert.match(html, /claudeworth v9\.9\.9/); // version in footer
  assert.match(html, /<h3>Today<\/h3>/);     // today card present
  assert.match(html, /fable-5/);             // premium tier in the pricing table
});

test('renderDashboard shows the live badge only when the last event is fresh', () => {
  const plan = planFromKey('max5');
  const base = { plan, planKey: 'max5', sourceDir: '/tmp/x', generatedAt: now, version: '0.0.0' };

  // Last event 2 minutes ago -> live, with the client-side expiry hook
  const fresh = [{ ...events[0], ts: new Date(2026, 5, 3, 11, 58).toISOString() }];
  const liveHtml = renderDashboard({ agg: aggregate(fresh, { now }), ...base });
  assert.match(liveHtml, /in-progress session is included/);
  assert.match(liveHtml, /id="cw-live"/);

  // Last event an hour ago -> not live (the CSS class always exists; assert on the badge text)
  const staleHtml = renderDashboard({ agg: aggregate(events, { now }), ...base });
  assert.ok(!staleHtml.includes('in-progress session is included'));

  // Future-dated last event (clock skew) must not claim live either
  const future = [{ ...events[0], ts: new Date(2026, 5, 3, 12, 30).toISOString() }];
  const futureHtml = renderDashboard({ agg: aggregate(future, { now }), ...base });
  assert.ok(!futureHtml.includes('in-progress session is included'));
});

test('renderDashboard does not throw on an empty (first-run) aggregate', () => {
  const agg = aggregate([], { now });
  assert.doesNotThrow(() => renderDashboard({
    agg, plan: planFromKey('max5'), planKey: 'max5',
    sourceDir: '/tmp/x', generatedAt: now, version: '0.0.0',
  }));
});
