import { METRICS, type CasualtyMetric, type Meta, type MetricId } from './contracts';
import type { YearlyIndex } from './series';

/**
 * What the views know about the loaded dataset: meta.json as validated by `parseMeta` (contracts.ts),
 * plus the labels the views display. The file formats live in contracts.ts; this file only adds the
 * vocabulary of the interface (metric and dimension names), so that no view hard-codes it.
 */

/**
 * count: number of incidents, always known. sum: casualties, with a share of known values.
 * mean: casualties per incident whose value is known (YearlyIndex.mean).
 */
export type MetricDef =
  | { readonly id: MetricId; readonly label: string; readonly unit: string; readonly kind: 'count' | 'sum' }
  | { readonly id: 'lethality'; readonly label: string; readonly unit: string; readonly kind: 'mean'; readonly of: CasualtyMetric };

export interface DimensionDef {
  /** Key used in AppState (focus, pinned, filters) and in the URL. */
  readonly id: string;
  readonly label: string;
}

export type DatasetMeta = Meta & {
  readonly metrics: readonly MetricDef[];
  readonly dimensions: readonly DimensionDef[];
};

const METRIC_LABELS: Readonly<Record<MetricId, { label: string; unit: string; kind: 'count' | 'sum' }>> = {
  incidents: { label: 'Incidents', unit: 'incidents', kind: 'count' },
  killed: { label: 'Morts', unit: 'morts', kind: 'sum' },
  wounded: { label: 'Blessés', unit: 'blessés', kind: 'sum' },
};

const LETHALITY: MetricDef = { id: 'lethality', label: 'Morts par incident', unit: 'morts par incident', kind: 'mean', of: 'killed' };

/**
 * Dimensions present in the generated files: country (ISO alpha-3 keys of agg/country_year.json),
 * region and group (keys of agg/region_year.json and agg/group_year.json), and the categorical
 * dictionaries of incidents/<iso3>.json and flow.json.
 */
export const DIMENSIONS: readonly DimensionDef[] = [
  { id: 'country', label: 'Pays' },
  { id: 'region', label: 'Région' },
  { id: 'group', label: 'Groupe' },
  { id: 'attackType', label: "Type d'attaque" },
  { id: 'targetType', label: 'Type de cible' },
  { id: 'weaponType', label: "Type d'arme" },
];

export function describeDataset(meta: Meta): DatasetMeta {
  return {
    ...meta,
    metrics: [...METRICS.map((id): MetricDef => ({ id, ...METRIC_LABELS[id] })), LETHALITY],
    dimensions: DIMENSIONS,
  };
}

/** The metric definition of an id from AppState.metric (sanitized), or the first metric. */
export function metricDef(meta: DatasetMeta, id: string): MetricDef {
  const found = meta.metrics.find((m) => m.id === id) ?? meta.metrics[0];
  if (found === undefined) throw new Error('DatasetMeta.metrics is empty');
  return found;
}

/** Value of any metric over a window: a number, 0 (measured zero) or NaN (no data). */
export function metricValue(index: YearlyIndex, metric: MetricDef, key: string, from: number, to: number): number {
  return metric.kind === 'mean' ? index.mean(key, metric.of, from, to) : index.window(key, metric.id, from, to);
}

/** Share of the window's incidents on which the metric rests (1 for counts); NaN without incident. */
export function metricKnownShare(index: YearlyIndex, metric: MetricDef, key: string, from: number, to: number): number {
  return index.knownShare(key, metric.kind === 'mean' ? metric.of : metric.id, from, to);
}
