// Small numeric helpers for the scoring code. Pitch distances are in log-frequency.

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/** Linear-interpolated percentile, `p` in 0..100. 0 for an empty list. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = clamp01(p / 100) * (sorted.length - 1);
  const low = Math.floor(position);
  const high = Math.ceil(position);
  const lowValue = sorted[low] ?? 0;
  const highValue = sorted[high] ?? lowValue;
  return lowValue + (highValue - lowValue) * (position - low);
}

/** p90 - p10 of a normal distribution is this many standard deviations. */
const P10_TO_P90_IN_SD = 2.563;

/** Standard deviation estimated from the middle 80%, so a few glitches cannot inflate it. */
export function robustStandardDeviation(values: readonly number[]): number {
  return (percentile(values, 90) - percentile(values, 10)) / P10_TO_P90_IN_SD;
}

export function median(values: readonly number[]): number {
  return percentile(values, 50);
}

export function semitonesBetween(fromHz: number, toHz: number): number {
  return 12 * Math.log2(toHz / fromHz);
}

/** 0 at or below `from`, 1 at or above `to`, linear in between. */
export function rampUp(value: number, from: number, to: number): number {
  return clamp01((value - from) / (to - from));
}

/** 1 at or below `full`, 0 at or above `zero`, linear in between. */
export function rampDown(value: number, full: number, zero: number): number {
  return 1 - rampUp(value, full, zero);
}
