import { describe, expect, it } from 'vitest';
import type { EntityRow, YearlyEntitySeries } from '../src/core/contracts';
import { DatasetError } from '../src/core/meta';
import { YearlyIndex } from '../src/core/series';
import { clampRange } from '../src/core/state';
import { fixtureMeta, rng } from './fixtures/meta';

const FIRST = fixtureMeta.years.first; // 2000
const LAST = fixtureMeta.years.last; // 2009
const N = LAST - FIRST + 1;
const GAPS = new Set(fixtureMeta.years.gaps); // {2003}

function buildEntity(id: string, next: () => number): EntityRow {
  const incidents: number[] = [];
  const known: number[] = [];
  const killed: number[] = [];
  for (let i = 0; i < N; i++) {
    const gap = GAPS.has(FIRST + i);
    const c = gap ? 0 : Math.floor(next() * 6);
    const k = Math.floor(next() * (c + 1));
    incidents.push(c);
    known.push(k);
    killed.push(k === 0 ? 0 : Math.floor(next() * 20) + k);
  }
  return { id, label: id, parent: 'R1', sum: { incidents, killed }, known: { killed: known } };
}

function randomFile(seed: number, entities = 7): YearlyEntitySeries {
  const next = rng(seed);
  return { schemaVersion: 1, dim: 'country', firstYear: FIRST, lastYear: LAST, entities: Array.from({ length: entities }, (_, i) => buildEntity(`E${i}`, next)) };
}

/** Straight scan over the yearly arrays: the specification the prefix sums must match. */
function brute(file: YearlyEntitySeries, e: number, metric: string, range: { from: number; to: number }): number {
  const r = clampRange(range, FIRST, LAST);
  const row = file.entities[e] as EntityRow;
  let total = 0;
  let known = 0;
  let sum = 0;
  let covered = false;
  for (let y = r.from; y <= r.to; y++) {
    const i = y - FIRST;
    if (!GAPS.has(y)) covered = true;
    total += row.sum.incidents?.[i] ?? 0;
    known += row.known.killed?.[i] ?? 0;
    sum += row.sum.killed?.[i] ?? 0;
  }
  if (!covered) return NaN;
  if (metric === 'incidents') return total;
  if (metric === 'killed') return total === 0 ? 0 : known === 0 ? NaN : sum;
  return known === 0 ? NaN : sum / known;
}

const same = (a: number, b: number): boolean => Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) < 1e-9;

describe('YearlyIndex', () => {
  it('matches a brute-force scan on random windows for every metric', () => {
    const next = rng(2024);
    for (let seed = 1; seed <= 20; seed++) {
      const file = randomFile(seed);
      const index = new YearlyIndex(file, fixtureMeta);
      for (let k = 0; k < 60; k++) {
        const a = FIRST - 2 + Math.floor(next() * (N + 4)); // includes out-of-range and reversed windows
        const b = FIRST - 2 + Math.floor(next() * (N + 4));
        for (const metric of ['incidents', 'killed', 'lethality']) {
          for (let e = 0; e < index.size; e++) {
            const got = index.value(e, metric, { from: a, to: b });
            const want = brute(file, e, metric, { from: a, to: b });
            expect(same(got, want), `seed=${seed} e=${e} ${metric} [${a},${b}] got=${got} want=${want}`).toBe(true);
          }
        }
      }
    }
  });

  it('distinguishes zero from no data', () => {
    const file: YearlyEntitySeries = {
      schemaVersion: 1,
      dim: 'country',
      firstYear: FIRST,
      lastYear: LAST,
      entities: [
        // incidents in 2005 only, value never known
        { id: 'A', label: 'A', parent: null, sum: { incidents: [0, 0, 0, 0, 0, 3, 0, 0, 0, 0], killed: Array(N).fill(0) }, known: { killed: Array(N).fill(0) } },
        // never any incident
        { id: 'B', label: 'B', parent: null, sum: { incidents: Array(N).fill(0), killed: Array(N).fill(0) }, known: { killed: Array(N).fill(0) } },
      ],
    };
    const index = new YearlyIndex(file, fixtureMeta);
    const r = { from: 2004, to: 2006 };
    expect(index.value(0, 'incidents', r)).toBe(3);
    expect(index.value(0, 'killed', r)).toBeNaN(); // incidents exist, deaths unknown → not 0
    expect(index.value(0, 'lethality', r)).toBeNaN();
    expect(index.value(1, 'incidents', r)).toBe(0);
    expect(index.value(1, 'killed', r)).toBe(0); // measured zero
    expect(index.value(1, 'lethality', r)).toBeNaN(); // mean over nothing
    // the 2003 collection gap is "no data", never 0
    expect(index.value(1, 'incidents', { from: 2003, to: 2003 })).toBeNaN();
    expect(index.value(1, 'incidents', { from: 2002, to: 2004 })).toBe(0);
  });

  it('computes a mean as a ratio of window sums, not an average of yearly means', () => {
    const killed = [10, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const known = [1, 3, 0, 0, 0, 0, 0, 0, 0, 0];
    const incidents = [1, 3, 0, 0, 0, 0, 0, 0, 0, 0];
    const file: YearlyEntitySeries = { schemaVersion: 1, dim: 'country', firstYear: FIRST, lastYear: LAST, entities: [{ id: 'A', label: 'A', parent: null, sum: { incidents, killed }, known: { killed: known } }] };
    const index = new YearlyIndex(file, fixtureMeta);
    expect(index.value(0, 'lethality', { from: 2000, to: 2001 })).toBeCloseTo(10 / 4, 12); // not (10 + 0) / 2
  });

  it('reports the gap fraction of a window and the known share', () => {
    const index = new YearlyIndex(randomFile(3), fixtureMeta);
    expect(index.gapFraction({ from: 2002, to: 2005 })).toBe(0.25);
    expect(index.gapFraction({ from: 2000, to: 2002 })).toBe(0);
    expect(index.gapFraction({ from: 2003, to: 2003 })).toBe(1);
    const share = index.knownShare(0, 'killed', { from: 2000, to: 2009 });
    expect(share).toBeGreaterThanOrEqual(0);
    expect(share).toBeLessThanOrEqual(1);
  });

  it('exposes ids and returns aligned bulk values', () => {
    const file = randomFile(5);
    const index = new YearlyIndex(file, fixtureMeta);
    expect(index.indexOf('E3')).toBe(3);
    expect(index.indexOf('nope')).toBe(-1);
    const all = index.values('incidents', { from: 2000, to: 2009 });
    expect(all).toHaveLength(7);
    expect(all[2]).toBe(index.value(2, 'incidents', { from: 2000, to: 2009 }));
  });

  it('rejects a file that does not match the dataset descriptor, naming the culprit', () => {
    const file = randomFile(9);
    const broken: YearlyEntitySeries = { ...file, entities: [{ ...(file.entities[0] as EntityRow), sum: { incidents: [1, 2, 3], killed: [0, 0, 0] } }] };
    expect(() => new YearlyIndex(broken, fixtureMeta)).toThrow(DatasetError);
    expect(() => new YearlyIndex(broken, fixtureMeta)).toThrow(/E0/);
    expect(() => new YearlyIndex({ ...file, lastYear: 2012 }, fixtureMeta)).toThrow(/axe temporel/);
  });
});
