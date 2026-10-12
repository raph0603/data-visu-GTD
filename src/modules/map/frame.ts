import type { CountryYearFile } from '../../core/contracts';
import type { DataApi } from '../../core/data';
import { categoryLabel, countryName } from '../../core/labels';
import { metricDef, type DatasetMeta, type MetricDef } from '../../core/meta';
import type { PaletteApi } from '../../core/palette';
import type { AppState, YearRange } from '../../core/state';
import type { Store } from '../../core/store';
import { metricOf, readFilters, hasFilter, type CountryModel, type Filters, type Scan, type Totals, type YearTable } from './model';
import { selectedCountries, type SlotKeeper } from './selection';
import type { Tooltip } from './ui';

/**
 * A mean over a handful of incidents says little (one attack with 50 deaths gives 50 deaths per
 * incident): rankings by a mean metric keep the countries with at least this many incidents.
 */
export const MIN_INCIDENTS_FOR_MEAN = 10;

/** What never changes once the data is loaded. */
export interface Env {
  readonly store: Store<AppState>;
  readonly dataset: DatasetMeta;
  readonly palette: PaletteApi;
  readonly data: DataApi;
  readonly model: CountryModel;
  readonly countries: CountryYearFile;
  /** ISO alpha-3 codes drawn on the map, sorted. */
  readonly drawable: readonly string[];
  readonly tooltip: Tooltip;
  name(iso3: string): string;
  region(iso3: string): string;
}

export interface Ranking {
  /** Countries with a value above zero, most affected first. */
  readonly ordered: readonly string[];
  /** Competition rank ("1224"). */
  readonly rank: ReadonlyMap<string, number>;
}

/** Everything derived from one state, shared by the panels of one render. */
export interface Frame {
  readonly state: AppState;
  readonly metric: MetricDef;
  readonly filters: Filters;
  readonly filtered: boolean;
  readonly table: YearTable;
  readonly selected: readonly string[];
  readonly selectedIdx: readonly number[];
  /** Identity colour of each selected country. */
  readonly colors: ReadonlyMap<string, string>;
  /** Metric value of every drawable country over the window (NaN = no data). */
  readonly values: ReadonlyMap<string, number>;
  readonly ranking: Ranking;
  readonly scan: Scan;
  /** Totals of the selection (or the world) over the window and, when on, the comparison period. */
  readonly totals: Totals;
  readonly compareTotals: Totals | null;
  readonly covered: boolean;
}

export function createEnv(base: Omit<Env, 'name' | 'region' | 'drawable'>): Env {
  const drawable = Object.keys(base.countries.entities).sort();
  const names = new Map(drawable.map((iso3) => [iso3, countryName(iso3, base.countries.entities[iso3]?.label ?? iso3)]));
  return {
    ...base,
    drawable,
    name: (iso3) => names.get(iso3) ?? iso3,
    region: (iso3) => {
      const region = base.countries.entities[iso3]?.region;
      return region == null ? '' : categoryLabel('region', region);
    },
  };
}

export function buildFrame(env: Env, state: AppState, slots: SlotKeeper): Frame {
  const { model, palette } = env;
  const metric = metricDef(env.dataset, state.metric);
  const filters = readFilters(state.filters);
  const table = model.table(filters);
  const selected = selectedCountries(state).filter((iso3) => model.countryOf(iso3) >= 0 || env.countries.entities[iso3] !== undefined);
  const selectedIdx = selected.map((iso3) => model.countryOf(iso3)).filter((i) => i >= 0);
  const slotOf = slots.assign(selected);
  const colors = new Map(selected.map((iso3) => [iso3, palette.categorical[(slotOf.get(iso3) ?? 0) % palette.categorical.length] ?? '#555']));
  const covered = model.coveredYears(state.range) > 0;

  const values = new Map<string, number>();
  const incidents = new Map<string, number>();
  for (const iso3 of env.drawable) {
    const c = model.countryOf(iso3);
    const totals = c < 0 ? emptyCountry() : model.totals(table, [c], state.range);
    values.set(iso3, metricOf(totals, metric, covered));
    incidents.set(iso3, totals.incidents);
  }
  const ranking = rank(values, incidents, metric);
  const scan = model.scan(filters, state.range, selectedIdx);
  const scope = selectedIdx.length > 0 ? selectedIdx : null;
  return {
    state,
    metric,
    filters,
    filtered: hasFilter(filters),
    table,
    selected,
    selectedIdx,
    colors,
    values,
    ranking,
    scan,
    totals: model.totals(table, scope, state.range),
    compareTotals: state.compare === null ? null : model.totals(table, scope, state.compare),
    covered,
  };
}

function emptyCountry(): Totals {
  return { incidents: 0, killedSum: 0, killedKnown: 0, woundedSum: 0, woundedKnown: 0 };
}

export function rank(values: ReadonlyMap<string, number>, incidents: ReadonlyMap<string, number>, metric: MetricDef): Ranking {
  const eligible = [...values].filter(
    ([iso3, v]) => v > 0 && (metric.kind !== 'mean' || (incidents.get(iso3) ?? 0) >= MIN_INCIDENTS_FOR_MEAN),
  );
  eligible.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const rankMap = new Map<string, number>();
  eligible.forEach(([iso3, v], i) => {
    const previous = eligible[i - 1];
    rankMap.set(iso3, previous !== undefined && previous[1] === v ? (rankMap.get(previous[0]) ?? i + 1) : i + 1);
  });
  return { ordered: eligible.map(([iso3]) => iso3), rank: rankMap };
}

/** Value of the metric for some countries over another window (comparison period, race frames). */
export function valueOver(env: Env, frame: Frame, countries: readonly number[] | null, range: YearRange): number {
  return metricOf(env.model.totals(frame.table, countries, range), frame.metric, env.model.coveredYears(range) > 0);
}

/** Weight of a flow or a category for the metric: incidents, or known casualties for casualty metrics. */
export function weightOf(totals: Totals, metric: MetricDef): number {
  if (metric.kind === 'count') return totals.incidents;
  const sum = metric.kind === 'mean' ? metric.of : metric.id;
  return sum === 'killed' ? totals.killedSum : totals.woundedSum;
}

/** "incidents" or the casualty unit that weights flows and shares. */
export function weightUnit(metric: MetricDef): string {
  if (metric.kind === 'count') return 'incidents';
  return (metric.kind === 'mean' ? metric.of : metric.id) === 'killed' ? 'morts' : 'blessés';
}
