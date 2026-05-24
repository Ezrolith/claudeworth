// Subscription plan reference.
// `weeklyApiBreakEven` is the API spend at which the subscription pays for itself for that week.
// Allowance numbers are deliberately approximate because Anthropic doesn't publish hard token quotas.
// They're calibrated against the rough public guidance (e.g. "~225 Sonnet msgs / 5h" for Pro,
// 5x and 20x multiples of that, weekly hour caps introduced mid-2025).

export const PLANS = {
  pro: {
    label: 'Claude Pro',
    monthly: 20,
    sessionMsgsSonnet: 225,
    sessionMsgsOpus: 50,
    weeklyHoursSonnet: 80,
    weeklyHoursOpus: 0,
  },
  max5: {
    label: 'Claude Max 5x',
    monthly: 100,
    sessionMsgsSonnet: 1125,
    sessionMsgsOpus: 250,
    weeklyHoursSonnet: 280,
    weeklyHoursOpus: 35,
  },
  max20: {
    label: 'Claude Max 20x',
    monthly: 200,
    sessionMsgsSonnet: 4500,
    sessionMsgsOpus: 1000,
    weeklyHoursSonnet: 480,
    weeklyHoursOpus: 40,
  },
};

export function planFromKey(key) {
  return PLANS[key] || PLANS.max5;
}

export function weeklyCost(plan) {
  // Use 4.345 weeks/month (365.25 / 7 / 12) for the most honest prorate.
  return plan.monthly / 4.345;
}
