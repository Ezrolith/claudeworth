# claudeworth

> Is your Claude subscription actually worth it? `claudeworth` compares your real Claude Code usage against pay-as-you-go API rates and tells you the effective discount you're getting.

```
$ npx claudeworth
```

That's it. It reads `~/.claude/projects/` locally, prices every message at Anthropic's published API rates, and opens a browser dashboard.

## What it shows

- **Effective multiplier** — your API-equivalent value ÷ your prorated subscription cost (e.g. "7.4× this week").
- **Cache savings** — what your usage would have cost without prompt caching. Often the largest number on the page.
- **Last 5 hours** — proxy for Claude Code's per-session cap.
- **This week** — value vs. break-even, with a monthly pace projection.
- **By project** — which repos are eating your subscription.
- **By model** — Opus vs Sonnet vs Haiku split, with per-model cache hit rate and savings.
- **Top sessions** — your most expensive sessions, with the model mix that drove the cost.
- **Heatmap** — day-of-week × hour-of-day, toggleable between cost and call count. Find your peak hours.
- **All-time stats** — lifetime totals, current streak, most expensive single call.
- **Methodology** — the exact formula, the pricing table, and a list of any model strings that didn't match (collapsible).

## Why another one?

There are already two tools in this space: [codeburn](https://www.npmjs.com/package/codeburn) and [toktrack](https://www.npmjs.com/package/toktrack). Both are good at "here's what your usage cost." Neither answers the question subscribers actually have: **am I getting my money's worth, or should I switch to API billing?**

`claudeworth` is built around that one question. Everything on the dashboard ties back to it.

It also fixes one small but expensive bug both other tools appear to share: Opus 4.5/4.6/4.7 quietly dropped from $15/$75 per MTok to $5/$25 per MTok in late 2025. Tools that hardcoded the old rates over-report cost by ~3× on Opus-heavy users.

## Privacy

**Nothing leaves your machine.** No network calls. No telemetry. No accounts. No "sync to cloud."

Your Claude Code session files contain every prompt and response you've ever sent. A tool that ships them anywhere is a privacy disaster. `claudeworth` reads them, computes locally, writes an HTML file, opens your browser. That's the entire data flow.

You can verify this by reading the source — it's small (~6 files, ~700 lines of vanilla JS, no dependencies).

## Usage

```bash
# Open the dashboard (defaults to Max 5x; switch plans with the dropdown in the page)
npx claudeworth

# Set the initial plan via CLI (you can still change it in the dropdown)
npx claudeworth --plan pro     # Claude Pro    ($20/mo)
npx claudeworth --plan max5    # Claude Max 5x ($100/mo)  [default]
npx claudeworth --plan max20   # Claude Max 20x ($200/mo)

# Just write the HTML, don't open the browser
npx claudeworth --no-open --out ./dashboard.html
```

The plan dropdown at the top of the page lets you compare what your same usage would be worth on each tier — useful for deciding whether to upgrade, downgrade, or stay put.

## Requirements

- Node.js ≥ 18
- Claude Code installed and used at least once on this machine (so `~/.claude/projects/` exists)

## How the value calculation works

For every assistant message in your session logs, `claudeworth` reads the `usage` block and applies Anthropic's published rates:

```
cost = input_tokens          × base_input_rate
     + output_tokens         × base_output_rate
     + cache_read_tokens     × base_input_rate × 0.1
     + cache_5m_write_tokens × base_input_rate × 1.25
     + cache_1h_write_tokens × base_input_rate × 2.0
```

Cache multipliers and per-model rates: see [Anthropic's pricing docs](https://platform.claude.com/docs/en/about-claude/pricing).

Sum it all up, divide by your prorated weekly subscription cost ($23.01/wk for Max 5x), and you have your effective multiplier.

There is no "% of allowance" gauge because Anthropic doesn't publish hard token quotas for the subscription tiers — the limits are described in fuzzy terms ("~225 Sonnet msgs per 5h" for Pro, multiples for Max). `claudeworth` deliberately doesn't fabricate a percentage; it just shows API-equivalent value.

## Known limitations

- **Heuristic 5m/1h cache split**: when a message's `cache_creation` block lacks the 5m/1h breakdown, all cache-create tokens are treated as 5m writes (the default). Slightly under-counts 1h-cache-heavy workloads.
- **Local timezone**: days are bucketed in your machine's local timezone. If you work across timezones, the daily/heatmap views may look off.
- **Session cap is a rolling 5h window**, not a true Claude Code session anchored at the first message after a 5h gap. Close approximation, not exact.
- **Subscription tier limits aren't enforced** — see methodology above.

## Contributing / reporting issues

Open an issue or PR on the repo. Particularly useful: model strings that show up under "unknown" in the methodology section.

## License

MIT
