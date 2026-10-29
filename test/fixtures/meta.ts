import { parseMeta } from '../../src/core/contracts';
import { describeDataset, type DatasetMeta } from '../../src/core/meta';

/** Synthetic meta.json for tests only (10 years, one collection gap). It is not GTD data. */
export const fixtureMetaJson = {
  schemaVersion: 1,
  dataset: { id: 'fixture', title: 'Fixture', citation: null, license: null },
  build: { kind: 'preprocessed', sourceFile: 'fixture.csv', sourceSha256: '0'.repeat(64), sourceEncoding: 'cp1252' },
  years: { first: 2000, last: 2009, gaps: [2003] },
  rows: { total: 100, withoutGeo: 2, withoutCoordinates: 5 },
  quality: { killedKnownShare: 0.9, woundedKnownShare: 0.8, unknownGroupShare: 0.5, withoutCoordinatesShare: 0.05 },
};

export const fixtureMeta: DatasetMeta = describeDataset(parseMeta(structuredClone(fixtureMetaJson)));

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
