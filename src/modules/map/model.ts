import type { CubeFile } from '../../core/contracts';
import type { MetricDef } from '../../core/meta';
import type { YearRange } from '../../core/state';

/**
 * The computing engine of the country view. Every number of every panel comes from cube.json through
 * this class, so that the map, the KPIs, the charts and the tables always agree with the filters.
 * The cube is filtered once per filter combination (60 066 rows); windows and selections are then
 * read from a country × year table or a single pass over the rows.
 */

export const CATEGORY_DIMS = ['attackType', 'targetType', 'weaponType'] as const;
export type CategoryDim = (typeof CATEGORY_DIMS)[number];
export type FilterDim = CategoryDim | 'group';
export const FILTER_DIMS: readonly FilterDim[] = [...CATEGORY_DIMS, 'group'];

/** Value of the group dimension for unattributed incidents. */
export const UNKNOWN_GROUP = 'Unknown';

export interface Filters {
  /** null = no filter on the dimension. */
  readonly attackType: ReadonlySet<string> | null;
  readonly targetType: ReadonlySet<string> | null;
  readonly weaponType: ReadonlySet<string> | null;
  readonly group: ReadonlySet<string> | null;
  readonly suicide: 0 | 1 | null;
}

export function readFilters(raw: Readonly<Record<string, readonly string[]>>): Filters {
  const set = (dim: FilterDim) => {
    const values = raw[dim];
    return values !== undefined && values.length > 0 ? new Set(values) : null;
  };
  const suicide = raw.suicide?.length === 1 ? raw.suicide[0] : undefined;
  return {
    attackType: set('attackType'),
    targetType: set('targetType'),
    weaponType: set('weaponType'),
    group: set('group'),
    suicide: suicide === '1' ? 1 : suicide === '0' ? 0 : null,
  };
}

export function filtersKey(filters: Filters): string {
  const part = (values: ReadonlySet<string> | null) => (values === null ? '*' : [...values].sort().join('\u0001'));
  return [...FILTER_DIMS.map((dim) => part(filters[dim])), String(filters.suicide)].join('\u0002');
}

export function hasFilter(filters: Filters): boolean {
  return FILTER_DIMS.some((dim) => filters[dim] !== null) || filters.suicide !== null;
}

export interface Totals {
  incidents: number;
  killedSum: number;
  killedKnown: number;
  woundedSum: number;
  woundedKnown: number;
}

export const emptyTotals = (): Totals => ({ incidents: 0, killedSum: 0, killedKnown: 0, woundedSum: 0, woundedKnown: 0 });

function addInto(target: Totals, source: Totals): void {
  target.incidents += source.incidents;
  target.killedSum += source.killedSum;
  target.killedKnown += source.killedKnown;
  target.woundedSum += source.woundedSum;
  target.woundedKnown += source.woundedKnown;
}

/**
 * Value of a metric for some totals, with the shared semantics of YearlyIndex:
 * NaN = no data (no covered year, or casualties never known), 0 = measured zero.
 */
export function metricOf(totals: Totals, metric: MetricDef, covered: boolean): number {
  if (!covered) return Number.NaN;
  if (metric.kind === 'count') return totals.incidents;
  const sum = metric.kind === 'mean' ? metric.of : metric.id;
  const known = sum === 'killed' ? totals.killedKnown : totals.woundedKnown;
  const value = sum === 'killed' ? totals.killedSum : totals.woundedSum;
  if (metric.kind === 'mean') return known === 0 ? Number.NaN : value / known;
  if (totals.incidents === 0) return 0;
  return known === 0 ? Number.NaN : value;
}

/** Share of incidents whose casualties are known for the metric (1 for counts); NaN without incident. */
export function knownShareOf(totals: Totals, metric: MetricDef): number {
  if (totals.incidents === 0) return Number.NaN;
  if (metric.kind === 'count') return 1;
  const sum = metric.kind === 'mean' ? metric.of : metric.id;
  return (sum === 'killed' ? totals.killedKnown : totals.woundedKnown) / totals.incidents;
}

/** Country × year totals under one filter combination. Index: country * span + (year - first). */
export interface YearTable {
  readonly incidents: Float64Array;
  readonly killedSum: Float64Array;
  readonly killedKnown: Float64Array;
  readonly woundedSum: Float64Array;
  readonly woundedKnown: Float64Array;
}

/** Breakdown of some incidents by the categorical dimensions (arrays indexed like the dictionaries). */
export interface Breakdown {
  readonly total: Totals;
  readonly attackType: Totals[];
  readonly targetType: Totals[];
  readonly weaponType: Totals[];
  /** Sparse: group index → totals. */
  readonly group: Map<number, Totals>;
  /** The suicide attacks among them. */
  readonly suicide: Totals;
}

