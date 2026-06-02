// API list prices in USD per 1,000,000 tokens.
// Source: Anthropic public pricing page (claude.com/pricing) and LiteLLM model_prices.
// 1h cache writes cost 2x base input; 5m cache writes cost 1.25x base input;
// cache reads cost 0.1x base input.
//
// If the schema sees an unknown model, we fall back to Sonnet pricing and flag it.

const PER_M = 1_000_000;

// Source: https://platform.claude.com/docs/en/about-claude/pricing (verified May 2026).
// IMPORTANT ordering: more specific regexes must come first because we return on first match.
// Opus dropped 67% with the 4.5 generation ($15/$75 → $5/$25); 4.1 and below kept the old rate.
//
// Real model ids come in two shapes the regexes must both handle:
//   versioned: claude-opus-4-5, claude-sonnet-4-6, claude-haiku-4-5-20251001
//   dated/old: claude-opus-4-20250514 (Opus 4.0), claude-3-5-haiku-20241022 (number BEFORE name)
// The new-Opus rule matches minor versions 5..9 (and two-digit minors like 4.10) but must NOT be
// fooled by an 8-digit date suffix — hence the (?!\d) guard, so "4-20250514" is read as Opus 4.0,
// not 4.5. Pre-4.5 ids put the version before the family name (claude-3-5-haiku), so those rules
// carry a reversed-order alternative.
const MODELS = [
  // Opus — new pricing (4.5 and later)
  { match: /opus[-.]?4[-.](?:[5-9]|\d\d)(?!\d)/i, family: 'opus-4.5+',  input: 5,  output: 25 },
  // Opus — legacy pricing (4.1, and bare/dated 4.0)
  { match: /opus[-.]?4[-.]1/i,                     family: 'opus-4.1',  input: 15, output: 75 },
  { match: /opus[-.]?4/i,                          family: 'opus-4',    input: 15, output: 75 },
  { match: /(?:opus[-.]?3|3[-.]opus)/i,            family: 'opus-3',    input: 15, output: 75 },
  { match: /opus/i,                                family: 'opus',      input: 5,  output: 25 },
  // Sonnet — $3/$15 across the 4.x and 3.x line
  { match: /sonnet[-.]?4/i,                              family: 'sonnet-4',   input: 3, output: 15 },
  { match: /(?:sonnet[-.]?3[-.]?7|3[-.]7[-.]sonnet)/i,  family: 'sonnet-3.7', input: 3, output: 15 },
  { match: /(?:sonnet[-.]?3[-.]?5|3[-.]5[-.]sonnet)/i,  family: 'sonnet-3.5', input: 3, output: 15 },
  { match: /sonnet/i,                                    family: 'sonnet',     input: 3, output: 15 },
  // Haiku
  { match: /haiku[-.]?4/i,                               family: 'haiku-4.5', input: 1,    output: 5  },
  { match: /(?:haiku[-.]?3[-.]?5|3[-.]5[-.]haiku)/i,     family: 'haiku-3.5', input: 0.8,  output: 4  },
  { match: /haiku/i,                                     family: 'haiku',     input: 0.25, output: 1.25 },
];

const FALLBACK = { family: 'unknown', input: 3, output: 15 };

// Cache pricing multipliers, applied to the base input rate.
// Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
export const CACHE_MULTIPLIERS = {
  read:    0.1,   // cache hit
  write5m: 1.25,  // 5-minute TTL write
  write1h: 2.0,   // 1-hour TTL write
};

export function modelInfo(model) {
  if (!model) return { ...FALLBACK, unknown: true };
  for (const m of MODELS) {
    if (m.match.test(model)) return m;
  }
  return { ...FALLBACK, unknown: true };
}

// Returns USD cost for a single usage event.
export function priceEvent(ev) {
  const info = modelInfo(ev.model);
  const inputRate  = info.input  / PER_M;
  const outputRate = info.output / PER_M;
  const cacheRead  = inputRate * CACHE_MULTIPLIERS.read;
  const cache5m    = inputRate * CACHE_MULTIPLIERS.write5m;
  const cache1h    = inputRate * CACHE_MULTIPLIERS.write1h;

  // If we don't have the cache_creation breakdown, treat all cache writes as 5m
  // (the default tier). Slightly under-counts 1h writes but is close.
  let create5m = ev.cacheCreate5m;
  let create1h = ev.cacheCreate1h;
  if (!create5m && !create1h && ev.cacheCreateTotal) {
    create5m = ev.cacheCreateTotal;
  }

  return (
    ev.input      * inputRate  +
    ev.output     * outputRate +
    ev.cacheRead  * cacheRead  +
    create5m      * cache5m    +
    create1h      * cache1h
  );
}

export function familyOf(model) {
  return modelInfo(model).family;
}

// For the methodology table.
export function pricingTable() {
  // Distinct families (skip the bare 'opus'/'sonnet'/'haiku' fallbacks)
  return MODELS
    .filter(m => /[-.\d]/.test(m.family))
    .map(m => ({
      family: m.family,
      input: m.input,
      output: m.output,
      cacheRead: +(m.input * CACHE_MULTIPLIERS.read).toFixed(2),
      cache5m:   +(m.input * CACHE_MULTIPLIERS.write5m).toFixed(2),
      cache1h:   +(m.input * CACHE_MULTIPLIERS.write1h).toFixed(2),
    }));
}
