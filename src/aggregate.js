import { priceEvent, familyOf, modelInfo } from './pricing.js';
import { prettyCwd } from './reader.js';

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

// For each project folder, pick the most common real cwd and turn it into a display name.
// Returns Map(projectRaw -> displayName). Folders with no cwd on any event are absent.
function resolveProjectNames(priced) {
  const counts = new Map(); // projectRaw -> Map(cwd -> count)
  for (const e of priced) {
    if (!e.cwd) continue;
    let m = counts.get(e.projectRaw);
    if (!m) { m = new Map(); counts.set(e.projectRaw, m); }
    m.set(e.cwd, (m.get(e.cwd) || 0) + 1);
  }
  const names = new Map();
  for (const [raw, m] of counts) {
    let best = '', bestN = -1;
    for (const [cwd, n] of m) if (n > bestN) { best = cwd; bestN = n; }
    const pretty = prettyCwd(best);
    if (pretty) names.set(raw, pretty);
  }
  return names;
}

export function aggregate(events, { now = new Date() } = {}) {
  // Drop events whose timestamp didn't parse — they can't be bucketed, and counting them only
  // in all-time totals (but nowhere else) would make the surfaces disagree. Also drop
  // "<synthetic>" placeholder rows: they represent no API call, so counting them as messages
  // anywhere (or showing a $0 "synthetic" family row) would just be noise.
  const priced = priceAndAnnotate(events)
    .filter(e => !Number.isNaN(e.date.getTime()) && e.family !== 'synthetic');

  // Prefer the accurate cwd-derived name; fall back to the dash-decoded folder name.
  const nameByRaw = resolveProjectNames(priced);
  for (const e of priced) e.projectName = nameByRaw.get(e.projectRaw) || e.project;

  const weekStart = startOfWeek(now);
  // Next Monday 00:00 local via calendar arithmetic (not +7*24h) so it stays correct across a
  // DST transition — otherwise the week would be an hour long/short twice a year.
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  // Previous Monday 00:00, same calendar arithmetic for the same DST reason.
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  const monthAgo = new Date(now.getTime() - 30 * DAY);

  // Current 5h rolling session window: from (now - 5h) to now,
  // but realistically anchored at the start of the most recent burst of activity.
  const sessionWindowStart = new Date(now.getTime() - SESSION_WINDOW_MS);

  const inWindow = (e, start, end = now) => e.date >= start && e.date <= end;

  // Week uses a half-open interval so an event at exactly next-Monday 00:00 belongs to next week.
  // week/today also clamp at `now` so a future-stamped event (clock skew, a ~/.claude synced from
  // another machine) can't be counted here while the rolling windows exclude it.
  const week = priced.filter(e => e.date >= weekStart && e.date < weekEnd && e.date <= now);
  const lastWeek = priced.filter(e => e.date >= lastWeekStart && e.date < weekStart);
  const todayKey = localDateKey(now);
  const today = priced.filter(e => localDateKey(e.date) === todayKey && e.date <= now);
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
        project: e.projectName,
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
    const row = projectMap.get(e.projectName) || { project: e.projectName, cost: 0, calls: 0 };
    row.cost += e.cost;
    row.calls += 1;
    projectMap.set(e.projectName, row);
  }
  const projects = [...projectMap.values()].sort((a, b) => b.cost - a.cost);

  // By model family within this week
  const familyMap = new Map();
  for (const e of week) {
    const row = familyMap.get(e.family) || {
      family: e.family, cost: 0, calls: 0,
      input: 0, output: 0, cacheRead: 0, cacheCreate: 0,
    };
    row.cost += e.cost;
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
  const dowTotalsCalls = Array(7).fill(0);
  for (const e of last30) {
    const jsDow = e.date.getDay(); // 0=Sun
    const dow = (jsDow + 6) % 7;   // 0=Mon
    const hour = e.date.getHours();
    matrix[dow][hour] += e.cost;
    matrixCalls[dow][hour] += 1;
    hourTotals[hour] += e.cost;
    dowTotals[dow] += e.cost;
    dowTotalsCalls[dow] += 1;
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
  // (Today counts even if you've only used Claude once.) Built from a full-history day set, not
  // the 30-day chart window, so streaks longer than a month aren't silently capped at ~30.
  const daysWithUsage = new Set();
  for (const e of priced) daysWithUsage.add(localDateKey(e.date));
  let streak = 0;
  for (let i = 0; i < 3650; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = localDateKey(d);
    if (daysWithUsage.has(key)) {
      streak += 1;
    } else if (i === 0) {
      // No usage today yet — keep counting back from yesterday.
      continue;
    } else {
      break;
    }
  }

  // All-time bounds
  const allTimeFirst = priced.length ? priced[0].date : null;
  const allTimeLast = priced.length ? priced[priced.length - 1].date : null;

  return {
    now,
    weekStart,
    weekEnd,
    sessionWindowStart,
    totals: {
      week:     { cost: sum(week, 'cost'),     calls: week.length },
      lastWeek: { cost: sum(lastWeek, 'cost'), calls: lastWeek.length },
      today:    { cost: sum(today, 'cost'),    calls: today.length },
      session:  { cost: sum(session, 'cost'),  calls: session.length },
      last30:   { cost: sum(last30, 'cost'),   calls: last30.length },
      allTime:  { cost: sum(all, 'cost'),      calls: all.length, firstTs: allTimeFirst, lastTs: allTimeLast },
    },
    sessions,
    projects,
    families,
    dailySeries,
    topCall,
    unknownModels: [...unknownModels.entries()].map(([model, n]) => ({ model, n })),
    heatmap: { matrix, matrixCalls, hourTotals, dowTotals, dowTotalsCalls },
    streak,
  };
}
