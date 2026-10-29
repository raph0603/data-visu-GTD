import { describe, expect, it } from 'vitest';
import type { CubeFile } from '../../core/contracts';
import type { MetricDef } from '../../core/meta';
import { CountryModel, isNamedGroup, metricOf, readFilters } from './model';
import { SlotKeeper } from './selection';

// 2000-2002, 2001 has no data. Countries: "" (not representable), FRA, NGA.
//  row  year country attack     target   weapon  group       suicide incidents killed (known) wounded (known)
//   0   2000  FRA    Bombing    Police   Explos  ETA         0       2         3 (2)          1 (2)
//   1   2000  NGA    Armed      Civils   Fire    Boko Haram  0       1         0 (0)          0 (1)
//   2   2002  NGA    Bombing    Civils   Explos  Boko Haram  1       3         30 (3)         10 (3)
//   3   2002  ""     Armed      Police   Fire    ETA         0       1         5 (1)          0 (1)
const cube: CubeFile = {
  schemaVersion: 1,
  years: { first: 2000, last: 2002 },
  count: 4,
  dictionaries: {
    country: ['', 'FRA', 'NGA'],
    attackType: ['Armed Assault', 'Bombing/Explosion'],
    targetType: ['Police', 'Private Citizens & Property'],
    weaponType: ['Explosives', 'Firearms'],
    group: ['Boko Haram', 'ETA'],
  },
  columns: {
    year: [2000, 2000, 2002, 2002],
    country: [1, 2, 2, 0],
    attackType: [1, 0, 1, 0],
    targetType: [0, 1, 1, 0],
    weaponType: [0, 1, 0, 1],
    group: [1, 0, 0, 1],
    suicide: [0, 0, 1, 0],
    incidents: [2, 1, 3, 1],
    killedSum: [3, 0, 30, 5],
    killedKnown: [2, 0, 3, 1],
    woundedSum: [1, 0, 10, 0],
    woundedKnown: [2, 1, 3, 1],
  },
};

const incidents: MetricDef = { id: 'incidents', label: 'Incidents', unit: 'incidents', kind: 'count' };
const killed: MetricDef = { id: 'killed', label: 'Morts', unit: 'morts', kind: 'sum' };
const lethality: MetricDef = { id: 'lethality', label: 'Morts par incident', unit: 'morts par incident', kind: 'mean', of: 'killed' };
const all = { from: 2000, to: 2002 };

const model = new CountryModel(cube, [2001]);
const fra = model.countryOf('FRA');
const nga = model.countryOf('NGA');

describe('CountryModel totals', () => {
  it('sums every row of a country over a window, and the world with the unrepresentable rows', () => {
    const table = model.table(readFilters({}));
    expect(model.totals(table, [nga], all)).toMatchObject({ incidents: 4, killedSum: 30, killedKnown: 3 });
    expect(model.totals(table, null, all).incidents).toBe(7);
  });

  it('applies every filter, the suicide flag included', () => {
    expect(model.totals(model.table(readFilters({ attackType: ['Bombing/Explosion'] })), null, all).incidents).toBe(5);
    expect(model.totals(model.table(readFilters({ group: ['ETA'] })), null, all).incidents).toBe(3);
    expect(model.totals(model.table(readFilters({ suicide: ['1'] })), null, all).incidents).toBe(3);
    expect(model.totals(model.table(readFilters({ suicide: ['0'], weaponType: ['Firearms'] })), null, all).incidents).toBe(2);
  });
});

describe('metricOf', () => {
  const table = model.table(readFilters({}));

  it('keeps "unknown" apart from zero', () => {
    const nga2000 = model.totals(table, [nga], { from: 2000, to: 2000 });
    expect(metricOf(nga2000, incidents, true)).toBe(1);
    expect(metricOf(nga2000, killed, true)).toBeNaN(); // one incident, deaths unknown
    const fra2002 = model.totals(table, [fra], { from: 2002, to: 2002 });
    expect(metricOf(fra2002, killed, true)).toBe(0); // no incident: measured zero
  });

  it('returns NaN for a window made only of years without data', () => {
    expect(model.coveredYears({ from: 2001, to: 2001 })).toBe(0);
    expect(metricOf(model.totals(table, [fra], { from: 2001, to: 2001 }), incidents, false)).toBeNaN();
  });

  it('computes the mean over known values, not over incidents', () => {
    // NGA: (0 + 30) deaths / (0 + 3) known values = 10, not 30 / 4 incidents.
    expect(metricOf(model.totals(table, [nga], all), lethality, true)).toBe(10);
  });
});

describe('CountryModel.scan', () => {
  it('breaks the selection down by category and keeps every country for the links', () => {
    const scan = model.scan(readFilters({}), all, [nga]);
    expect(scan.combined.total.incidents).toBe(4);
    expect(scan.combined.attackType.map((t) => t.incidents)).toEqual([1, 3]);
    expect(scan.perCountry.get(nga)?.targetType.map((t) => t.incidents)).toEqual([0, 4]);
    expect(scan.attackTarget.get('1|1')?.incidents).toBe(3);
    // ETA also acts in FRA and in the unrepresentable rows, outside the selection.
    const eta = model.indexOf('group', 'ETA');
    expect(scan.groupCountry.get(eta * model.countryCodes.length + fra)?.incidents).toBe(2);
    expect(scan.groupYears.get(model.indexOf('group', 'Boko Haram'))).toEqual([2000, 2002]);
  });

  it('uses the whole world when nothing is selected, inside the window only', () => {
    const scan = model.scan(readFilters({}), { from: 2002, to: 2002 }, []);
    expect(scan.combined.total.incidents).toBe(4);
    expect(scan.perCountry.size).toBe(0);
  });
});

describe('CountryModel.windowMax', () => {
  const table = model.table(readFilters({}));

  it('is the largest value over every window of the length, skipping windows made of gaps', () => {
    // One-year windows: NGA 2002 has 3 incidents; 2001 has no data.
    expect(model.windowMax(table, [fra, nga], incidents, 1)).toBe(3);
    expect(model.windowMax(table, [fra, nga], killed, 1)).toBe(30);
    // Two-year windows: 2001-2002 gives NGA 3, 2000-2001 gives FRA 2.
    expect(model.windowMax(table, [fra], incidents, 2)).toBe(2);
  });

  it('ignores the means resting on too few incidents', () => {
    expect(model.windowMax(table, [nga], lethality, 1, 10)).toBe(0);
    expect(model.windowMax(table, [nga], lethality, 1)).toBe(10);
  });
});

describe('isNamedGroup', () => {
  it('keeps organizations and leaves out generic actors and Unknown', () => {
    expect(isNamedGroup('Boko Haram')).toBe(true);
    expect(isNamedGroup('Islamic State of Iraq and the Levant (ISIL)')).toBe(true);
    expect(isNamedGroup("Kurdistan Workers' Party (PKK)")).toBe(true);
    expect(isNamedGroup('Gunmen')).toBe(false);
    expect(isNamedGroup('Muslim extremists')).toBe(false);
    expect(isNamedGroup('Separatists')).toBe(false);
    expect(isNamedGroup('Unknown')).toBe(false);
  });
});

describe('SlotKeeper', () => {
  it('keeps the colour of a country when another one is removed', () => {
    const slots = new SlotKeeper();
    slots.assign(['IRQ', 'SYR', 'NGA']);
    const after = slots.assign(['IRQ', 'NGA']);
    expect(after.get('NGA')).toBe(2);
    expect(slots.assign(['IRQ', 'NGA', 'AFG']).get('AFG')).toBe(1); // lowest free slot
  });
});
