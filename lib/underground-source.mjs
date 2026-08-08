export function clampUndergroundSourceRate(rate, maximum = 120) {
  if (!Number.isFinite(rate)) return 0;
  return Math.max(0, Math.min(maximum, rate));
}

export function advanceUndergroundSourceCredit(currentCredit, ratePerMinute, ticksPerSecond, maximum = 120) {
  const rate = clampUndergroundSourceRate(ratePerMinute, maximum);
  if (rate === 0 || ticksPerSecond <= 0) return 0;
  return Math.min(1, Math.max(0, currentCredit)) + rate / 60 / ticksPerSecond;
}
