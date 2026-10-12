import { describe, expect, it, vi } from 'vitest';
import { ContractError, METRICS, type FetchJson } from '../src/core/contracts';
import { createDataApi, loadDataset } from '../src/core/data';
import { fixtureMeta, fixtureMetaJson } from './fixtures/meta';

/** An empty region_year.json for the fixture years: the smallest file every parser accepts. */
const regionYear = { schemaVersion: 1, years: { first: 2000, last: 2009 }, entities: {} };

describe('createDataApi', () => {
  it('builds the documented URLs and memoizes in-flight and settled requests', async () => {
    const fetchJson = vi.fn<FetchJson>(() => Promise.resolve(structuredClone(regionYear)));
    const api = createDataApi('gtd', fixtureMeta, fetchJson);
    const [a, b] = await Promise.all([api.regionYear(), api.regionYear()]);
    expect(a).toBe(b);
    await api.regionYear();
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson).toHaveBeenCalledWith('data/gtd/agg/region_year.json');

    await Promise.allSettled([api.countryYear(), api.topEvents(), api.incidents('NGA')]);
    expect(fetchJson.mock.calls.map((c) => c[0])).toEqual([
      'data/gtd/agg/region_year.json',
      'data/gtd/agg/country_year.json',
      'data/gtd/top_events.json',
      'data/gtd/incidents/NGA.json',
    ]);
  });

  it('rejects a network error and an invalid file with the URL in the message', async () => {
    const offline = createDataApi('d', fixtureMeta, () => Promise.reject(new Error('offline')));
    await expect(offline.regionYear()).rejects.toThrow(/data\/d\/agg\/region_year\.json.*offline/);

    const wrongYears = createDataApi('d', fixtureMeta, () => Promise.resolve({ ...regionYear, years: { first: 1990, last: 2009 } }));
    const error: unknown = await wrongYears.regionYear().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).cause).toBeInstanceOf(ContractError);
    expect((error as Error).message).toMatch(/region_year\.json.*years/);
  });

  it('evicts a failed request so a retry can succeed', async () => {
    let calls = 0;
    const api = createDataApi('d', fixtureMeta, () => (++calls === 1 ? Promise.reject(new Error('HTTP 500')) : Promise.resolve(structuredClone(regionYear))));
    await expect(api.regionYear()).rejects.toThrow();
    await expect(api.regionYear()).resolves.toMatchObject({ schemaVersion: 1 });
    expect(calls).toBe(2);
  });
});

describe('loadDataset', () => {
  it('validates meta.json and adds the interface vocabulary', async () => {
    const meta = await loadDataset('fixture', () => Promise.resolve(structuredClone(fixtureMetaJson)));
    expect(meta.years.gaps).toEqual([2003]);
    expect(meta.metrics.map((m) => m.id)).toEqual([...METRICS]);
    expect(meta.metrics.filter((m) => m.kind === 'count')).toHaveLength(1);
    expect(new Set(meta.dimensions.map((d) => d.id)).size).toBe(meta.dimensions.length);
  });

  it('rejects a meta.json of another dataset', async () => {
    await expect(loadDataset('gtd', () => Promise.resolve(structuredClone(fixtureMetaJson)))).rejects.toThrow(/dataset\.id/);
  });
});
