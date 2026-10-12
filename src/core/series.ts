import type { CasualtyMetric, MetricId, YearValues, YearlyFile } from "./contracts";

type Prefix = Float64Array;
type EntityPrefixes = {
  incidents: Prefix;
  killed: { sum: Prefix; known: Prefix };
  wounded: { sum: Prefix; known: Prefix };
};

/** prefix[i] = sum of values[0..i-1]; null (year without data) counts as 0. */
function prefixSums(values: YearValues): Prefix {
  const prefix = new Float64Array(values.length + 1);
  values.forEach((value, i) => {
    prefix[i + 1] = (prefix[i] ?? 0) + (value ?? 0);
  });
  return prefix;
}

/** Sum of values[a..b-1], read from their prefix sums. */
const between = (prefix: Prefix, a: number, b: number): number => (prefix[b] ?? 0) - (prefix[a] ?? 0);

/**
 * Answers "value of an entity for a metric over a window of years" in O(1),
 * from prefix sums built once in O(entities x years).
 *
 * Returned values follow the data contract (docs/map-decisions.md):
 * - NaN: no data. The window holds only years without rows, lies outside the
 *   covered years, names an unknown entity, or has incidents whose casualty
 *   value is never known;
 * - 0: measured zero (no incident, or known casualties summing to 0);
 * - otherwise the sum. For casualties it is the sum of the known values;
 *   knownShare() tells how many incidents it covers.
 */
export class YearlyIndex {
  readonly first: number;
  readonly last: number;
  readonly gaps: readonly number[];
  readonly keys: readonly string[];
  private readonly gapPrefix: Prefix;
  private readonly prefixes = new Map<string, EntityPrefixes>();

  constructor(file: YearlyFile) {
    this.first = file.years.first;
    this.last = file.years.last;
    this.keys = Object.keys(file.entities).sort();

    // The contract puts null on the same years in every series.
    const reference = Object.values(file.entities)[0]?.incidents ?? [];
    this.gaps = reference.flatMap((value, i) => (value === null ? [this.first + i] : []));
    this.gapPrefix = prefixSums(reference.map((value) => (value === null ? 1 : 0)));

    for (const [key, entity] of Object.entries(file.entities)) {
      this.prefixes.set(key, {
        incidents: prefixSums(entity.incidents),
        killed: { sum: prefixSums(entity.killed.sum), known: prefixSums(entity.killed.known) },
        wounded: { sum: prefixSums(entity.wounded.sum), known: prefixSums(entity.wounded.known) },
      });
    }
  }

  isGap(year: number): boolean {
    return this.gaps.includes(year);
  }

  value(key: string, metric: MetricId, year: number): number {
    return this.window(key, metric, year, year);
  }

  window(key: string, metric: MetricId, from: number, to: number): number {
    const span = this.span(key, from, to);
    if (span === undefined) return Number.NaN;
    const { prefix, a, b } = span;
    const incidents = between(prefix.incidents, a, b);
    if (metric === "incidents") return incidents;
    if (incidents === 0) return 0;
    const series = prefix[metric as CasualtyMetric];
    const known = between(series.known, a, b);
    return known === 0 ? Number.NaN : between(series.sum, a, b);
  }

  /**
   * Mean of a casualty metric over the window's incidents whose value is known:
   * sum of the known values / number of known values, never a mean of yearly
   * means. NaN without data or when no value is known.
   */
  mean(key: string, metric: CasualtyMetric, from: number, to: number): number {
    const span = this.span(key, from, to);
    if (span === undefined) return Number.NaN;
    const { prefix, a, b } = span;
    const series = prefix[metric];
    const known = between(series.known, a, b);
    return known === 0 ? Number.NaN : between(series.sum, a, b) / known;
  }

  /** Share of the window's incidents whose value of metric is known; NaN without incident. */
  knownShare(key: string, metric: MetricId, from: number, to: number): number {
    const span = this.span(key, from, to);
    if (span === undefined) return Number.NaN;
    const { prefix, a, b } = span;
    const incidents = between(prefix.incidents, a, b);
    if (incidents === 0) return Number.NaN;
    if (metric === "incidents") return 1;
    const series = prefix[metric as CasualtyMetric];
    return between(series.known, a, b) / incidents;
  }

  /** Prefix bounds of the window clipped to the covered years, or undefined without data. */
  private span(key: string, from: number, to: number) {
    if (from > to) throw new RangeError(`Invalid window ${from}-${to}: start after end.`);
    const a = Math.max(from, this.first) - this.first;
    const b = Math.min(to, this.last) - this.first + 1;
    if (a >= b) return undefined;
    const yearsWithData = b - a - between(this.gapPrefix, a, b);
    const prefix = this.prefixes.get(key);
    if (yearsWithData === 0 || prefix === undefined) return undefined;
    return { prefix, a, b };
  }
}
