import { describe, expect, it } from 'vitest';
import { MODULES } from '../modules';
import { PLANCHES } from './planches';

describe('PLANCHES', () => {
  it('numbers the plates 1 to n in reading order, each mounted by a registered module', () => {
    expect(PLANCHES.map((p) => p.n)).toEqual(PLANCHES.map((_, i) => i + 1));
    for (const p of PLANCHES) expect(MODULES[p.id].id).toBe(p.id);
  });

  it('has no plate for the atlas: its reading lives in the map', () => {
    expect(PLANCHES.map((p) => p.id)).toEqual(['map', 'flow', 'leaderboard']);
  });
});
