import type { CountryIncidentsFile } from '../../core/contracts';
import type { DataApi } from '../../core/data';
import type { YearRange } from '../../core/state';
import { FILTER_DIMS, filtersKey, type Filters } from './model';

const RAD = Math.PI / 180;

/**
 * One loaded incidents/<iso3>.json. The globe reprojects its points at every frame, so the sines and
 * cosines of each position are computed once here (camera.ts, PointProjector).
 */
export interface IncidentSet {
  readonly iso3: string;
  readonly file: CountryIncidentsFile;
  readonly cosLat: Float64Array;
  readonly sinLat: Float64Array;
  readonly cosLon: Float64Array;
  readonly sinLon: Float64Array;
}

/**
 * The incident files of the explored countries (points, density, deadliest incidents, sheets),
 * loaded through ctx.data (memoized) and kept with their trigonometry.
 */
export class IncidentFiles {
  private readonly sets = new Map<string, IncidentSet>();
  private readonly errors = new Map<string, string>();
  private readonly pending = new Map<string, Promise<void>>();
  private visibleCache = new Map<string, Uint32Array>();

  constructor(private readonly data: DataApi) {}

  /** Loads the missing files; resolves once every requested file is loaded or has failed. */
  ensure(iso3s: readonly string[]): Promise<void> {
    return Promise.all(iso3s.map((iso3) => this.load(iso3))).then(() => undefined);
  }

  /** True while one of these files is neither loaded nor failed. */
  missing(iso3s: readonly string[]): boolean {
    return iso3s.some((iso3) => !this.sets.has(iso3) && !this.errors.has(iso3));
  }

  private load(iso3: string): Promise<void> {
    if (this.sets.has(iso3)) return Promise.resolve();
    const running = this.pending.get(iso3);
    if (running !== undefined) return running;
    const promise = this.data
      .incidents(iso3)
      .then((file) => {
        const n = file.count;
        const set: IncidentSet = { iso3, file, cosLat: new Float64Array(n), sinLat: new Float64Array(n), cosLon: new Float64Array(n), sinLon: new Float64Array(n) };
        for (let i = 0; i < n; i++) {
          const lat = (file.columns.latitude[i] ?? Number.NaN) * RAD;
          const lon = (file.columns.longitude[i] ?? Number.NaN) * RAD;
          set.cosLat[i] = Math.cos(lat);
          set.sinLat[i] = Math.sin(lat);
          set.cosLon[i] = Math.cos(lon);
          set.sinLon[i] = Math.sin(lon);
        }
        this.sets.set(iso3, set);
        this.errors.delete(iso3);
      })
      .catch((error: unknown) => {
        this.errors.set(iso3, error instanceof Error ? error.message : String(error));
      })
      .finally(() => this.pending.delete(iso3));
    this.pending.set(iso3, promise);
    return promise;
  }

  get(iso3: string): IncidentSet | undefined {
    return this.sets.get(iso3);
  }

  error(iso3: string): string | undefined {
    return this.errors.get(iso3);
  }

  /** The incident of an event id among the loaded files. */
  find(eventId: string): { set: IncidentSet; index: number } | undefined {
    for (const set of this.sets.values()) {
      const index = set.file.columns.eventId.indexOf(eventId);
      if (index >= 0) return { set, index };
    }
    return undefined;
  }

  /** Indexes of the incidents of one country that pass the filters in the window. */
  visible(iso3: string, filters: Filters, range: YearRange): Uint32Array {
    const set = this.sets.get(iso3);
    if (set === undefined) return new Uint32Array(0);
    const key = `${iso3}\u0003${range.from}-${range.to}\u0003${filtersKey(filters)}`;
    const hit = this.visibleCache.get(key);
    if (hit !== undefined) return hit;
    const { file } = set;
    const allowed = FILTER_DIMS.map((dim) => {
      const values = filters[dim];
      return values === null ? null : file.dictionaries[dim].map((label) => values.has(label));
    });
    const columns = FILTER_DIMS.map((dim) => file.columns[dim]);
    const out: number[] = [];
    for (let i = 0; i < file.count; i++) {
      const year = file.columns.year[i] ?? 0;
      if (year < range.from || year > range.to) continue;
      if (filters.suicide !== null && file.columns.suicide[i] !== filters.suicide) continue;
      let pass = true;
      for (let d = 0; d < allowed.length && pass; d++) {
        const flags = allowed[d];
        if (flags != null && flags[columns[d]?.[i] ?? 0] !== true) pass = false;
      }
      if (pass && Number.isFinite(set.cosLat[i] ?? Number.NaN)) out.push(i);
    }
    const result = Uint32Array.from(out);
    if (this.visibleCache.size > 600) this.visibleCache = new Map();
    this.visibleCache.set(key, result);
    return result;
  }
}

/** Size of a position cell, in degrees (about 2 km): far below a hexagon at any zoom where hexagons show. */
const CELL_DEG = 0.02;

