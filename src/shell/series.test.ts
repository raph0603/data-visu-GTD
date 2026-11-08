import { describe, expect, it } from 'vitest';
import type { CubeFile } from '../core/contracts';
import type { DatasetMeta } from '../core/meta';
import type { AppState } from '../core/state';
import { pinnedCountries, yearlySeries } from './series';

const meta = {
  years: { first: 1990, last: 1994, gaps: [1993] },
  metrics: [
    { id: 'incidents', label: 'Incidents', unit: 'incidents', kind: 'count' },
    { id: 'killed', label: 'Morts', unit: 'morts', kind: 'sum' },
    { id: 'lethality', label: 'Morts par incident', unit: 'morts par incident', kind: 'mean', of: 'killed' },
  ],
} as unknown as DatasetMeta;

// 1990 FRA bomb (2 incidents, 4 dead of 2 known), 1991 FRA assault, 1991 IRQ bomb suicide, 1994 IRQ bomb.
const cube = {
  count: 4,
  dictionaries: { country: ['FRA', 'IRQ'], attackType: ['Bombing/Explosion', 'Armed Assault'], targetType: ['Police'], weaponType: ['Explosives'], group: ['ETA', 'Unknown'] },
  columns: {
    year: [1990, 1991, 1991, 1994],
    country: [0, 0, 1, 1],
    attackType: [0, 1, 0, 0],
    targetType: [0, 0, 0, 0],
    weaponType: [0, 0, 0, 0],
    group: [0, 1, 1, 1],
    suicide: [0, 0, 1, 0],
    incidents: [2, 1, 1, 3],
    killedSum: [4, 1, 6, 0],
    killedKnown: [2, 1, 1, 3],
    woundedSum: [0, 0, 0, 0],
    woundedKnown: [2, 1, 1, 3],
  },
} as unknown as CubeFile;

function state(patch: Partial<AppState> = {}): AppState {
  return { view: 'map', metric: 'incidents', range: { from: 1990, to: 1994 }, compare: null, focus: null, pinned: [], incident: null, filters: {}, hover: null, ext: {}, ...patch };
}

describe('yearlySeries', () => {
  it('sums the metric per year, with NaN on the years the source lost and 0 on empty ones', () => {
    const series = yearlySeries(cube, meta, state());
    expect(Array.from(series.slice(0, 3))).toEqual([2, 2, 0]);
    expect(Number.isNaN(series[3])).toBe(true);
    expect(series[4]).toBe(3);
  });

  it('follows the metric, the mean being over the incidents whose value is known', () => {
    expect(Array.from(yearlySeries(cube, meta, state({ metric: 'killed' })).slice(0, 2))).toEqual([4, 7]);
    const lethality = yearlySeries(cube, meta, state({ metric: 'lethality' }));
    expect(lethality[0]).toBe(2);
    expect(lethality[1]).toBe(3.5);
    expect(Number.isNaN(lethality[2])).toBe(true);
  });

  it('keeps the explored countries only', () => {
    const iraq = state({ pinned: [{ dim: 'country', id: 'IRQ' }] });
    expect(pinnedCountries(iraq)).toEqual(['IRQ']);
    expect(Array.from(yearlySeries(cube, meta, iraq).slice(0, 2))).toEqual([0, 1]);
  });

  it('applies the categorical and suicide filters', () => {
    expect(yearlySeries(cube, meta, state({ filters: { attackType: ['Armed Assault'] } }))[1]).toBe(1);
    expect(Array.from(yearlySeries(cube, meta, state({ filters: { group: ['ETA'] } })).slice(0, 2))).toEqual([2, 0]);
    expect(yearlySeries(cube, meta, state({ filters: { suicide: ['1'] } }))[1]).toBe(1);
    expect(yearlySeries(cube, meta, state({ filters: { suicide: ['0'] } }))[1]).toBe(1);
  });
});
