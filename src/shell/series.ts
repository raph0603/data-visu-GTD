import type { CubeFile } from '../core/contracts';
import { metricDef, type DatasetMeta } from '../core/meta';
import type { AppState } from '../core/state';

/** The explored countries of the shared state, as ISO alpha-3 codes. */
export function pinnedCountries(state: AppState): string[] {
  return state.pinned.filter((ref) => ref.dim === 'country').map((ref) => ref.id);
}

/**
 * One value of the metric per year of the whole span, for the countries explored (the world when
 * none) and the filters of the shared state: the histogram of the time zone. A year the source lost
 * is NaN, a year without incident is 0, as everywhere else. The period itself does not enter, so
 * moving the window does not recompute it.
 */
export function yearlySeries(cube: CubeFile, meta: DatasetMeta, state: AppState): Float64Array {
  const { first, last, gaps } = meta.years;
  const span = last - first + 1;
  const metric = metricDef(meta, state.metric);
  const columns = cube.columns;

  const allowed = (dim: 'attackType' | 'targetType' | 'weaponType' | 'group'): Uint8Array | null => {
    const values = state.filters[dim];
    if (values === undefined || values.length === 0) return null;
    const wanted = new Set(values);
    return Uint8Array.from(cube.dictionaries[dim], (label) => (wanted.has(label) ? 1 : 0));
  };
  const attack = allowed('attackType');
  const target = allowed('targetType');
  const weapon = allowed('weaponType');
  const group = allowed('group');
  const explored = pinnedCountries(state);
  const countries = explored.length === 0 ? null : Uint8Array.from(cube.dictionaries.country, (iso3) => (explored.includes(iso3) ? 1 : 0));
  const suicideValue = state.filters.suicide?.[0];
  const suicide = suicideValue === '1' ? 1 : suicideValue === '0' ? 0 : null;

  const incidents = new Float64Array(span);
  const killed = new Float64Array(span);
  const killedKnown = new Float64Array(span);
  const wounded = new Float64Array(span);
  for (let i = 0; i < cube.count; i++) {
    if (countries !== null && countries[columns.country[i] ?? 0] !== 1) continue;
    if (attack !== null && attack[columns.attackType[i] ?? 0] !== 1) continue;
    if (target !== null && target[columns.targetType[i] ?? 0] !== 1) continue;
    if (weapon !== null && weapon[columns.weaponType[i] ?? 0] !== 1) continue;
    if (group !== null && group[columns.group[i] ?? 0] !== 1) continue;
    if (suicide !== null && columns.suicide[i] !== suicide) continue;
    const y = (columns.year[i] ?? first) - first;
    incidents[y] = (incidents[y] ?? 0) + (columns.incidents[i] ?? 0);
    killed[y] = (killed[y] ?? 0) + (columns.killedSum[i] ?? 0);
    killedKnown[y] = (killedKnown[y] ?? 0) + (columns.killedKnown[i] ?? 0);
    wounded[y] = (wounded[y] ?? 0) + (columns.woundedSum[i] ?? 0);
  }

  const out = new Float64Array(span);
  for (let y = 0; y < span; y++) {
    if (gaps.includes(first + y)) out[y] = Number.NaN;
    else if (metric.id === 'killed') out[y] = killed[y] ?? 0;
    else if (metric.id === 'wounded') out[y] = wounded[y] ?? 0;
    else if (metric.kind === 'mean') out[y] = (killedKnown[y] ?? 0) > 0 ? (killed[y] ?? 0) / (killedKnown[y] ?? 1) : Number.NaN;
    else out[y] = incidents[y] ?? 0;
  }
  return out;
}
