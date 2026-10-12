import { metricValue, type MetricDef } from '../../core/meta';
import type { YearlyIndex } from '../../core/series';
import type { YearRange } from '../../core/state';

/**
 * A mean over a handful of incidents says little (one attack with 50 deaths gives 50 deaths per
 * incident): the ranking by a mean metric keeps countries with at least this many incidents.
 * The map still colours every country.
 */
export const MIN_INCIDENTS_FOR_MEAN = 10;

export interface Ranking {
  /** Countries with a value above zero, most affected first. */
  readonly ordered: readonly string[];
  /** Competition rank ("1224") of every country of `ordered`. */
  readonly rank: ReadonlyMap<string, number>;
  readonly value: ReadonlyMap<string, number>;
}

/** Ranks the countries on one metric over one window (T1); ties share a rank. */
export function rankCountries(index: YearlyIndex, metric: MetricDef, range: YearRange): Ranking {
  const value = new Map<string, number>();
  for (const key of index.keys) {
    const v = metricValue(index, metric, key, range.from, range.to);
    if (!(v > 0)) continue; // NaN and measured zeros are not ranked
    if (metric.kind === 'mean' && index.window(key, 'incidents', range.from, range.to) < MIN_INCIDENTS_FOR_MEAN) continue;
    value.set(key, v);
  }
  const ordered = [...value.keys()].sort((a, b) => (value.get(b) ?? 0) - (value.get(a) ?? 0) || (a < b ? -1 : 1));
  const rank = new Map<string, number>();
  ordered.forEach((key, i) => {
    const previous = ordered[i - 1];
    rank.set(key, previous !== undefined && value.get(previous) === value.get(key) ? (rank.get(previous) ?? i + 1) : i + 1);
  });
  return { ordered, rank, value };
}
