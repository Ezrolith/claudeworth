import { priceEvent, priceEventUncached, familyOf, modelInfo } from './pricing.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SESSION_WINDOW_MS = 5 * HOUR;

// Start of the current week, Monday 00:00 local time.
// (Anthropic resets weekly quotas weekly; exact day varies by account but Monday
// is the safest readable default. Easy to switch later if it matters.)
export function startOfWeek(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0=Sun
  const daysFromMonday = (dow + 6) % 7;
  d.setDate(d.getDate() - daysFromMonday);
  return d;
}

export function priceAndAnnotate(events) {
  return events.map(ev => ({
    ...ev,
    family: familyOf(ev.model),
    cost: priceEvent(ev),
    uncachedCost: priceEventUncached(ev),
    date: new Date(ev.ts),
  }));
}

// Local-timezone YYYY-MM-DD key — toISOString uses UTC, which mis-buckets late-night work.
function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function aggregate(events, { now = new Date() } = {}) {
  const priced = priceAndAnnotate(events);

  const weekStart = startOfWeek(now);
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY);
  const monthAgo = new Date(now.getTime() - 30 * DAY);

  // Current 5h rolling session window: from (now - 5h) to now,
  // but realistically anchored at the start of the most recent burst of activity.
  const sessionWindowStart = new Date(now.getTime() - SESSION_WINDOW_MS);

  const inWindow = (e, start, end = now) => e.date >= start && e.date <= end;

  const week = priced.filter(e => inWindow(e, weekStart, weekEnd));
  const session = priced.filter(e => inWindow(e, sessionWindowStart));
  const last30 = priced.filter(e => inWindow(e, monthAgo));
  const all = priced;

  // Per-session rollup (group by sessionId) within last 30 days
  const sessionMap = new Map();
  for (const e of last30) {
    const key = e.sessionId;
    let row = sessionMap.get(key);
    if (!row) {
      row = {
        sessionId: key,
        project: e.project,
        firstTs: e.date,
        lastTs: e.date,
        cost: 0,
        calls: 0,
        byFamily: {},
      };
      sessionMap.set(key, row);
    }
    row.cost += e.cost;
    row.calls += 1;
    row.firstTs = e.date < row.firstTs ? e.date : row.firstTs;
    row.lastTs = e.date > row.lastTs ? e.date : row.lastTs;
    row.byFamily[e.family] = (row.byFamily[e.family] || 0) + e.cost;
  }
  const sessions = [...sessionMap.values()].sort((a, b) => b.cost - a.cost);

  // Per-project rollup within this week
  const projectMap = new Map();
  for (const e of week) {
    const row = projectMap.get(e.project) || { project: e.project, cost: 0, calls: 0 };
    row.cost += e.cost;
    row.calls += 1;
    projectMap.set(e.project, row);
  }
  const projects = [...projectMap.values()].sort((a, b) => b.cost - a.cost);

  // By model family within this week
  const familyMap = new Map();
  for (const e of week) {
    const row = familyMap.get(e.family) || {
      family: e.family, cost: 0, uncachedCost: 0, calls: 0,
      input: 0, output: 0, cacheRead: 0, cacheCreate: 0,
    };
    row.cost += e.cost;
    row.uncachedCost += e.uncachedCost;
    row.calls += 1;
    row.input += e.input;
    row.output += e.output;
    row.cacheRead += e.cacheRead;
    row.cacheCreate += e.cacheCreate5m + e.cacheCreate1h + (e.cacheCreate5m || e.cacheCreate1h ? 0 : e.cacheCreateTotal);
    familyMap.set(e.family, row);
  }
  const families = [...familyMap.values()].sort((a, b) => b.cost - a.cost);
  for (const f of families) {
    const totalInput = f.input + f.cacheRead + f.cacheCreate;
    f.cacheHitRate = totalInput > 0 ? f.cacheRead / totalInput : 0;
    f.cacheSavings = Math.max(0, f.uncachedCost - f.cost);
  }

  // Daily series for the last 30 days, bucketed in LOCAL time.
  const dayMap = new Map();
  for (const e of last30) {
    const day = localDateKey(e.date);
    const row = dayMap.get(day) || { day, cost: 0, calls: 0 };
    row.cost += e.cost;
    row.calls += 1;
    dayMap.set(day, row);
  }
  const dailySeries = [...dayMap.values()].sort((a, b) => (a.day < b.day ? -1 : 1));

  // Most expensive single API call (across all time, for the curiosity stat)
  let topCall = null;
  for (const e of priced) {
    if (!topCall || e.cost > topCall.cost) topCall = e;
  }

  // Day-of-week × hour heatmap over the last 30 days, in local time.
  // dow: 0=Mon ... 6=Sun (matches startOfWeek convention).
  const matrix = Array.from({ length: 7 }, () => Array(24).fill(0));
  const matrixCalls = Array.from({ length: 7 }, () => Array(24).fill(0));
  const hourTotals = Array(24).fill(0);
  const dowTotals = Array(7).fill(0);
  for (const e of last30) {
    const jsDow = e.date.getDay(); // 0=Sun
    const dow = (jsDow + 6) % 7;   // 0=Mon
    const hour = e.date.getHours();
    matrix[dow][hour] += e.cost;
    matrixCalls[dow][hour] += 1;
    hourTotals[hour] += e.cost;
    dowTotals[dow] += e.cost;
  }

  // Distinct model strings that didn't match our price table — surface for transparency.
  const unknownModels = new Map();
  for (const e of priced) {
    if (modelInfo(e.model).unknown) {
      unknownModels.set(e.model, (unknownModels.get(e.model) || 0) + 1);
    }
  }

  const sum = (arr, k) => arr.reduce((s, x) => s + x[k], 0);

  // Current usage streak: consecutive days back from today with at least one event.
  // (Today counts even if you've only used Claude once.)
  let streak = 0;
  const dayCostMap = new Map(dailySeries.map(d => [d.day, d.cost]));
  for (let i = 0; i < 365; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = localDateKey(d);
    if ((dayCostMap.get(key) || 0) > 0) {
      streak += 1;
    } else if (i === 0) {
      // No usage today — streak is whatever it was before today.
      // Restart count from yesterday.
      continue;
    } else {
      break;
    }
  }

  // All-time bounds
  const allTimeFirst = priced.length ? priced[0].date : null;
  const allTimeLast = priced.length ? priced[priced.length - 1].date : null;
  const allTimeUncached = sum(priced, 'uncachedCost');
  const allTimeCost = sum(priced, 'cost');

  return {
    now,
    weekStart,
    weekEnd,
    sessionWindowStart,
    totals: {
      week:       { cost: sum(week, 'cost'),    uncachedCost: sum(week, 'uncachedCost'),    calls: week.length },
      session:    { cost: sum(session, 'cost'), uncachedCost: sum(session, 'uncachedCost'), calls: session.length },
      last30:     { cost: sum(last30, 'cost'),  uncachedCost: sum(last30, 'uncachedCost'),  calls: last30.length },
      allTime:    { cost: allTimeCost,          uncachedCost: allTimeUncached,              calls: all.length, firstTs: allTimeFirst, lastTs: allTimeLast },
    },
    sessions,
    projects,
    families,
    dailySeries,
    topCall,
    unknownModels: [...unknownModels.entries()].map(([model, n]) => ({ model, n })),
    heatmap: { matrix, matrixCalls, hourTotals, dowTotals },
    streak,
  };
}
