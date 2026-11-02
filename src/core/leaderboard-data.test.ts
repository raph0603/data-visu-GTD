import { describe, expect, it, vi } from 'vitest';
import { createDataApi } from './data';
import { parseLeaderboardFile } from './leaderboard-data';
import { rankingFile, rankingMeta } from '../../test/fixtures/leaderboard';

describe('leaderboard data contract', () => {
  it('preserves measured zero, unknowns, optional flags and country identities', () => {
    const file = parseLeaderboardFile(rankingFile(), rankingMeta);
    expect(file.columns.killed).toEqual([0, null, 6]);
    expect(file.columns.doubt).toEqual([null, 0, 1]);
    expect(file.columns.countryId).toEqual(['FRA', 'NGA', 'NGA']);
  });

  it('rejects data from another build, invalid indexes, gaps and missing columns', () => {
    expect(() => parseLeaderboardFile({ ...rankingFile(), count: 2 }, rankingMeta)).toThrow('count');
    const index = rankingFile(); index.columns.group[0] = 999;
    expect(() => parseLeaderboardFile(index, rankingMeta)).toThrow('index');
    const gap = rankingFile(); gap.columns.year[0] = 2003;
    expect(() => parseLeaderboardFile(gap, rankingMeta)).toThrow('year');
    const short = rankingFile(); short.columns.killed.pop();
    expect(() => parseLeaderboardFile(short, rankingMeta)).toThrow('column killed');
    const flag = rankingFile(); flag.columns.success[0] = -9;
    expect(() => parseLeaderboardFile(flag, rankingMeta)).toThrow('success');
  });

  it('loads lazily, memoizes and retries failures through the common data API', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(rankingFile());
    const api = createDataApi('fixture', rankingMeta, fetch);
    expect(fetch).not.toHaveBeenCalled();
    await expect(api.leaderboard()).rejects.toThrow('data/fixture/leaderboard.json');
    const [a, b] = await Promise.all([api.leaderboard(), api.leaderboard()]);
    expect(a).toBe(b);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
