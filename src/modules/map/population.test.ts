import { describe, expect, it } from 'vitest';
import type { MetricDef } from '../../core/meta';
import { displayOf, rank } from './frame';
import { rampPosition } from './globe';
import { MIN_POPULATION_FOR_RATE, parsePopulation, perMillion, Population } from './population';

const population = new Population(
  parsePopulation({
    schemaVersion: 1,
    source: 'test',
    license: 'CC BY 4.0',
    url: '',
    retrieved: null,
    years: { first: 2000, last: 2003 },
    values: { BIG: [40e6, 41e6, null, 43e6], TINY: [30_000, 30_000, 30_000, 30_000] },
  }),
);
const killed: MetricDef = { id: 'killed', label: 'Morts', unit: 'morts', kind: 'sum' };

describe('Population', () => {
  it('averages the known years of a window, and is NaN without any', () => {
    expect(population.mean('BIG', { from: 2000, to: 2003 })).toBeCloseTo(41.333e6, -3);
    expect(population.mean('BIG', { from: 2002, to: 2002 })).toBeNaN(); // null is unknown, never 0
    expect(population.mean('XXX', { from: 2000, to: 2003 })).toBeNaN();
    expect(population.at('BIG', 2001)).toBe(41e6);
  });

  it('turns a value into a rate per million, NaN without population', () => {
    expect(perMillion(82, 41e6)).toBeCloseTo(2, 10);
    expect(perMillion(5, Number.NaN)).toBeNaN();
    expect(perMillion(Number.NaN, 1e6)).toBeNaN();
  });

  it('rejects a file of another format', () => {
    expect(() => parsePopulation({ values: {} })).toThrow();
  });
});

describe('rates in the ranking', () => {
  it('leaves out the countries under a million inhabitants', () => {
    const values = new Map([
      ['BIG', 2],
      ['TINY', 300],
    ]);
    const incidents = new Map([
      ['BIG', 100],
      ['TINY', 1],
    ]);
    const ranking = rank(values, incidents, killed, (iso3) => population.mean(iso3, { from: 2000, to: 2003 }));
    expect(ranking.ordered).toEqual(['BIG']);
    expect(MIN_POPULATION_FOR_RATE).toBe(1_000_000);
    expect(rank(values, incidents, killed).ordered).toEqual(['TINY', 'BIG']);
  });

  it('labels and formats rates', () => {
    const display = displayOf(killed, true);
    expect(display.label).toBe('Morts par million d’habitants');
    expect(display.withUnit(0.042)).toBe('0,04 morts par million d’habitants');
    expect(display.withUnit(Number.NaN)).toBe('pas de donnée');
  });

  it('spreads rates over four decades of the colour ramp', () => {
    expect(rampPosition(600, 600, true)).toBe(1);
    expect(rampPosition(0.06, 600, true)).toBeCloseTo(0, 10);
    expect(rampPosition(6, 600, true)).toBeCloseTo(0.5, 10);
    expect(rampPosition(0, 600, true)).toBe(0);
  });
});
