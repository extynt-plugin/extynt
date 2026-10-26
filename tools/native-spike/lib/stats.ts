/** Latency statistics over lists of samples. */

/** The summary of a sample list; every figure is null when no sample was a finite number. */
export interface Summary {
  readonly n: number;
  readonly min: number | null;
  readonly max: number | null;
  readonly mean: number | null;
  readonly p50: number | null;
  readonly p95: number | null;
}

/** Nearest-rank percentile of a numeric list; p in (0, 100]. Returns null for an empty list. */
export function percentile(values: ReadonlyArray<number>, p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? null;
}

function isFiniteSample(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Count, extremes, mean, median and 95th percentile of the finite samples; absent samples are ignored. */
export function summarize(values: ReadonlyArray<number | null | undefined>): Summary {
  const clean = values.filter(isFiniteSample);
  if (!clean.length) return { n: 0, min: null, max: null, mean: null, p50: null, p95: null };
  const sum = clean.reduce((total, value) => total + value, 0);
  return {
    n: clean.length,
    min: Math.min(...clean),
    max: Math.max(...clean),
    mean: sum / clean.length,
    p50: percentile(clean, 50),
    p95: percentile(clean, 95),
  };
}

/** Milliseconds between two hrtime readings; the end defaults to now. */
export function hrMs(start: bigint, end: bigint = process.hrtime.bigint()): number {
  return Number(end - start) / 1e6;
}
