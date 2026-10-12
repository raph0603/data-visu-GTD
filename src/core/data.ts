import { json } from 'd3';
import {
  fetchCountryIncidents,
  fetchCountryYear,
  fetchMeta,
  fetchRegionYear,
  fetchTopEvents,
  type CountryIncidentsFile,
  type CountryYearFile,
  type FetchJson,
  type Meta,
  type RegionYearFile,
  type TopEventsFile,
} from './contracts';
import { describeDataset, type DatasetMeta } from './meta';

/** What a module may ask for. Every method is lazy, validated and memoized; modules never build URLs. */
export interface DataApi {
  countryYear(): Promise<CountryYearFile>;
  regionYear(): Promise<RegionYearFile>;
  topEvents(): Promise<TopEventsFile>;
  incidents(iso3: string): Promise<CountryIncidentsFile>;
}

export async function loadDataset(datasetId: string, fetchJson: FetchJson = json): Promise<DatasetMeta> {
  return describeDataset(await fetchMeta(datasetId, fetchJson));
}

/**
 * Loader over the files of contracts.ts. Each file is validated against `meta` by its parser.
 * Promises are memoized per file; a rejected promise is evicted so a retry can succeed.
 */
export function createDataApi(datasetId: string, meta: Meta, fetchJson: FetchJson = json): DataApi {
  const cache = new Map<string, Promise<unknown>>();

  function memo<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit !== undefined) return hit as Promise<T>;
    const promise = load();
    cache.set(key, promise);
    promise.catch(() => cache.delete(key));
    return promise;
  }

  return {
    countryYear: () => memo('agg/country_year', () => fetchCountryYear(datasetId, meta, fetchJson)),
    regionYear: () => memo('agg/region_year', () => fetchRegionYear(datasetId, meta, fetchJson)),
    topEvents: () => memo('top_events', () => fetchTopEvents(datasetId, meta, fetchJson)),
    incidents: (iso3) => memo(`incidents/${iso3}`, () => fetchCountryIncidents(datasetId, iso3, meta, fetchJson)),
  };
}
