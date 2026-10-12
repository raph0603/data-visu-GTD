import { SCHEMA_VERSION, type DatasetMeta, type FlowCube, type IncidentTable, type TopEventsFile, type YearlyEntitySeries } from './contracts';
import { DatasetError, parseDatasetMeta } from './meta';

/** What a module may ask for. Every method is lazy, typed and memoized; modules never build URLs. */
export interface DataApi {
  yearly(dim: string): Promise<YearlyEntitySeries>;
  topEvents(): Promise<TopEventsFile>;
  incidents(geoId: string): Promise<IncidentTable>;
  flow(): Promise<FlowCube>;
}

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}
export type FetchLike = (url: string) => Promise<FetchResponseLike>;

async function getJson(url: string, fetchImpl: FetchLike): Promise<unknown> {
  let response: FetchResponseLike;
  try {
    response = await fetchImpl(url);
  } catch (cause) {
    throw new DatasetError(url, `échec réseau (${cause instanceof Error ? cause.message : String(cause)})`);
  }
  if (!response.ok) throw new DatasetError(url, `HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new DatasetError(url, 'JSON invalide');
  }
}

export async function fetchMeta(baseUrl: string, fetchImpl: FetchLike = (u) => fetch(u)): Promise<DatasetMeta> {
  return parseDatasetMeta(await getJson(`${baseUrl}/meta.json`, fetchImpl));
}

/**
 * Loader over the file layout documented in contracts.ts.
 * Promises are memoized per URL; a rejected promise is evicted so a retry can succeed.
 * Only `schemaVersion` is checked at runtime here; structural validation of the large files is
 * covered by the preprocessing tests (Phase 2) to keep the client lean.
 */
export function createDataApi(baseUrl: string, fetchImpl: FetchLike = (u) => fetch(u)): DataApi {
  const cache = new Map<string, Promise<unknown>>();

  function load<T extends { readonly schemaVersion: number }>(path: string): Promise<T> {
    const url = `${baseUrl}/${path}`;
    const hit = cache.get(url);
    if (hit !== undefined) return hit as Promise<T>;
    const promise = getJson(url, fetchImpl).then((json) => {
      const version = (json as { schemaVersion?: unknown } | null)?.schemaVersion;
      if (version !== SCHEMA_VERSION) {
        throw new DatasetError(url, `schemaVersion ${String(version)} non supportée (attendu ${SCHEMA_VERSION})`);
      }
      return json as T;
    });
    cache.set(url, promise);
    promise.catch(() => cache.delete(url));
    return promise;
  }

  return {
    yearly: (dim) => load<YearlyEntitySeries>(`agg/${encodeURIComponent(dim)}_year.json`),
    topEvents: () => load<TopEventsFile>('top_events.json'),
    incidents: (geoId) => load<IncidentTable>(`incidents/${encodeURIComponent(geoId)}.json`),
    flow: () => load<FlowCube>('flow.json'),
  };
}
