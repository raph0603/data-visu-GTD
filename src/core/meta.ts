import { METRICS, type Meta, type MetricId } from './contracts';

/**
 * What the views know about the loaded dataset: meta.json as validated by `parseMeta` (contracts.ts),
 * plus the labels the views display. The file formats live in contracts.ts; this file only adds the
 * vocabulary of the interface (metric and dimension names), so that no view hard-codes it.
 */

export interface MetricDef {
  readonly id: MetricId;
  readonly label: string;
  readonly unit: string;
  /** count: number of incidents, always known. sum: casualties, with a share of known values. */
  readonly kind: 'count' | 'sum';
}

export interface DimensionDef {
  /** Key used in AppState (focus, pinned, filters) and in the URL. */
  readonly id: string;
  readonly label: string;
}

export type DatasetMeta = Meta & {
  readonly metrics: readonly MetricDef[];
  readonly dimensions: readonly DimensionDef[];
};

const METRIC_LABELS: Readonly<Record<MetricId, Omit<MetricDef, 'id'>>> = {
  incidents: { label: 'Incidents', unit: 'incidents', kind: 'count' },
  killed: { label: 'Morts', unit: 'morts', kind: 'sum' },
  wounded: { label: 'Blessés', unit: 'blessés', kind: 'sum' },
};

/**
 * Dimensions present in the generated files: country (ISO alpha-3 keys of agg/country_year.json),
 * region (keys of agg/region_year.json) and the three dictionaries of incidents/<iso3>.json.
 */
export const DIMENSIONS: readonly DimensionDef[] = [
  { id: 'country', label: 'Pays' },
  { id: 'region', label: 'Région' },
  { id: 'group', label: 'Groupe' },
  { id: 'attackType', label: "Type d'attaque" },
  { id: 'targetType', label: 'Type de cible' },
];

export function describeDataset(meta: Meta): DatasetMeta {
  return {
    ...meta,
    metrics: METRICS.map((id) => ({ id, ...METRIC_LABELS[id] })),
    dimensions: DIMENSIONS,
  };
}
