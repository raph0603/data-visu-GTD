import type { GeoProjection } from 'd3';
import type { CountryIncidentsFile } from '../../core/contracts';
import type { DataApi } from '../../core/data';
import type { YearRange } from '../../core/state';
import { FILTER_DIMS, filtersKey, type Filters } from './model';

/** One loaded incidents/<iso3>.json with its points projected once in map coordinates. */
export interface IncidentSet {
  readonly iso3: string;
  readonly file: CountryIncidentsFile;
  readonly x: Float32Array;
  readonly y: Float32Array;
}

/**
 * The incident files of the selected countries (points on the map, deadliest incidents, sheets).
 * Files are loaded through ctx.data (memoized) and kept here with their projected coordinates.
 */
export class IncidentFiles {
  private readonly sets = new Map<string, IncidentSet>();
  private readonly errors = new Map<string, string>();
  private readonly pending = new Map<string, Promise<void>>();
  private visibleCache = new Map<string, Uint32Array>();

  constructor(
    private readonly data: DataApi,
    private readonly projection: GeoProjection,
  ) {}

  /** Loads the missing files; resolves once every requested file is loaded or has failed. */
  ensure(iso3s: readonly string[]): Promise<void> {
    return Promise.all(iso3s.map((iso3) => this.load(iso3))).then(() => undefined);
  }

  private load(iso3: string): Promise<void> {
    if (this.sets.has(iso3)) return Promise.resolve();
    const running = this.pending.get(iso3);
    if (running !== undefined) return running;
    const promise = this.data
      .incidents(iso3)
      .then((file) => {
        const x = new Float32Array(file.count);
        const y = new Float32Array(file.count);
        for (let i = 0; i < file.count; i++) {
          const p = this.projection([file.columns.longitude[i] ?? 0, file.columns.latitude[i] ?? 0]);
          x[i] = p?.[0] ?? Number.NaN;
          y[i] = p?.[1] ?? Number.NaN;
        }
        this.sets.set(iso3, { iso3, file, x, y });
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
      if (pass && !Number.isNaN(set.x[i] ?? Number.NaN)) out.push(i);
    }
    const result = Uint32Array.from(out);
    if (this.visibleCache.size > 64) this.visibleCache = new Map();
    this.visibleCache.set(key, result);
    return result;
  }
}

/** Label of a dictionary-coded column of an incident. */
export function incidentCategory(set: IncidentSet, dim: 'attackType' | 'targetType' | 'weaponType' | 'group', index: number): string {
  return set.file.dictionaries[dim][set.file.columns[dim][index] ?? 0] ?? '';
}
