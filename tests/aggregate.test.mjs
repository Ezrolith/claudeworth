import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, startOfWeek } from '../src/aggregate.js';

const DAY = 24 * 3600 * 1000;

// Build a usage event from a LOCAL Date so heatmap/streak bucketing is timezone-independent:
// new Date(localDate.toISOString()) round-trips to the same instant, and the local getters
// (getHours/getDay) return exactly what we set here regardless of the runner's timezone.
const ev = (localDate, o) => ({
  ts: localDate.toISOString(),
  model: 'claude-sonnet-4',
  sessionId: 's',
  project: 'fallback/name',
  projectRaw: 'raw',
  cwd: '',
  input: 0, output: 0, cacheRead: 0,
  cacheCreate5m: 0, cacheCreate1h: 0, cacheCreateTotal: 0,
  ...o,
});

test('startOfWeek lands on Monday 00:00 local and never moves forward past the date', () => {
  for (const d of [
    new Date(2026, 5, 3, 15, 30), // Wed afternoon
    new Date(2026, 5, 7, 23, 0),  // Sunday late (must map back to that week's Monday)
    new Date(2026, 5, 1, 0, 0),   // Monday midnight (boundary)
  ]) {
    const sow = startOfWeek(d);
    assert.equal(sow.getDay(), 1, 'is a Monday');
    assert.equal(sow.getHours(), 0);
    assert.equal(sow.getMinutes(), 0);
    assert.ok(sow.getTime() <= d.getTime(), 'not after the input date');
    assert.ok(d.getTime() - sow.getTime() < 7 * DAY, 'within the same week');
  }
});

test('aggregate rolls up week/session/project/family/streak/heatmap from a synthetic set', () => {
  const now = new Date(2026, 5, 3, 12, 0, 0); // Wed Jun 3 2026, noon local
  const events = [
    ev(new Date(2026, 5, 3, 11), { model: 'claude-sonnet-4', input: 1e6, sessionId: 's1', projectRaw: 'rawA', cwd: '/home/me/projA' }), // $3
    ev(new Date(2026, 5, 3, 10), { model: 'claude-opus-4-5', output: 1e6, sessionId: 's1', projectRaw: 'rawA', cwd: '/home/me/projA' }), // $25
    ev(new Date(2026, 5, 2, 9),  { model: 'claude-sonnet-4', input: 1e6, sessionId: 's2', projectRaw: 'rawB', cwd: '/home/me/projB' }), // $3 (yesterday)
    ev(new Date(2026, 4, 24, 10), { model: 'claude-sonnet-4', input: 1e6, sessionId: 's3', projectRaw: 'rawA', cwd: '/home/me/projA' }), // $3 (10 days ago)
  ];
  const a = aggregate(events, { now });

  // Windows
  assert.equal(a.totals.week.cost, 31);    // e1+e2+e3, e4 predates this week
  assert.equal(a.totals.week.calls, 3);
  assert.equal(a.totals.session.cost, 28); // e1+e2 within the last 5h
  assert.equal(a.totals.session.calls, 2);
  assert.equal(a.totals.last30.calls, 4);
  assert.equal(a.totals.allTime.calls, 4);
  assert.equal(a.totals.allTime.cost, 34);

  // Sessions / projects / families
  assert.equal(a.sessions[0].sessionId, 's1');
  assert.equal(a.sessions[0].cost, 28);
  assert.equal(a.projects[0].project, 'me/projA'); // accurate name derived from cwd
  assert.equal(a.projects[0].cost, 28);
  assert.equal(a.projects[0].calls, 2);
  assert.equal(a.families[0].family, 'opus-4.5+');
  assert.equal(a.families[0].cost, 25);

  // Streak: today + yesterday, then a gap before the 10-days-ago event
  assert.equal(a.streak, 2);

  // Heatmap: Wed = row 2 (Mon=0); e1 at 11:00, e2 at 10:00
  assert.equal(a.heatmap.matrix[2][11], 3);
  assert.equal(a.heatmap.matrixCalls[2][11], 1);
  assert.equal(a.heatmap.matrix[2][10], 25);
  assert.equal(a.heatmap.dowTotalsCalls[2], 2);
});

test('aggregate falls back to the decoded project name when cwd is absent', () => {
  const now = new Date(2026, 5, 3, 12, 0, 0);
  const a = aggregate([
    ev(new Date(2026, 5, 3, 11), { input: 1e6, project: 'decoded/fallback', projectRaw: 'rawX', cwd: '' }),
  ], { now });
  assert.equal(a.projects[0].project, 'decoded/fallback');
});

test('aggregate([]) returns a safe zeroed contract and never throws (first-run path)', () => {
  let a;
  assert.doesNotThrow(() => { a = aggregate([]); });
  assert.equal(a.topCall, null);
  assert.equal(a.totals.allTime.calls, 0);
  assert.equal(a.totals.allTime.cost, 0);
  assert.equal(a.totals.allTime.firstTs, null);
  assert.deepEqual(a.sessions, []);
  assert.deepEqual(a.projects, []);
  assert.deepEqual(a.families, []);
  assert.equal(a.streak, 0);
  assert.equal(a.heatmap.matrix.length, 7);
});

test('aggregate drops events with an unparseable timestamp from all surfaces', () => {
  const now = new Date(2026, 5, 3, 12, 0, 0);
  const good = ev(new Date(2026, 5, 3, 11), { input: 1e6 });
  const bad = ev(new Date(2026, 5, 3, 11), { input: 1e6, ts: 'not-a-date' });
  const a = aggregate([good, bad], { now });
  assert.equal(a.totals.allTime.calls, 1); // the bad-timestamp event is excluded everywhere
});