export interface Scan {
  /** The selected countries together, or the whole world when nothing is selected. */
  readonly combined: Breakdown;
  /** One breakdown per selected country. */
  readonly perCountry: ReadonlyMap<number, Breakdown>;
  /** attack → target and target → weapon flows of `combined`, keyed "a|t" and "t|w". */
  readonly attackTarget: ReadonlyMap<string, Totals>;
  readonly targetWeapon: ReadonlyMap<string, Totals>;
  /** Every country (not only the selection): key group * countryCount + country. */
  readonly groupCountry: ReadonlyMap<number, Totals>;
  /** First and last year of activity of each group in the window, for the groups of `combined`. */
  readonly groupYears: ReadonlyMap<number, readonly [number, number]>;
  /**
   * Incidents per year of the whole span (not only the window), per selected country and group:
   * the activity strip of an organization shows when it appeared and when it dominated (T7).
   */
  readonly groupActivity: ReadonlyMap<number, ReadonlyMap<number, Float64Array>>;
}

export class CountryModel {
  readonly first: number;
  readonly last: number;
  readonly gaps: readonly number[];
  readonly span: number;
  /** cube.json country dictionary: ISO alpha-3 codes and "" (no representable country). */
  readonly countryCodes: readonly string[];
  readonly dict: Readonly<Record<FilterDim, readonly string[]>>;
  private readonly countryIndex: ReadonlyMap<string, number>;
  private readonly dictIndex: Readonly<Record<FilterDim, ReadonlyMap<string, number>>>;
  private readonly rows: number;
  private readonly year: Uint16Array;
  private readonly country: Uint16Array;
  private readonly dims: Readonly<Record<FilterDim, Uint16Array>>;
  private readonly suicide: Uint8Array;
  private readonly measures: YearTable;
  private maskCache: { key: string; mask: Uint8Array } | null = null;
  private tableCache: { key: string; table: YearTable } | null = null;

  constructor(cube: CubeFile, gaps: readonly number[]) {
    this.first = cube.years.first;
    this.last = cube.years.last;
    this.gaps = gaps;
    this.span = this.last - this.first + 1;
    this.countryCodes = cube.dictionaries.country;
    this.countryIndex = new Map(this.countryCodes.map((code, i) => [code, i]));
    this.dict = {
      attackType: cube.dictionaries.attackType,
      targetType: cube.dictionaries.targetType,
      weaponType: cube.dictionaries.weaponType,
      group: cube.dictionaries.group,
    };
    const index = (values: readonly string[]) => new Map(values.map((value, i) => [value, i]));
    this.dictIndex = {
      attackType: index(this.dict.attackType),
      targetType: index(this.dict.targetType),
      weaponType: index(this.dict.weaponType),
      group: index(this.dict.group),
    };
    const c = cube.columns;
    this.rows = cube.count;
    this.year = Uint16Array.from(c.year, (y) => y - this.first);
    this.country = Uint16Array.from(c.country);
    this.dims = {
      attackType: Uint16Array.from(c.attackType),
      targetType: Uint16Array.from(c.targetType),
      weaponType: Uint16Array.from(c.weaponType),
      group: Uint16Array.from(c.group),
    };
    this.suicide = Uint8Array.from(c.suicide);
    this.measures = {
      incidents: Float64Array.from(c.incidents),
      killedSum: Float64Array.from(c.killedSum),
      killedKnown: Float64Array.from(c.killedKnown),
      woundedSum: Float64Array.from(c.woundedSum),
      woundedKnown: Float64Array.from(c.woundedKnown),
    };
  }

  countryOf(iso3: string): number {
    return this.countryIndex.get(iso3) ?? -1;
  }

  indexOf(dim: FilterDim, value: string): number {
    return this.dictIndex[dim].get(value) ?? -1;
  }

  /** Number of covered years (not gaps) in the window. */
  coveredYears(range: YearRange): number {
    let n = 0;
    for (let y = Math.max(range.from, this.first); y <= Math.min(range.to, this.last); y++) if (!this.gaps.includes(y)) n++;
    return n;
  }

  /** 1 for every cube row that passes the filters. */
  mask(filters: Filters): Uint8Array {
    const key = filtersKey(filters);
    if (this.maskCache?.key === key) return this.maskCache.mask;
    const allowed = {} as Record<FilterDim, Uint8Array | null>;
    for (const dim of FILTER_DIMS) {
      const values = filters[dim];
      if (values === null) {
        allowed[dim] = null;
        continue;
      }
      const flags = new Uint8Array(this.dict[dim].length);
      for (const value of values) {
        const i = this.indexOf(dim, value);
        if (i >= 0) flags[i] = 1;
      }
      allowed[dim] = flags;
    }
    const mask = new Uint8Array(this.rows);
    for (let r = 0; r < this.rows; r++) {
      if (filters.suicide !== null && this.suicide[r] !== filters.suicide) continue;
      let pass = 1;
      for (const dim of FILTER_DIMS) {
        const flags = allowed[dim];
        if (flags !== null && flags[this.dims[dim][r] ?? 0] !== 1) {
          pass = 0;
          break;
        }
      }
      mask[r] = pass;
    }
    this.maskCache = { key, mask };
    return mask;
  }