/**
 * Incidents grouped by position. The GTD places most incidents at the centre of their city, so the
 * 181 691 incidents fall into far fewer distinct positions: the world-level density projects these
 * cells at each frame instead of every incident.
 */
export interface Cells {
  readonly n: number;
  readonly cosLat: Float64Array;
  readonly sinLat: Float64Array;
  readonly cosLon: Float64Array;
  readonly sinLon: Float64Array;
  readonly incidents: Float64Array;
  readonly killedSum: Float64Array;
  readonly killedKnown: Float64Array;
  readonly woundedSum: Float64Array;
  readonly woundedKnown: Float64Array;
  readonly city: readonly (string | null)[];
}

const cellCache = new WeakMap<IncidentFiles, { key: string; cells: Cells }>();
const orderCache = new WeakMap<IncidentFiles, Map<string, Uint32Array>>();

/** Cells of the visible incidents of some countries (the loaded ones), memoized on the last request. */
export function cellsOf(files: IncidentFiles, iso3s: readonly string[], filters: Filters, range: YearRange): Cells {
  const loaded = iso3s.filter((iso3) => files.get(iso3) !== undefined);
  const key = `${loaded.join(',')}\u0003${range.from}-${range.to}\u0003${filtersKey(filters)}`;
  const hit = cellCache.get(files);
  if (hit?.key === key) return hit.cells;
  const index = new Map<number, number>();
  const trig: number[][] = [[], [], [], []];
  const sums: number[][] = [[], [], [], [], []];
  const city: (string | null)[] = [];
  for (const iso3 of loaded) {
    const set = files.get(iso3);
    if (set === undefined) continue;
    const c = set.file.columns;
    for (const i of files.visible(iso3, filters, range)) {
      const q = (Math.round((c.latitude[i] ?? 0) / CELL_DEG) + 5000) * 20000 + (Math.round((c.longitude[i] ?? 0) / CELL_DEG) + 10000);
      let n = index.get(q);
      if (n === undefined) {
        n = city.length;
        index.set(q, n);
        trig[0]?.push(set.cosLat[i] ?? 0);
        trig[1]?.push(set.sinLat[i] ?? 0);
        trig[2]?.push(set.cosLon[i] ?? 0);
        trig[3]?.push(set.sinLon[i] ?? 0);
        for (const column of sums) column.push(0);
        city.push(c.city[i] ?? null);
      }
      const killed = c.killed[i];
      const wounded = c.wounded[i];
      add(sums[0], n, 1);
      if (killed != null) {
        add(sums[1], n, killed);
        add(sums[2], n, 1);
      }
      if (wounded != null) {
        add(sums[3], n, wounded);
        add(sums[4], n, 1);
      }
    }
  }
  const f64 = (values: number[] | undefined) => Float64Array.from(values ?? []);
  const cells: Cells = {
    n: city.length,
    cosLat: f64(trig[0]),
    sinLat: f64(trig[1]),
    cosLon: f64(trig[2]),
    sinLon: f64(trig[3]),
    incidents: f64(sums[0]),
    killedSum: f64(sums[1]),
    killedKnown: f64(sums[2]),
    woundedSum: f64(sums[3]),
    woundedKnown: f64(sums[4]),
    city,
  };
  cellCache.set(files, { key, cells });
  return cells;
}

function add(column: number[] | undefined, n: number, value: number): void {
  if (column !== undefined) column[n] = (column[n] ?? 0) + value;
}

/** Visible incidents of one country, deadliest first: big points are drawn first, small ones stay on top. */
export function deadliestFirst(files: IncidentFiles, iso3: string, filters: Filters, range: YearRange): Uint32Array {
  let cache = orderCache.get(files);
  if (cache === undefined) orderCache.set(files, (cache = new Map()));
  const key = `${iso3}\u0003${range.from}-${range.to}\u0003${filtersKey(filters)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const set = files.get(iso3);
  const killed = set?.file.columns.killed ?? [];
  const order = Uint32Array.from(files.visible(iso3, filters, range)).sort((a, b) => (killed[b] ?? 0) - (killed[a] ?? 0));
  if (cache.size > 600) cache.clear();
  if (set !== undefined) cache.set(key, order);
  return order;
}

/** Label of a dictionary-coded column of an incident. */
export function incidentCategory(set: IncidentSet, dim: 'attackType' | 'targetType' | 'weaponType' | 'group', index: number): string {
  return set.file.dictionaries[dim][set.file.columns[dim][index] ?? 0] ?? '';
}

/** "12 juin 2014", "juin 2014" or "2014" when the day or the month is unknown. */
export function incidentDate(year: number, month: number | null | undefined, day: number | null | undefined): string {
  if (month == null) return String(year);
  const name = new Date(Date.UTC(2000, month - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });
  return day == null ? `${name} ${year}` : `${day === 1 ? '1er' : day} ${name} ${year}`;
}
