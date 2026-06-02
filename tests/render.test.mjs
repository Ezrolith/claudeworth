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
});

test('renderDashboard does not throw on an empty (first-run) aggregate', () => {
  const agg = aggregate([], { now });
  assert.doesNotThrow(() => renderDashboard({
    agg, plan: planFromKey('max5'), planKey: 'max5',
    sourceDir: '/tmp/x', generatedAt: now, version: '0.0.0',
  }));
});