  table(filters: Filters): YearTable {
    const key = filtersKey(filters);
    if (this.tableCache?.key === key) return this.tableCache.table;
    const size = this.countryCodes.length * this.span;
    const table: YearTable = {
      incidents: new Float64Array(size),
      killedSum: new Float64Array(size),
      killedKnown: new Float64Array(size),
      woundedSum: new Float64Array(size),
      woundedKnown: new Float64Array(size),
    };
    const mask = this.mask(filters);
    const m = this.measures;
    for (let r = 0; r < this.rows; r++) {
      if (mask[r] !== 1) continue;
      const i = (this.country[r] ?? 0) * this.span + (this.year[r] ?? 0);
      table.incidents[i] = (table.incidents[i] ?? 0) + (m.incidents[r] ?? 0);
      table.killedSum[i] = (table.killedSum[i] ?? 0) + (m.killedSum[r] ?? 0);
      table.killedKnown[i] = (table.killedKnown[i] ?? 0) + (m.killedKnown[r] ?? 0);
      table.woundedSum[i] = (table.woundedSum[i] ?? 0) + (m.woundedSum[r] ?? 0);
      table.woundedKnown[i] = (table.woundedKnown[i] ?? 0) + (m.woundedKnown[r] ?? 0);
    }
    this.tableCache = { key, table };
    return table;
  }

  /** Totals of some countries (all of them when `countries` is null) over a window. */
  totals(table: YearTable, countries: readonly number[] | null, range: YearRange): Totals {
    const out = emptyTotals();
    const from = Math.max(range.from, this.first) - this.first;
    const to = Math.min(range.to, this.last) - this.first;
    const list = countries ?? this.countryCodes.map((_, i) => i);
    for (const c of list) {
      const base = c * this.span;
      for (let y = from; y <= to; y++) {
        const i = base + y;
        out.incidents += table.incidents[i] ?? 0;
        out.killedSum += table.killedSum[i] ?? 0;
        out.killedKnown += table.killedKnown[i] ?? 0;
        out.woundedSum += table.woundedSum[i] ?? 0;
        out.woundedKnown += table.woundedKnown[i] ?? 0;
      }
    }
    return out;
  }

  /** One value of the metric per year of the whole span (NaN on gaps) for some countries. */
  series(table: YearTable, countries: readonly number[] | null, metric: MetricDef): Float64Array {
    const out = new Float64Array(this.span);
    for (let y = 0; y < this.span; y++) {
      const year = this.first + y;
      out[y] = metricOf(this.totals(table, countries, { from: year, to: year }), metric, !this.gaps.includes(year));
    }
    return out;
  }

