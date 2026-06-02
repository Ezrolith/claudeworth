// Subscription plan reference. Only `label` and `monthly` are used: the dashboard deliberately
// shows API-equivalent value rather than a "% of allowance" gauge, because Anthropic doesn't
// publish hard token quotas for the subscription tiers (see README "How the value calculation works").

export const PLANS = {
  pro:   { label: 'Claude Pro',    monthly: 20  },
  max5:  { label: 'Claude Max 5x', monthly: 100 },
  max20: { label: 'Claude Max 20x', monthly: 200 },
};

export function planFromKey(key) {
  return PLANS[key] || PLANS.max5;
}

export function weeklyCost(plan) {
  // Use 4.345 weeks/month (365.25 / 7 / 12) for the most honest prorate.
  return plan.monthly / 4.345;
}
