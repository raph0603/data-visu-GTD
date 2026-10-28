import type { CountryYearFile } from '../../core/contracts';
import type { DataApi } from '../../core/data';
import { categoryLabel, countryName } from '../../core/labels';
import { metricDef, type DatasetMeta, type MetricDef } from '../../core/meta';
import type { PaletteApi } from '../../core/palette';
import { rangeLength, type AppState, type YearRange } from '../../core/state';
import type { Store } from '../../core/store';
import { filtersKey, metricOf, readFilters, hasFilter, type CountryModel, type Filters, type Scan, type Totals, type YearTable } from './model';
import { levelOf, selectedCountries, type Level, type SlotKeeper } from './selection';
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
  /**
   * Identity colours of the selected countries: the four non-blue colours of the project palette,
   * in a fixed order (bluish green, vermillion, reddish purple, orange), because blue already
   * carries magnitude on the globe. Validated for colour-vision deficiency (D20); names always go
   * with them.
   */
  readonly identity: readonly string[];
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

export interface CountryFigures {
  readonly now: Totals;
  /** Same country over the comparison period; null without one. */
  readonly before: Totals | null;
}

/** Everything derived from one state, shared by the globe, the panel and the time bar. */
/** What the globe draws at the world level: the incidents themselves, or one colour per country. */
export type MapLayer = 'events' | 'countries';

export interface Frame {
  readonly state: AppState;
  readonly level: Level;
  readonly layer: MapLayer;
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
  /**
   * The period the changes are measured against: the one the user chose, or by default the window
   * of the same length just before (T9). Null when the window starts at the first year.
   */
  readonly compare: YearRange | null;
  readonly compareChosen: boolean;
  readonly compareRanking: Ranking | null;
  /** Top of the colour scale: the largest value over any window of the current length (play). */
  readonly domainMax: number;
  readonly scan: Scan;
  readonly world: CountryFigures;
  readonly figures: ReadonlyMap<string, CountryFigures>;
  /** One value per year of the span for the explored countries together, or the world (time bar). */
  readonly series: Float64Array;
  readonly covered: boolean;
}

export function createEnv(base: Omit<Env, 'name' | 'region' | 'drawable' | 'identity'>): Env {
  const drawable = Object.keys(base.countries.entities).sort();
  const names = new Map(drawable.map((iso3) => [iso3, countryName(iso3, base.countries.entities[iso3]?.label ?? iso3)]));
  const categorical = base.palette.categorical;
  return {
    ...base,
    drawable,
    identity: [categorical[2] ?? '#009E73', categorical[5] ?? '#D55E00', categorical[3] ?? '#CC79A7', categorical[1] ?? '#E69F00'],
    name: (iso3) => names.get(iso3) ?? iso3,
    region: (iso3) => {
      const region = base.countries.entities[iso3]?.region;
      return region == null ? '' : categoryLabel('region', region);
    },
  };
}

const domainCache = new WeakMap<YearTable, Map<string, number>>();

export function buildFrame(env: Env, state: AppState, slots: SlotKeeper): Frame {
  const { model } = env;
  const metric = metricDef(env.dataset, state.metric);
  const filters = readFilters(state.filters);
  const table = model.table(filters);
  const selected = selectedCountries(state).filter((iso3) => env.countries.entities[iso3] !== undefined);
  const selectedIdx = selected.map((iso3) => model.countryOf(iso3)).filter((i) => i >= 0);
  const slotOf = slots.assign(selected);
  const colors = new Map(selected.map((iso3) => [iso3, env.identity[(slotOf.get(iso3) ?? 0) % env.identity.length] ?? '#555']));
  const covered = model.coveredYears(state.range) > 0;
  const compare = state.compare ?? previousWindow(state.range, model.first);

  const values = valuesOver(env, table, metric, state.range);
  const ranking = rank(values, incidentsOver(env, table, state.range), metric);
  const compareRanking = compare === null ? null : rank(valuesOver(env, table, metric, compare), incidentsOver(env, table, compare), metric);

  const key = `${filtersKey(filters)}|${metric.id}|${rangeLength(state.range)}`;
  let domains = domainCache.get(table);
  if (domains === undefined) domainCache.set(table, (domains = new Map()));
  let domainMax = domains.get(key);
  if (domainMax === undefined) {
    const drawn = env.drawable.map((iso3) => model.countryOf(iso3)).filter((c) => c >= 0);
    domainMax = model.windowMax(table, drawn, metric, rangeLength(state.range), MIN_INCIDENTS_FOR_MEAN);
    domains.set(key, domainMax);
  }

  const figuresOf = (countries: readonly number[] | null): CountryFigures => ({
    now: model.totals(table, countries, state.range),
    before: compare === null ? null : model.totals(table, countries, compare),
  });
  const figures = new Map<string, CountryFigures>();
  selected.forEach((iso3) => {
    const c = model.countryOf(iso3);
    figures.set(iso3, figuresOf(c < 0 ? [] : [c]));
  });

  return {
    state,
    level: levelOf(state),
    layer: state.ext['map.layer'] === 'countries' ? 'countries' : 'events',
    metric,
    filters,
    filtered: hasFilter(filters),
    table,
    selected,
    selectedIdx,
    colors,
    values,
    ranking,
    compare,
    compareChosen: state.compare !== null,
    compareRanking,
    domainMax,
    scan: model.scan(filters, state.range, selectedIdx),
    world: figuresOf(null),
    figures,
    series: model.series(table, selectedIdx.length > 0 ? selectedIdx : null, metric),
    covered,
  };
}

function valuesOver(env: Env, table: YearTable, metric: MetricDef, range: YearRange): Map<string, number> {
  const covered = env.model.coveredYears(range) > 0;
  const values = new Map<string, number>();
  for (const iso3 of env.drawable) {
    const c = env.model.countryOf(iso3);
    values.set(iso3, metricOf(c < 0 ? emptyCountry() : env.model.totals(table, [c], range), metric, covered));
  }
  return values;
}

function incidentsOver(env: Env, table: YearTable, range: YearRange): Map<string, number> {
  const incidents = new Map<string, number>();
  for (const iso3 of env.drawable) {
    const c = env.model.countryOf(iso3);
    incidents.set(iso3, c < 0 ? 0 : env.model.totals(table, [c], range).incidents);
  }
  return incidents;
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

/** The window of the same length just before `range`; null when it would start before the data. */
export function previousWindow(range: YearRange, first: number): YearRange | null {
  const length = rangeLength(range);
  if (range.from - length < first) return null;
  return { from: range.from - length, to: range.from - 1 };
}

/** Weight of a group or a bin for the metric: incidents, or known casualties for casualty metrics. */
export function weightOf(totals: Totals, metric: MetricDef): number {
  if (metric.kind === 'count') return totals.incidents;
  const sum = metric.kind === 'mean' ? metric.of : metric.id;
  return sum === 'killed' ? totals.killedSum : totals.woundedSum;
}

/** "incidents" or the casualty unit that weights groups. */
export function weightUnit(metric: MetricDef): string {
  if (metric.kind === 'count') return 'incidents';
  return (metric.kind === 'mean' ? metric.of : metric.id) === 'killed' ? 'morts' : 'blessés';
}
