import { weeklyCost } from './plans.js';
import { pricingTable, CACHE_MULTIPLIERS } from './pricing.js';

const fmtUsd = (n) => {
  if (n == null || isNaN(n)) return '$0.00';
  if (Math.abs(n) >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (Math.abs(n) >= 1)    return '$' + n.toFixed(2);
  return '$' + n.toFixed(3);
};

const fmtInt = (n) => (n || 0).toLocaleString('en-US');

const fmtPct = (n) => (n * 100).toFixed(1) + '%';

const fmtDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const fmtDateTime = (d) =>
  d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Compact token format: 12.3K, 4.5M etc.
function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function pct(num, denom) {
  if (!denom) return 0;
  return Math.min(1, Math.max(0, num / denom));
}

function bar(fraction, { danger = 0.85, warn = 0.65, invert = false } = {}) {
  const f = Math.min(1, Math.max(0, fraction));
  const cls = invert
    ? (f >= danger ? 'bar-ok' : f >= warn ? 'bar-warn' : 'bar-danger')
    : (f >= danger ? 'bar-danger' : f >= warn ? 'bar-warn' : 'bar-ok');
  return `<span class="bar ${cls}"><span class="bar-fill" style="width:${(f*100).toFixed(1)}%"></span></span>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function renderDashboard({ agg, plan, planKey, sourceDir, generatedAt }) {
  const weeklySub = weeklyCost(plan);
  const weekValue = agg.totals.week.cost;
  const multiplier = weeklySub > 0 ? weekValue / weeklySub : 0;
  const saved = weekValue - weeklySub;

  // Pace projection
  const now = agg.now;
  const weekElapsedMs = now - agg.weekStart;
  const fullWeekMs = agg.weekEnd - agg.weekStart;
  const weekFraction = Math.max(0.01, Math.min(1, weekElapsedMs / fullWeekMs));
  const projectedWeek = weekValue / weekFraction;
  const projectedMonth = projectedWeek * 4.345;
  const projectedMultiplier = plan.monthly > 0 ? projectedMonth / plan.monthly : 0;

  // Session window labels
  const sessionStartLabel = fmtDateTime(agg.sessionWindowStart);

  // Week reset
  const weekResetIn = agg.weekEnd - now;
  const weekResetDays = Math.floor(weekResetIn / (24 * 3600 * 1000));
  const weekResetHrs = Math.floor((weekResetIn % (24 * 3600 * 1000)) / (3600 * 1000));

  // All-time
  const allTime = agg.totals.allTime;

  // Daily sparkline + table
  const maxDay = Math.max(1, ...agg.dailySeries.map(d => d.cost));
  const recentDays = agg.dailySeries.slice(-30);
  const sparkBars = recentDays.map(d => {
    const h = Math.max(2, Math.round((d.cost / maxDay) * 60));
    return `<div class="spark-col"><div class="spark-tip">${d.day} · <strong>${fmtUsd(d.cost)}</strong> · ${fmtInt(d.calls)} calls</div><div class="spark-bar" style="height:${h}px"></div><div class="spark-label">${d.day.slice(8)}</div></div>`;
  }).join('');

  // Heatmap — render two grids (cost and calls), CSS toggle between them.
  const { matrix, matrixCalls, hourTotals, dowTotals } = agg.heatmap;
  const heatmapMaxCost = Math.max(0, ...matrix.flat());
  const heatmapMaxCalls = Math.max(0, ...matrixCalls.flat());
  const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  function renderHeatGrid(values, max, labelFn, unit) {
    return values.map((row, dow) =>
      row.map((v, hour) => {
        const intensity = max > 0 ? v / max : 0;
        const alpha = intensity > 0 ? 0.08 + 0.92 * Math.sqrt(intensity) : 0;
        const title = v > 0
          ? `${DOW_LABELS[dow]} ${String(hour).padStart(2, '0')}:00 · ${labelFn(v)}`
          : `${DOW_LABELS[dow]} ${String(hour).padStart(2, '0')}:00 · idle`;
        return `<div class="hm-cell" style="background:rgba(210,140,255,${alpha.toFixed(3)})" title="${title}"></div>`;
      }).join('')
    ).join('');
  }
  const heatmapCellsCost = renderHeatGrid(matrix, heatmapMaxCost, fmtUsd, '$');
  const heatmapCellsCalls = renderHeatGrid(matrixCalls, heatmapMaxCalls, (v) => fmtInt(v) + ' calls', 'calls');

  const peakHour = hourTotals.indexOf(Math.max(...hourTotals));
  const peakDow = dowTotals.indexOf(Math.max(...dowTotals));
  const hourLabel = (h) => {
    const ampm = h < 12 ? 'am' : 'pm';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}${ampm}`;
  };
  const heatmapSummary = heatmapMaxCost > 0
    ? `Busiest hour: <strong>${hourLabel(peakHour)}</strong> (${fmtUsd(hourTotals[peakHour])}) · busiest day: <strong>${DOW_LABELS[peakDow]}</strong> (${fmtUsd(dowTotals[peakDow])})`
    : 'Not enough data yet.';

  // Hour-axis ticks (every 3 hours for readability)
  const hourTicks = Array.from({ length: 24 }, (_, h) =>
    `<div class="hm-htick">${h % 3 === 0 ? hourLabel(h) : ''}</div>`
  ).join('');

  const topDays = [...recentDays].sort((a, b) => b.cost - a.cost).slice(0, 7);
  const topDaysRows = topDays.map(d => `
    <tr>
      <td>${d.day}</td>
      <td class="num">${fmtUsd(d.cost)}</td>
      <td class="num">${fmtInt(d.calls)}</td>
    </tr>`).join('');

  const topSessions = agg.sessions.slice(0, 8);
  const topProjects = agg.projects.slice(0, 6);

  const familyRows = agg.families.map(f => `
    <tr>
      <td class="model">${escapeHtml(f.family)}</td>
      <td class="num">${fmtUsd(f.cost)}</td>
      <td class="num">${fmtInt(f.calls)}</td>
      <td class="num">${fmtTokens(f.input)}</td>
      <td class="num">${fmtTokens(f.output)}</td>
      <td class="num">${fmtTokens(f.cacheCreate)}</td>
      <td class="num">${fmtTokens(f.cacheRead)}</td>
      <td class="num">${fmtPct(f.cacheHitRate)}</td>
    </tr>`).join('');

  const projectRows = topProjects.map(p => `
    <tr>
      <td>${escapeHtml(p.project)}</td>
      <td class="num">${fmtUsd(p.cost)}</td>
      <td class="num">${fmtInt(p.calls)}</td>
    </tr>`).join('');

  const sessionRows = topSessions.map(s => {
    const families = Object.entries(s.byFamily)
      .sort((a, b) => b[1] - a[1])
      .map(([fam]) => fam)
      .slice(0, 2)
      .join(' + ');
    return `
    <tr>
      <td>${fmtDate(s.firstTs)}</td>
      <td>${escapeHtml(s.project)}</td>
      <td class="subtle">${escapeHtml(families)}</td>
      <td class="num">${fmtUsd(s.cost)}</td>
      <td class="num">${fmtInt(s.calls)}</td>
    </tr>`;
  }).join('');

  // Methodology
  const priceRows = pricingTable().map(p => `
    <tr>
      <td class="model">${escapeHtml(p.family)}</td>
      <td class="num">$${p.input}</td>
      <td class="num">$${p.output}</td>
      <td class="num">$${p.cacheRead}</td>
      <td class="num">$${p.cache5m}</td>
      <td class="num">$${p.cache1h}</td>
    </tr>`).join('');

  const unknownBlock = agg.unknownModels.length
    ? `<p class="subtle">Unmatched model strings (priced at Sonnet fallback rate — please report if any of these should have a specific price):</p>
       <ul class="subtle">${agg.unknownModels.map(u => `<li><code>${escapeHtml(u.model)}</code> — ${fmtInt(u.n)} call${u.n === 1 ? '' : 's'}</li>`).join('')}</ul>`
    : '';

  // Headline savings line — only show $ saved when above break-even
  const headlineSavings = saved >= 0
    ? `<strong>${fmtUsd(saved)} saved</strong>`
    : `<strong class="bad">${fmtUsd(-saved)} behind</strong>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>claudeworth · ${plan.label}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --bg: #0e1117;
    --panel: #161b22;
    --panel-2: #1c222b;
    --text: #e6edf3;
    --muted: #8b949e;
    --accent: #d28cff;
    --ok: #3fb950;
    --warn: #d29922;
    --danger: #f85149;
    --border: #30363d;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  a { color: var(--accent); }
  main { max-width: 1180px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; font-weight: 600; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 28px 0 8px; font-weight: 600; }
  .subtle { color: var(--muted); font-size: 13px; }
  .good { color: var(--ok); }
  .bad  { color: var(--danger); }

  .hero {
    background: linear-gradient(135deg, #1a2030 0%, #1d1832 100%);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px 28px;
    margin-bottom: 16px;
  }
  .hero-row { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap; }
  .hero-title { font-size: 13px; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; }
  .hero-big {
    font-size: 56px; font-weight: 700; line-height: 1; margin: 8px 0 4px;
    background: linear-gradient(90deg, #d28cff 0%, #58a6ff 100%);
    -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  }
  .hero-stat { font-size: 14px; color: var(--muted); }
  .hero-stat strong { color: var(--text); font-weight: 600; }
  .verdict { font-size: 18px; margin-top: 10px; }
  .verdict.good { color: var(--ok); }
  .verdict.meh  { color: var(--warn); }
  .verdict.bad  { color: var(--danger); }

  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
  @media (max-width: 900px) { .grid, .grid-3 { grid-template-columns: 1fr; } }

  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 18px 20px;
  }
  .card h3 { margin: 0 0 12px; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 4px 0; }
  .row .label { color: var(--muted); }
  .row strong { font-variant-numeric: tabular-nums; }
  .bar { display: inline-block; width: 100%; height: 10px; background: #21262d; border-radius: 6px; overflow: hidden; vertical-align: middle; }
  .bar-fill { display: block; height: 100%; }
  .bar-ok    .bar-fill { background: var(--ok); }
  .bar-warn  .bar-fill { background: var(--warn); }
  .bar-danger .bar-fill { background: var(--danger); }

  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); font-size: 13px; }
  th { color: var(--muted); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  td.num, th.num { text-align: right; }
  td.model { color: var(--accent); }
  tr:last-child td { border-bottom: none; }

  .hm-wrap { display: grid; grid-template-columns: 36px 1fr; gap: 4px; }
  .hm-grid { display: grid; grid-template-columns: repeat(24, 1fr); gap: 2px; }
  .hm-cell { aspect-ratio: 1; min-height: 14px; border-radius: 2px; background: #1c222b; transition: outline 0.1s; }
  .hm-cell:hover { outline: 1px solid var(--accent); }
  .hm-dow-col { display: grid; grid-template-rows: repeat(7, 1fr); gap: 2px; font-size: 10px; color: var(--muted); align-items: center; }
  .hm-dow { display: flex; align-items: center; justify-content: flex-end; padding-right: 4px; min-height: 14px; }
  .hm-htick { font-size: 10px; color: var(--muted); text-align: left; }
  .hm-htick-row { display: grid; grid-template-columns: repeat(24, 1fr); gap: 2px; margin-top: 4px; }
  .hm-controls { display: flex; gap: 4px; margin-bottom: 12px; }
  .hm-btn { background: var(--panel-2); color: var(--muted); border: 1px solid var(--border); padding: 4px 12px; border-radius: 6px; font: inherit; font-size: 12px; cursor: pointer; }
  .hm-btn:hover { color: var(--text); }
  .hm-btn.active { background: var(--accent); color: #1a1030; border-color: var(--accent); }
  .hm-container[data-mode="cost"]  .hm-view-calls { display: none; }
  .hm-container[data-mode="calls"] .hm-view-cost  { display: none; }

  .spark { display: flex; align-items: flex-end; gap: 3px; height: 80px; padding: 4px 0; overflow: visible; position: relative; }
  .spark-col { display: flex; flex-direction: column; align-items: center; min-width: 14px; position: relative; cursor: default; }
  .spark-bar { width: 8px; background: linear-gradient(180deg, #58a6ff, #d28cff); border-radius: 2px 2px 0 0; transition: filter 0.1s; }
  .spark-col:hover .spark-bar { filter: brightness(1.4); }
  .spark-label { font-size: 9px; color: var(--muted); margin-top: 3px; }
  .spark-tip {
    position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
    background: var(--panel-2); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px;
    padding: 6px 10px; font-size: 12px; white-space: nowrap;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    opacity: 0; pointer-events: none; transition: opacity 0.1s;
    z-index: 20;
  }
  .spark-col:hover .spark-tip { opacity: 1; }

  details { margin-top: 24px; }
  details summary { cursor: pointer; color: var(--muted); font-size: 13px; padding: 8px 0; }
  details summary:hover { color: var(--text); }
  details[open] summary { color: var(--text); }

  .plan-picker { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  .plan-picker select {
    background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 4px 8px; font: inherit; font-size: 13px; cursor: pointer;
  }
  .plan-picker select:hover { border-color: var(--accent); }
  .plan-picker select:focus { outline: none; border-color: var(--accent); }

  footer { color: var(--muted); font-size: 12px; margin-top: 24px; text-align: center; }
  code { background: #21262d; padding: 1px 6px; border-radius: 4px; font-size: 12px; }
</style>
</head>
<body>
<main>

<div class="hero">
  <div class="hero-row">
    <div>
      <div class="plan-picker">
        <label class="hero-title" for="cw-plan-select">Plan:</label>
        <select id="cw-plan-select">
          <option value="pro"${planKey === 'pro' ? ' selected' : ''}>Claude Pro · $20/mo</option>
          <option value="max5"${planKey === 'max5' ? ' selected' : ''}>Claude Max 5x · $100/mo</option>
          <option value="max20"${planKey === 'max20' ? ' selected' : ''}>Claude Max 20x · $200/mo</option>
        </select>
      </div>
      <div class="subtle">Week of ${fmtDate(agg.weekStart)} – ${fmtDate(new Date(agg.weekEnd - 1))}</div>
    </div>
    <div style="text-align: right;">
      <div class="hero-title">Effective multiplier</div>
      <div class="hero-big" id="cw-mult">${multiplier.toFixed(1)}×</div>
      <div class="hero-stat" id="cw-stat-line">${fmtUsd(weekValue)} value · <span id="cw-weeklysub-inline">${fmtUsd(weeklySub)}</span> paid · <span id="cw-saved">${headlineSavings}</span></div>
    </div>
  </div>
  <div class="verdict ${multiplier >= 2 ? 'good' : multiplier >= 1 ? 'meh' : 'bad'}" id="cw-verdict">
    ${multiplier >= 1
      ? `On pace for <strong>${fmtUsd(projectedMonth)}</strong> API value this month vs <strong>${fmtUsd(plan.monthly)}</strong> paid (${projectedMultiplier.toFixed(1)}×).`
      : `You're under break-even this week. Need ${fmtUsd(weeklySub - weekValue)} more API value to pay for the sub.`}
  </div>
</div>

<div class="grid">

  <div class="card">
    <h3>Last 5 hours</h3>
    <div class="row"><span class="label">API value</span><strong>${fmtUsd(agg.totals.session.cost)}</strong></div>
    <div class="row"><span class="label">Messages</span><strong>${fmtInt(agg.totals.session.calls)}</strong></div>
    <div class="row"><span class="label">Window</span><strong>${sessionStartLabel} → now</strong></div>
    <div class="subtle" style="margin-top:8px;">Rolling 5h window — proxy for the Claude Code session cap.</div>
  </div>

  <div class="card">
    <h3>This week</h3>
    <div class="row"><span class="label">API value</span><strong>${fmtUsd(weekValue)}</strong></div>
    <div class="row"><span class="label">Subscription (prorated)</span><strong id="cw-weeklysub">${fmtUsd(weeklySub)}</strong></div>
    <div class="row"><span class="label">vs break-even</span><strong id="cw-vs-be">${multiplier >= 1 ? multiplier.toFixed(1) + '× over' : fmtPct(pct(weekValue, weeklySub)) + ' of break-even'}</strong></div>
    <div style="margin: 8px 0;" id="cw-be-bar-wrap">${bar(Math.min(1, weekValue / weeklySub), { invert: true, danger: 1.0, warn: 0.5 })}</div>
    <div class="row"><span class="label">Resets in</span><strong>${weekResetDays}d ${weekResetHrs}h</strong></div>
  </div>

</div>

<h2>Daily API-equivalent value · last 30 days</h2>
<div class="grid">
  <div class="card">
    <div class="spark">${sparkBars || '<div class="subtle">No data yet.</div>'}</div>
  </div>
  <div class="card">
    <h3>Top days</h3>
    <table>
      <thead><tr><th>Day</th><th class="num">Cost</th><th class="num">Calls</th></tr></thead>
      <tbody>${topDaysRows || '<tr><td colspan="3" class="subtle">No data.</td></tr>'}</tbody>
    </table>
  </div>
</div>

<div class="grid">

  <div class="card">
    <h3>Top sessions (last 30 days)</h3>
    <table>
      <thead><tr><th>Started</th><th>Project</th><th>Models</th><th class="num">Cost</th><th class="num">Calls</th></tr></thead>
      <tbody>${sessionRows || '<tr><td colspan="5" class="subtle">No sessions.</td></tr>'}</tbody>
    </table>
  </div>

  <div class="card">
    <h3>By project (this week)</h3>
    <table>
      <thead><tr><th>Project</th><th class="num">Cost</th><th class="num">Calls</th></tr></thead>
      <tbody>${projectRows || '<tr><td colspan="3" class="subtle">Nothing this week yet.</td></tr>'}</tbody>
    </table>
  </div>

</div>

<h2>When you actually work · last 30 days, your local time</h2>
<div class="card hm-container" data-mode="cost">
  <div class="hm-controls">
    <button type="button" class="hm-btn active" data-mode="cost">$ Cost</button>
    <button type="button" class="hm-btn" data-mode="calls">Calls</button>
  </div>
  <div class="hm-wrap hm-view hm-view-cost">
    <div class="hm-dow-col">
      ${DOW_LABELS.map(d => `<div class="hm-dow">${d}</div>`).join('')}
    </div>
    <div>
      <div class="hm-grid">${heatmapCellsCost}</div>
      <div class="hm-htick-row">${hourTicks}</div>
    </div>
  </div>
  <div class="hm-wrap hm-view hm-view-calls">
    <div class="hm-dow-col">
      ${DOW_LABELS.map(d => `<div class="hm-dow">${d}</div>`).join('')}
    </div>
    <div>
      <div class="hm-grid">${heatmapCellsCalls}</div>
      <div class="hm-htick-row">${hourTicks}</div>
    </div>
  </div>
  <p class="subtle" style="margin-top: 12px; margin-bottom: 0;">${heatmapSummary}</p>
</div>
<script>
  document.querySelectorAll('.hm-container').forEach(c => {
    c.querySelectorAll('.hm-btn').forEach(b => {
      b.addEventListener('click', () => {
        c.dataset.mode = b.dataset.mode;
        c.querySelectorAll('.hm-btn').forEach(x => x.classList.toggle('active', x === b));
      });
    });
  });

  // Plan dropdown: recompute multiplier / saved / verdict / break-even on change.
  (function() {
    const PLANS = {
      pro:   { monthly: 20,  label: 'Claude Pro' },
      max5:  { monthly: 100, label: 'Claude Max 5x' },
      max20: { monthly: 200, label: 'Claude Max 20x' },
    };
    const WEEKS_PER_MONTH = 4.345;
    const weekValue = ${weekValue};
    const weekFraction = ${weekFraction};

    const fmtUsd = (n) => {
      if (n == null || isNaN(n)) return '$0.00';
      if (Math.abs(n) >= 1000) return '$' + Math.round(n).toLocaleString('en-US');
      if (Math.abs(n) >= 1) return '$' + n.toFixed(2);
      return '$' + n.toFixed(3);
    };
    const fmtPct = (n) => (n * 100).toFixed(1) + '%';

    function recompute(planKey) {
      const plan = PLANS[planKey] || PLANS.max5;
      const weekly = plan.monthly / WEEKS_PER_MONTH;
      const mult = weekly > 0 ? weekValue / weekly : 0;
      const saved = weekValue - weekly;
      const projectedWeek = weekValue / weekFraction;
      const projectedMonth = projectedWeek * WEEKS_PER_MONTH;
      const projectedMult = plan.monthly > 0 ? projectedMonth / plan.monthly : 0;

      document.getElementById('cw-mult').textContent = mult.toFixed(1) + '×';
      document.getElementById('cw-weeklysub-inline').textContent = fmtUsd(weekly);
      document.getElementById('cw-weeklysub').textContent = fmtUsd(weekly);

      const savedEl = document.getElementById('cw-saved');
      savedEl.innerHTML = saved >= 0
        ? '<strong>' + fmtUsd(saved) + ' saved</strong>'
        : '<strong class="bad">' + fmtUsd(-saved) + ' behind</strong>';

      const vsBe = document.getElementById('cw-vs-be');
      vsBe.textContent = mult >= 1
        ? mult.toFixed(1) + '× over'
        : fmtPct(Math.min(1, weekValue / weekly)) + ' of break-even';

      const verdict = document.getElementById('cw-verdict');
      verdict.classList.remove('good', 'meh', 'bad');
      verdict.classList.add(mult >= 2 ? 'good' : mult >= 1 ? 'meh' : 'bad');
      verdict.innerHTML = mult >= 1
        ? 'On pace for <strong>' + fmtUsd(projectedMonth) + '</strong> API value this month vs <strong>' + fmtUsd(plan.monthly) + '</strong> paid (' + projectedMult.toFixed(1) + '×).'
        : "You're under break-even this week. Need " + fmtUsd(weekly - weekValue) + ' more API value to pay for the sub.';

      // Break-even bar: width and color class
      const barWrap = document.getElementById('cw-be-bar-wrap');
      const frac = Math.min(1, Math.max(0, weekValue / weekly));
      // invert=true: high is good (green at top)
      const cls = frac >= 1.0 ? 'bar-ok' : frac >= 0.5 ? 'bar-warn' : 'bar-danger';
      barWrap.innerHTML = '<span class="bar ' + cls + '"><span class="bar-fill" style="width:' + (frac * 100).toFixed(1) + '%"></span></span>';

      // Footer plan label
      const footerPlan = document.getElementById('cw-plan-footer');
      if (footerPlan) footerPlan.textContent = planKey;

      // Page title
      document.title = 'claudeworth · ' + plan.label;
    }

    const sel = document.getElementById('cw-plan-select');
    if (sel) sel.addEventListener('change', () => recompute(sel.value));
  })();
</script>

<h2>By model family · this week</h2>
<div class="card">
  <table>
    <thead><tr>
      <th>Model</th>
      <th class="num">API cost</th>
      <th class="num">Calls</th>
      <th class="num">Input</th>
      <th class="num">Output</th>
      <th class="num">Cache write</th>
      <th class="num">Cache read</th>
      <th class="num">Cache hit</th>
    </tr></thead>
    <tbody>${familyRows || '<tr><td colspan="8" class="subtle">No model usage this week.</td></tr>'}</tbody>
  </table>
</div>

<h2>All time</h2>
<div class="card">
  <div class="row"><span class="label">First message</span><strong>${allTime.firstTs ? fmtDateTime(allTime.firstTs) : '—'}</strong></div>
  <div class="row"><span class="label">Latest message</span><strong>${allTime.lastTs ? fmtDateTime(allTime.lastTs) : '—'}</strong></div>
  <div class="row"><span class="label">Current streak</span><strong>${agg.streak} ${agg.streak === 1 ? 'day' : 'days'}${agg.streak >= 7 ? ' 🔥' : ''}</strong></div>
  <div class="row"><span class="label">Total messages</span><strong>${fmtInt(allTime.calls)}</strong></div>
  <div class="row"><span class="label">Total API value</span><strong>${fmtUsd(allTime.cost)}</strong></div>
  ${agg.topCall ? `
    <div class="row" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border);">
      <span class="label">Most expensive single call</span>
      <strong>${fmtUsd(agg.topCall.cost)} · ${escapeHtml(agg.topCall.family)} · ${fmtDateTime(agg.topCall.date)}</strong>
    </div>` : ''}
</div>

<details>
<summary>Methodology and pricing reference</summary>
<div class="card" style="margin-top: 8px;">
  <p><strong>Where the numbers come from.</strong> claudeworth reads <code>~/.claude/projects/*/&lt;session&gt;.jsonl</code> — Claude Code's local session log. Every assistant message records a <code>usage</code> block with input, output, cache-read, and cache-create token counts. We multiply those by Anthropic's published API rates to get an API-equivalent cost.</p>
  <p><strong>Formula per message:</strong></p>
  <pre style="background:#21262d; padding:8px 12px; border-radius:6px; overflow-x:auto;">cost = input_tokens          × base_input_rate
     + output_tokens         × base_output_rate
     + cache_read_tokens     × base_input_rate × ${CACHE_MULTIPLIERS.read}
     + cache_5m_write_tokens × base_input_rate × ${CACHE_MULTIPLIERS.write5m}
     + cache_1h_write_tokens × base_input_rate × ${CACHE_MULTIPLIERS.write1h}</pre>
  <p><strong>Per-million-token rates used</strong> (source: <a href="https://platform.claude.com/docs/en/about-claude/pricing">platform.claude.com/docs/.../pricing</a>):</p>
  <table>
    <thead><tr><th>Model family</th><th class="num">Input</th><th class="num">Output</th><th class="num">Cache read</th><th class="num">Cache 5m write</th><th class="num">Cache 1h write</th></tr></thead>
    <tbody>${priceRows}</tbody>
  </table>
  <p class="subtle" style="margin-top:12px;">Notes:</p>
  <ul class="subtle">
    <li>If the schema lacks a 5m/1h breakdown on cache_creation, all cache-create tokens are treated as 5m writes (the default, slightly under-counts 1h).</li>
    <li>"vs break-even" is API-equivalent value ÷ (monthly subscription ÷ 4.345 weeks).</li>
    <li>Monthly pace projects this week's value to a full week (linear), then × 4.345.</li>
    <li>Per-session caps and weekly limits aren't published as hard token quotas, so we don't show "% used" of an allowance — only API-equivalent value.</li>
    <li>Days are bucketed in your local timezone.</li>
    <li><strong>Why our numbers may run 5–10% higher than toktrack / codeburn:</strong> we price 1-hour cache writes at <strong>2.0× base input</strong> per <a href="https://platform.claude.com/docs/en/build-with-claude/prompt-caching">Anthropic's published rate</a>. Tools that source pricing from LiteLLM's main Anthropic entries fall back to the 5-minute rate (1.25×) for all cache writes, because LiteLLM doesn't publish a separate 1h rate. Claude Code uses 1h caching for sticky context (system prompts, CLAUDE.md), so this matters most on Opus-heavy sessions. If you ever switched to the API at list rates, your invoice would match these numbers, not theirs.</li>
  </ul>
  ${unknownBlock}
</div>
</details>

<footer>
  Generated ${fmtDateTime(generatedAt)} · source: <code>${escapeHtml(sourceDir)}</code> · plan: <code id="cw-plan-footer">${planKey}</code>
</footer>

</main>
</body>
</html>`;
}
