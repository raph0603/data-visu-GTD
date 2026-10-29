import { describe, expect, it } from 'vitest';
import type { AppState } from '../../core/state';
import { createStore } from '../../core/store';
import { clearCountries, levelOf, MAX_SELECTION, selectedCountries, toggleCountry } from './selection';

function store() {
  const initial: AppState = {
    view: 'map',
    metric: 'incidents',
    range: { from: 1970, to: 2017 },
    compare: null,
    focus: null,
    pinned: [],
    incident: null,
    filters: {},
    hover: null,
    ext: {},
  };
  return createStore<AppState>(initial);
}

describe('country selection', () => {
  it('adds countries in order, follows the last one, and stops at the maximum', () => {
    const s = store();
    for (const iso3 of ['IRQ', 'SYR', 'NGA', 'AFG']) expect(toggleCountry(s, iso3)).toBe(true);
    expect(selectedCountries(s.get())).toEqual(['IRQ', 'SYR', 'NGA', 'AFG']);
    expect(s.get().focus).toEqual({ dim: 'country', id: 'AFG' });
    expect(toggleCountry(s, 'PAK')).toBe(false);
    expect(selectedCountries(s.get())).toHaveLength(MAX_SELECTION);
    expect(levelOf(s.get())).toBe('country');
  });

  it('removes a country on a second click and empties the selection on demand', () => {
    const s = store();
    toggleCountry(s, 'IRQ');
    toggleCountry(s, 'SYR');
    toggleCountry(s, 'IRQ');
    expect(selectedCountries(s.get())).toEqual(['SYR']);
    s.set({ incident: '1', pinned: [...s.get().pinned, { dim: 'group', id: 'X' }] });
    clearCountries(s);
    expect(selectedCountries(s.get())).toEqual([]);
    expect(s.get().focus).toBeNull();
    expect(s.get().incident).toBeNull();
    expect(s.get().pinned).toEqual([{ dim: 'group', id: 'X' }]); // pins of other dimensions stay
    expect(levelOf(s.get())).toBe('world');
  });
});
