import type { DatasetMeta } from './contracts';
import { VIEW_IDS, type ViewId } from './tasks';

/**
 * Shared application state. This is the whole inter-module surface: five linking channels
 * (range, compare, focus/pinned, hover, filters) plus `metric`, `view`, `incident` and `ext`.
 * Anything a module needs beyond this goes through `ext` (see below), never through a core edit.
 */

/** Inclusive interval of years; a single year is from === to. */
export interface YearRange {
  readonly from: number;
  readonly to: number;
}

/** Reference to one entity of one dimension, e.g. { dim: 'country', id: 'NGA' }. */
export interface EntityRef {
  readonly dim: string;
  readonly id: string;
}

export interface AppState {
  /** Active view in the integrated shell. */
  readonly view: ViewId;
  /** Id of one of DatasetMeta.metrics. */
  readonly metric: string;
  /** Main temporal selection (slider, window). */
  readonly range: YearRange;
  /** Second period for before/after comparisons (T3, T9); null when off. */
  readonly compare: YearRange | null;
  /** Persistent focus (click). Drives drill-downs and cross-view highlighting. */
  readonly focus: EntityRef | null;
  /** Entities kept for comparison or rank tracking (T12). */
  readonly pinned: readonly EntityRef[];
  /** Incident whose detail sheet is open (T10). */
  readonly incident: string | null;
  /** dimension id → selected category labels; an absent key or an empty list means "no filter". */
  readonly filters: Readonly<Record<string, readonly string[]>>;
  /** Transient highlight (pointer over). Never written to the URL. */
  readonly hover: EntityRef | null;
  /**
   * Module-local scalars, key "<viewId>.<name>" (e.g. "leaderboard.top" → "10").
   * Serialized in the URL, so a module can persist a control without touching core.
   */
  readonly ext: Readonly<Record<string, string>>;
}

export const EXT_KEY = /^([a-z]+)\.([A-Za-z0-9_-]{1,32})$/;
const EXT_VALUE_MAX = 200;

export function clampRange(range: YearRange, first: number, last: number): YearRange {
  const lo = Math.min(range.from, range.to);
  const hi = Math.max(range.from, range.to);
  const from = Math.min(Math.max(Math.round(lo), first), last);
  const to = Math.min(Math.max(Math.round(hi), first), last);
  return { from, to };
}

/** Number of calendar years covered by the range. */
export function rangeLength(range: YearRange): number {
  return range.to - range.from + 1;
}

export function defaultMetric(meta: DatasetMeta): string {
  const first = meta.metrics[0];
  if (!first) throw new Error('DatasetMeta.metrics is empty');
  return first.id;
}

export function defaultState(meta: DatasetMeta, view: ViewId = 'map'): AppState {
  return {
    view,
    metric: defaultMetric(meta),
    range: { from: meta.years.first, to: meta.years.last },
    compare: null,
    focus: null,
    pinned: [],
    incident: null,
    filters: {},
    hover: null,
    ext: {},
  };
}

function sameRef(a: EntityRef, b: EntityRef): boolean {
  return a.dim === b.dim && a.id === b.id;
}

/**
 * Canonicalizes a state against a dataset: the only place where invariants live, so that no module
 * can put the app in an invalid state and the URL form of a state is unique.
 * Returns a new object; the store keeps references for slices that did not change.
 */
export function sanitizeState(state: AppState, meta: DatasetMeta): AppState {
  const dims = new Set(meta.dimensions.map((d) => d.id));
  const { first, last } = meta.years;
  const knownRef = (r: EntityRef | null): EntityRef | null => (r !== null && dims.has(r.dim) && r.id.length > 0 ? { dim: r.dim, id: r.id } : null);

  const metric = meta.metrics.some((m) => m.id === state.metric) ? state.metric : defaultMetric(meta);

  const pinned: EntityRef[] = [];
  for (const raw of state.pinned) {
    const ref = knownRef(raw);
    if (ref !== null && !pinned.some((p) => sameRef(p, ref))) pinned.push(ref);
  }

  const filters: Record<string, readonly string[]> = {};
  for (const dim of Object.keys(state.filters).sort()) {
    if (!dims.has(dim)) continue;
    const values = [...new Set((state.filters[dim] ?? []).filter((v) => v.length > 0))];
    if (values.length > 0) filters[dim] = values;
  }

  const ext: Record<string, string> = {};
  for (const key of Object.keys(state.ext).sort()) {
    const m = EXT_KEY.exec(key);
    const value = state.ext[key];
    if (m === null || value === undefined || !(VIEW_IDS as readonly string[]).includes(m[1] ?? '')) continue;
    ext[key] = value.slice(0, EXT_VALUE_MAX);
  }

  return {
    view: VIEW_IDS.includes(state.view) ? state.view : 'map',
    metric,
    range: clampRange(state.range, first, last),
    compare: state.compare === null ? null : clampRange(state.compare, first, last),
    focus: knownRef(state.focus),
    pinned,
    incident: state.incident !== null && state.incident.length > 0 ? state.incident : null,
    filters,
    hover: knownRef(state.hover),
    ext,
  };
}
