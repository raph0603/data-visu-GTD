import type { DatasetMeta } from '../../src/core/contracts';
import { parseDatasetMeta } from '../../src/core/meta';

/** Synthetic descriptor for tests only (10 years, one collection gap). It is not GTD data. */
export const fixtureMeta: DatasetMeta = parseDatasetMeta({
  schemaVersion: 1,
  id: 'fixture',
  name: 'Fixture',
  citation: null,
  license: null,
  build: { kind: 'dev-stub' },
  years: { first: 2000, last: 2009, gaps: [2003] },
  geo: { dim: 'country', idSpace: 'iso3', parentDim: 'region' },
  dimensions: [
    { id: 'country', label: 'Pays' },
    { id: 'region', label: 'Région' },
    { id: 'group', label: 'Groupe' },
    { id: 'attack', label: 'Attaque' },
  ],
  metrics: [
    { id: 'incidents', label: 'Incidents', unit: 'incidents', kind: 'count' },
    { id: 'killed', label: 'Morts', unit: 'morts', kind: 'sum' },
    { id: 'lethality', label: 'Morts par incident', unit: 'morts/incident', kind: 'mean', of: 'killed' },
  ],
  yearlyDims: ['country', 'region', 'group'],
  quality: null,
});

/** Deterministic PRNG (mulberry32) so property-style tests are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
