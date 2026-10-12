import { describe, expect, it, vi } from 'vitest';
import { createDataApi, fetchMeta, type FetchLike } from '../src/core/data';
import { DatasetError, parseDatasetMeta } from '../src/core/meta';

function okJson(body: unknown): ReturnType<FetchLike> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

describe('createDataApi', () => {
  it('builds the documented URLs and memoizes in-flight and settled requests', async () => {
    const fetchImpl = vi.fn<FetchLike>(() => okJson({ schemaVersion: 1, dim: 'country' }));
    const api = createDataApi('data/gtd', fetchImpl);
    const [a, b] = await Promise.all([api.yearly('country'), api.yearly('country')]);
    expect(a).toBe(b);
    await api.yearly('country');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('data/gtd/agg/country_year.json');

    await api.incidents('CÔTE/1');
    await api.topEvents();
    await api.flow();
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      'data/gtd/agg/country_year.json',
      'data/gtd/incidents/C%C3%94TE%2F1.json',
      'data/gtd/top_events.json',
      'data/gtd/flow.json',
    ]);
  });

  it('rejects a bad status, a network error and a schemaVersion mismatch with the URL in the message', async () => {
    const notFound = createDataApi('d', () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) }));
    await expect(notFound.flow()).rejects.toThrow(/d\/flow\.json: HTTP 404/);

    const offline = createDataApi('d', () => Promise.reject(new Error('offline')));
    await expect(offline.flow()).rejects.toThrow(/échec réseau \(offline\)/);

    const old = createDataApi('d', () => okJson({ schemaVersion: 0 }));
    await expect(old.flow()).rejects.toBeInstanceOf(DatasetError);
    await expect(old.flow()).rejects.toThrow(/schemaVersion 0/);
  });

  it('evicts a failed request so a retry can succeed', async () => {
    let calls = 0;
    const api = createDataApi('d', () => (++calls === 1 ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve(null) }) : okJson({ schemaVersion: 1 })));
    await expect(api.flow()).rejects.toThrow();
    await expect(api.flow()).resolves.toMatchObject({ schemaVersion: 1 });
    expect(calls).toBe(2);
  });
});

describe('parseDatasetMeta', () => {
  const valid = {
    schemaVersion: 1,
    id: 'x',
    name: 'X',
    citation: null,
    license: null,
    build: { kind: 'dev-stub' },
    years: { first: 2000, last: 2002, gaps: [2001] },
    geo: { dim: 'country', idSpace: 'iso3', parentDim: null },
    dimensions: [{ id: 'country', label: 'Pays' }],
    metrics: [
      { id: 'n', label: 'N', unit: 'u', kind: 'count' },
      { id: 's', label: 'S', unit: 'u', kind: 'sum' },
    ],
    yearlyDims: ['country'],
    quality: null,
  };

  it('accepts a valid descriptor', () => {
    expect(parseDatasetMeta(valid).id).toBe('x');
  });

  const cases: [string, (m: typeof valid) => unknown, RegExp][] = [
    ['unknown schema version', (m) => ({ ...m, schemaVersion: 2 }), /meta\.schemaVersion/],
    ['inverted years', (m) => ({ ...m, years: { first: 2002, last: 2000, gaps: [] } }), /meta\.years/],
    ['gap outside the axis', (m) => ({ ...m, years: { first: 2000, last: 2002, gaps: [1999] } }), /meta\.years\.gaps\[0\]/],
    ['two count metrics', (m) => ({ ...m, metrics: [...m.metrics, { id: 'm', label: 'M', unit: 'u', kind: 'count' }] }), /exactement une métrique "count"/],
    ['mean of a non-sum', (m) => ({ ...m, metrics: [...m.metrics, { id: 'r', label: 'R', unit: 'u', kind: 'mean', of: 'n' }] }), /doit désigner une métrique "sum"/],
    ['geo dim missing from dimensions', (m) => ({ ...m, geo: { dim: 'state', idSpace: 'iso3', parentDim: null } }), /meta\.geo\.dim/],
    ['yearlyDims without the geo dim', (m) => ({ ...m, dimensions: [...m.dimensions, { id: 'group', label: 'G' }], yearlyDims: ['group'] }), /meta\.yearlyDims/],
    ['bad identifier', (m) => ({ ...m, id: 'Bad Id' }), /meta\.id/],
    ['not an object', () => 'nope', /meta: objet attendu/],
  ];
  it.each(cases)('rejects: %s', (_name, mutate, pattern) => {
    expect(() => parseDatasetMeta(mutate(structuredClone(valid)))).toThrow(pattern);
  });

  it('loads and parses meta.json through fetchMeta', async () => {
    const meta = await fetchMeta('data/x', () => okJson(valid));
    expect(meta.years.gaps).toEqual([2001]);
  });
});
