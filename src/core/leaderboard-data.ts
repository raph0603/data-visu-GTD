import { json } from 'd3';
import { ContractError, dataUrl, type FetchJson, type Meta } from './contracts';

/** Lazy, dictionary-encoded incidents, including those without map coordinates. */
export const RANKING_DIMENSIONS = ['country', 'region', 'group', 'attackType', 'weaponType',
  'targetType', 'province', 'city', 'weaponSubtype', 'targetSubtype'] as const;
export type RankingDimension = typeof RANKING_DIMENSIONS[number];
export const RANKING_NUMBERS = ['killed', 'wounded', 'suicide', 'success', 'doubt'] as const;
export type RankingNumber = typeof RANKING_NUMBERS[number];
export interface LeaderboardFile {
  schemaVersion: 1;
  count: number;
  dictionaries: Record<RankingDimension, string[]>;
  columns: Record<RankingDimension, number[]> & Record<RankingNumber, (number | null)[]> & {
    eventId: string[];
    countryId: string[];
    year: number[];
  };
}

export function parseLeaderboardFile(value: unknown, meta: Meta): LeaderboardFile {
  const fail = (reason: string): never => { throw new ContractError(`leaderboard: ${reason}`); };
  if (typeof value !== 'object' || value === null) return fail('expected an object');
  const file = value as LeaderboardFile;
  if (file.schemaVersion !== 1 || file.count !== meta.rows.total) return fail('schema or incident count differs from meta.json');
  if (!file.columns || !file.dictionaries) return fail('missing columns or dictionaries');
  const column = (name: keyof LeaderboardFile['columns']): unknown[] => {
    const values: unknown = file.columns[name];
    if (!Array.isArray(values) || values.length !== file.count) return fail(`invalid column ${name}`);
    return values;
  };
  for (const dim of RANKING_DIMENSIONS) {
    const dict: unknown = file.dictionaries[dim];
    if (!Array.isArray(dict) || !dict.every((v) => typeof v === 'string')) return fail(`invalid dictionary ${dim}`);
    if (!column(dim).every((v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < dict.length)) return fail(`invalid dictionary index ${dim}`);
  }
  for (const name of ['eventId', 'countryId'] as const) {
    if (!column(name).every((v) => typeof v === 'string')) return fail(`invalid column ${name}`);
  }
  if (new Set(file.columns.eventId).size !== file.count) return fail('duplicate incident identifiers');
  if (!column('year').every((v) => typeof v === 'number' && Number.isInteger(v) && v >= meta.years.first
    && v <= meta.years.last && !meta.years.gaps.includes(v))) return fail('invalid year');
  for (const name of RANKING_NUMBERS) {
    const flag = name === 'suicide' || name === 'success' || name === 'doubt';
    if (!column(name).every((v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0
      && (!flag || v === 0 || v === 1)))) return fail(`invalid value ${name}`);
  }
  return file;
}

export async function fetchLeaderboard(dataset: string, meta: Meta, fetchJson: FetchJson = json): Promise<LeaderboardFile> {
  const url = dataUrl(dataset, 'leaderboard.json');
  try { return parseLeaderboardFile(await fetchJson(url), meta); }
  catch (error) {
    throw new Error(`Unable to load "${url}": ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
