import { RANKING_DIMENSIONS, type LeaderboardFile } from '../../src/core/leaderboard-data';
import { fixtureMeta } from './meta';

export const rankingMeta = { ...fixtureMeta, rows: { ...fixtureMeta.rows, total: 3 } };
export function rankingFile(): LeaderboardFile {
  const dictionaries = Object.fromEntries(RANKING_DIMENSIONS.map((dim) => [dim, ['Unknown']])) as LeaderboardFile['dictionaries'];
  const dimensions = Object.fromEntries(RANKING_DIMENSIONS.map((dim) => [dim, [0, 0, 0]])) as Record<typeof RANKING_DIMENSIONS[number], number[]>;
  dictionaries.country = ['France', 'Nigeria'];
  dictionaries.group = ['Unknown', 'Group A'];
  return {
    schemaVersion: 1, count: 3, dictionaries,
    columns: { ...dimensions, country: [0, 1, 1], group: [0, 1, 1], countryId: ['FRA', 'NGA', 'NGA'],
      eventId: ['1', '2', '3'], year: [2000, 2001, 2004], killed: [0, null, 6], wounded: [2, 3, null],
      suicide: [0, 1, 0], success: [1, 0, null], doubt: [null, 0, 1] },
  };
}
