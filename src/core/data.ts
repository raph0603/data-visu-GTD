import { json } from 'd3';
import {
  fetchCountryIncidents,
  fetchCountryYear,
  fetchCube,
  fetchGroupYear,
  fetchMeta,
  fetchRegionYear,
  fetchSummaries,
  fetchTopEvents,
  type CountryIncidentsFile,
  type CountryYearFile,
  type FetchJson,
  type CubeFile,
  type GroupYearFile,
  type Meta,
  type RegionYearFile,
  type SummariesFile,
  type TopEventsFile,
} from './contracts';
import { describeDataset, type DatasetMeta } from './meta';
import { fetchLeaderboard, type LeaderboardFile } from './leaderboard-data';

/** What a module may ask for. Every method is lazy, validated and memoized; modules never build URLs. */
export interface DataApi {
  /** Detailed ranking fields, loaded only by the leaderboard. */
  leaderboard(): Promise<LeaderboardFile>;
  countryYear(): Promise<CountryYearFile>;
  regionYear(): Promise<RegionYearFile>;
  groupYear(): Promise<GroupYearFile>;
  topEvents(): Promise<TopEventsFile>;
  /** Every incident aggregated by year, country, attack, target, weapon, group and suicide (D14). */
  cube(): Promise<CubeFile>;
  incidents(iso3: string): Promise<CountryIncidentsFile>;
  /** Loaded when an incident sheet opens (T10), not with the points. */
  summaries(iso3: string): Promise<SummariesFile>;
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
    leaderboard: () => memo('leaderboard', () => fetchLeaderboard(datasetId, meta, fetchJson)),
    countryYear: () => memo('agg/country_year', () => fetchCountryYear(datasetId, meta, fetchJson)),
    regionYear: () => memo('agg/region_year', () => fetchRegionYear(datasetId, meta, fetchJson)),
    groupYear: () => memo('agg/group_year', () => fetchGroupYear(datasetId, meta, fetchJson)),
    topEvents: () => memo('top_events', () => fetchTopEvents(datasetId, meta, fetchJson)),
    cube: () => memo('cube', () => fetchCube(datasetId, meta, fetchJson)),
    incidents: (iso3) => memo(`incidents/${iso3}`, () => fetchCountryIncidents(datasetId, iso3, meta, fetchJson)),
    summaries: (iso3) => memo(`summaries/${iso3}`, () => fetchSummaries(datasetId, iso3, fetchJson)),
  };
}
