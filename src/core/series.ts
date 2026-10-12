import type { DatasetMeta, MetricDef, YearlyEntitySeries } from './contracts';
import { DatasetError } from './meta';
import { clampRange, type YearRange } from './state';

/**
 * Per-entity prefix sums over the year axis: any window sum is two array reads, so a slider tick costs
 * O(E) (one read pair per entity) instead of O(rows) = O(181 700). Valid for additive series only;
 * means are the ratio of two window sums, never an average of yearly averages.
 *
 * Value semantics (the "zero vs no data" rule shared by all views):
 *   NaN = no data (range entirely inside collection gaps, or incidents exist but the value is never known,
 *         or a mean over zero known values)
 *   0   = measured zero (no incident in a covered period)
 */
export class YearlyIndex {
  readonly dim: string;
  readonly firstYear: number;
  readonly lastYear: number;
  readonly ids: readonly string[];
  readonly labels: readonly string[];
  readonly parents: readonly (string | null)[];

  private readonly width: number;
  private readonly count: Float64Array;
  private readonly sums = new Map<string, Float64Array>();
  private readonly knowns = new Map<string, Float64Array>();
  private readonly gapPrefix: Int32Array;
  private readonly position = new Map<string, number>();
  private readonly metrics = new Map<string, MetricDef>();

  constructor(file: YearlyEntitySeries, meta: DatasetMeta) {
    if (file.firstYear !== meta.years.first || file.lastYear !== meta.years.last) {
      throw new DatasetError(`agg/${file.dim}_year`, `axe temporel [${file.firstYear}, ${file.lastYear}] différent de meta [${meta.years.first}, ${meta.years.last}]`);
    }
    this.dim = file.dim;
    this.firstYear = file.firstYear;
    this.lastYear = file.lastYear;
    const n = file.lastYear - file.firstYear + 1;
    this.width = n + 1;
    const entities = file.entities;
    this.ids = entities.map((e) => e.id);
    this.labels = entities.map((e) => e.label);
    this.parents = entities.map((e) => e.parent);
    this.ids.forEach((id, i) => this.position.set(id, i));
    for (const m of meta.metrics) this.metrics.set(m.id, m);

    const countMetric = meta.metrics.find((m) => m.kind === 'count');
    if (countMetric === undefined) throw new DatasetError('meta.metrics', 'métrique count absente');
    this.count = this.prefix(entities.map((e) => e.sum[countMetric.id]), n, `${file.dim}.sum.${countMetric.id}`, entities.map((e) => e.id));

    for (const m of meta.metrics) {
      if (m.kind !== 'sum') continue;
      this.sums.set(m.id, this.prefix(entities.map((e) => e.sum[m.id]), n, `${file.dim}.sum.${m.id}`, this.ids));
      this.knowns.set(m.id, this.prefix(entities.map((e) => e.known[m.id]), n, `${file.dim}.known.${m.id}`, this.ids));
    }

    this.gapPrefix = new Int32Array(n + 1);
    const gaps = new Set(meta.years.gaps);
    for (let i = 0; i < n; i++) this.gapPrefix[i + 1] = (this.gapPrefix[i] ?? 0) + (gaps.has(file.firstYear + i) ? 1 : 0);
  }

  private prefix(series: readonly (readonly number[] | undefined)[], n: number, label: string, ids: readonly string[]): Float64Array {
    const out = new Float64Array(series.length * this.width);
    series.forEach((values, e) => {
      if (values === undefined || values.length !== n) {
        throw new DatasetError(`${label}[${ids[e] ?? e}]`, `${n} valeurs annuelles attendues, ${values === undefined ? 'série absente' : values.length} reçues`);
      }
      const base = e * this.width;
      for (let i = 0; i < n; i++) out[base + i + 1] = (out[base + i] ?? 0) + (values[i] ?? 0);
    });
    return out;
  }

  get size(): number {
    return this.ids.length;
  }

  indexOf(id: string): number {
    return this.position.get(id) ?? -1;
  }

  /** Fraction (0..1) of the years in `range` that are collection gaps. */
  gapFraction(range: YearRange): number {
    const r = clampRange(range, this.firstYear, this.lastYear);
    const i0 = r.from - this.firstYear;
    const i1 = r.to - this.firstYear;
    return ((this.gapPrefix[i1 + 1] ?? 0) - (this.gapPrefix[i0] ?? 0)) / (i1 - i0 + 1);
  }

  private window(table: Float64Array, e: number, i0: number, i1: number): number {
    const base = e * this.width;
    return (table[base + i1 + 1] ?? 0) - (table[base + i0] ?? 0);
  }

  /** Value of one metric for one entity over a year range. See the class comment for NaN vs 0. */
  value(entity: number, metricId: string, range: YearRange): number {
    const def = this.metrics.get(metricId);
    if (def === undefined) throw new Error(`métrique inconnue: ${metricId}`);
    const r = clampRange(range, this.firstYear, this.lastYear);
    if (this.gapFraction(r) === 1) return NaN;
    const i0 = r.from - this.firstYear;
    const i1 = r.to - this.firstYear;

    if (def.kind === 'count') return this.window(this.count, entity, i0, i1);

    const total = this.window(this.count, entity, i0, i1);
    const sourceId = def.kind === 'mean' ? def.of : def.id;
    const known = this.window(this.table(this.knowns, sourceId), entity, i0, i1);
    const sum = this.window(this.table(this.sums, sourceId), entity, i0, i1);
    if (def.kind === 'sum') {
      if (total === 0) return 0;
      return known === 0 ? NaN : sum;
    }
    return known === 0 ? NaN : sum / known;
  }

  /** Share (0..1) of incidents with a known value for a sum metric; NaN when there is no incident. */
  knownShare(entity: number, metricId: string, range: YearRange): number {
    const def = this.metrics.get(metricId);
    const sourceId = def?.kind === 'mean' ? def.of : metricId;
    const r = clampRange(range, this.firstYear, this.lastYear);
    const i0 = r.from - this.firstYear;
    const i1 = r.to - this.firstYear;
    const total = this.window(this.count, entity, i0, i1);
    if (total === 0) return NaN;
    if (def?.kind === 'count') return 1;
    return this.window(this.table(this.knowns, sourceId), entity, i0, i1) / total;
  }

  /** Values of every entity, aligned with `ids`. One pass, no allocation besides the result. */
  values(metricId: string, range: YearRange): Float64Array {
    const out = new Float64Array(this.size);
    for (let e = 0; e < out.length; e++) out[e] = this.value(e, metricId, range);
    return out;
  }

  private table(tables: Map<string, Float64Array>, id: string): Float64Array {
    const t = tables.get(id);
    if (t === undefined) throw new Error(`métrique "${id}" absente des séries`);
    return t;
  }
}