  /** A breakdown of the window's filtered rows for the selection, plus what the links need. */
  scan(filters: Filters, range: YearRange, selection: readonly number[]): Scan {
    const mask = this.mask(filters);
    const from = range.from - this.first;
    const to = range.to - this.first;
    const selected = new Set(selection);
    const newBreakdown = (): Breakdown => ({
      total: emptyTotals(),
      attackType: this.dict.attackType.map(emptyTotals),
      targetType: this.dict.targetType.map(emptyTotals),
      weaponType: this.dict.weaponType.map(emptyTotals),
      group: new Map(),
      suicide: emptyTotals(),
    });
    const combined = newBreakdown();
    const perCountry = new Map(selection.map((c) => [c, newBreakdown()]));
    const attackTarget = new Map<string, Totals>();
    const targetWeapon = new Map<string, Totals>();
    const groupCountry = new Map<number, Totals>();
    const groupYears = new Map<number, [number, number]>();
    const groupActivity = new Map(selection.map((c) => [c, new Map<number, Float64Array>()]));
    const countryCount = this.countryCodes.length;
    const m = this.measures;
    const row = emptyTotals();
    const add = <K>(map: Map<K, Totals>, key: K) => {
      let t = map.get(key);
      if (t === undefined) map.set(key, (t = emptyTotals()));
      addInto(t, row);
    };

    for (let r = 0; r < this.rows; r++) {
      if (mask[r] !== 1) continue;
      const y = this.year[r] ?? 0;
      const activity = groupActivity.get(this.country[r] ?? 0);
      if (activity !== undefined) {
        const g = this.dims.group[r] ?? 0;
        let years = activity.get(g);
        if (years === undefined) activity.set(g, (years = new Float64Array(this.span)));
        years[y] = (years[y] ?? 0) + (m.incidents[r] ?? 0);
      }
      if (y < from || y > to) continue;
      row.incidents = m.incidents[r] ?? 0;
      row.killedSum = m.killedSum[r] ?? 0;
      row.killedKnown = m.killedKnown[r] ?? 0;
      row.woundedSum = m.woundedSum[r] ?? 0;
      row.woundedKnown = m.woundedKnown[r] ?? 0;
      const c = this.country[r] ?? 0;
      const g = this.dims.group[r] ?? 0;
      add(groupCountry, g * countryCount + c);

      if (selected.size > 0 && !selected.has(c)) continue;
      const a = this.dims.attackType[r] ?? 0;
      const t = this.dims.targetType[r] ?? 0;
      const w = this.dims.weaponType[r] ?? 0;
      const suicide = this.suicide[r] === 1;
      for (const breakdown of [combined, perCountry.get(c)]) {
        if (breakdown === undefined) continue;
        addInto(breakdown.total, row);
        if (suicide) addInto(breakdown.suicide, row);
        addInto(breakdown.attackType[a] ?? emptyTotals(), row);
        addInto(breakdown.targetType[t] ?? emptyTotals(), row);
        addInto(breakdown.weaponType[w] ?? emptyTotals(), row);
        add(breakdown.group, g);
      }
      add(attackTarget, `${a}|${t}`);
      add(targetWeapon, `${t}|${w}`);
      const span = groupYears.get(g);
      const year = this.first + y;
      if (span === undefined) groupYears.set(g, [year, year]);
      else groupYears.set(g, [Math.min(span[0], year), Math.max(span[1], year)]);
    }
    return { combined, perCountry, attackTarget, targetWeapon, groupCountry, groupYears, groupActivity };
  }

  /**
   * Largest value of the metric for any of `countries` over any window of `length` years. The map
   * fixes its colour scale on it, so that a colour keeps its meaning while the window slides (play).
   * Windows made only of gaps are skipped; a mean needs `minIncidents` incidents to count.
   */
  windowMax(table: YearTable, countries: readonly number[], metric: MetricDef, length: number, minIncidents = 0): number {
    const span = this.span;
    const size = Math.max(1, Math.min(length, span));
    const covered = new Uint8Array(span + 1);
    for (let y = 0; y < span; y++) covered[y + 1] = (covered[y] ?? 0) + (this.gaps.includes(this.first + y) ? 0 : 1);
    const prefix = Object.fromEntries(MEASURES.map((key) => [key, new Float64Array(span + 1)])) as Record<keyof YearTable, Float64Array>;
    const window = emptyTotals();
    let max = 0;
    for (const c of countries) {
      const base = c * span;
      for (const key of MEASURES) {
        const p = prefix[key];
        const values = table[key];
        for (let y = 0; y < span; y++) p[y + 1] = (p[y] ?? 0) + (values[base + y] ?? 0);
      }
      for (let start = 0; start + size <= span; start++) {
        if ((covered[start + size] ?? 0) - (covered[start] ?? 0) === 0) continue;
        for (const key of MEASURES) window[key] = (prefix[key][start + size] ?? 0) - (prefix[key][start] ?? 0);
        if (metric.kind === 'mean' && window.incidents < minIncidents) continue;
        const value = metricOf(window, metric, true);
        if (value > max) max = value;
      }
    }
    return max;
  }
}

const MEASURES = ['incidents', 'killedSum', 'killedKnown', 'woundedSum', 'woundedKnown'] as const;

/**
 * Perpetrator labels of the GTD that describe a kind of actor rather than an organization
 * ("Gunmen", "Muslim extremists", "Separatists"…). Linking two countries through them would invent
 * a connection, so the links of the map leave them out. Rule: no acronym in brackets and a last
 * word among these descriptors.
 */
const GENERIC_ACTOR = /\b(extremists?|militants?|terrorists?|gunmen|separatists?|guerrillas?|rebels?|insurgents?|students?|youths?|strikers?|anarchists?|communists?|muslims?|palestinians?|nationalists?|exiles?|tribesmen|maoists?|activists?|protesters?|rioters?|villagers?|sympathizers?|assailants?|criminals?|smugglers?|workers?|farmers?|supporters?|elements?|individuals?|members?|mob|group)$/i;

export function isNamedGroup(name: string): boolean {
  if (name === UNKNOWN_GROUP || name === 'Other') return false;
  return name.includes('(') || !GENERIC_ACTOR.test(name.trim());
}
