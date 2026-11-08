import type { AppState } from '../../core/state';

type CountryState = Pick<AppState, 'pinned' | 'focus' | 'filters'>;

/**
 * The countries explored, as ISO alpha-3 codes. They are the pinned countries of the shared state
 * (what the map and the context bar write); a « country » filter, which an earlier version of this
 * view wrote, is read only when nothing is pinned, so that an old link still opens on its country.
 */
export function sharedCountryIds(state: Pick<AppState, 'pinned' | 'filters'>): string[] {
  const pinned = state.pinned.filter((ref) => ref.dim === 'country').map((ref) => ref.id);
  return pinned.length > 0 ? pinned : [...(state.filters.country ?? [])];
}

/** The filters of the shared state, with the explored countries as the « country » filter, for the incidents to match. */
export function filtersWithCountries(state: Pick<AppState, 'pinned' | 'filters'>): Readonly<Record<string, readonly string[]>> {
  const ids = sharedCountryIds(state);
  const { country: _legacy, ...others } = state.filters;
  return ids.length > 0 ? { ...others, country: ids } : others;
}

/**
 * The part of the state that makes `ids` the explored countries, as the map selects them (pinned
 * and focus, one colour slot each), or null when it already is.
 */
export function countriesPatch(state: CountryState, ids: readonly string[]): Pick<AppState, 'pinned' | 'focus'> | null {
  const current = state.pinned.filter((ref) => ref.dim === 'country').map((ref) => ref.id);
  if (current.length === ids.length && current.every((id, i) => id === ids[i])) return null;
  const last = ids[ids.length - 1];
  return {
    pinned: [...state.pinned.filter((ref) => ref.dim !== 'country'), ...ids.map((id) => ({ dim: 'country', id }))],
    focus: last === undefined ? (state.focus?.dim === 'country' ? null : state.focus) : { dim: 'country', id: last },
  };
}
