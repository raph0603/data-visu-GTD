import type { AppState, EntityRef } from '../../core/state';
import type { Store } from '../../core/store';

/**
 * The compared countries live in AppState.pinned (dim "country"), so that the leaderboard and the URL
 * share them. Six at most: one categorical colour each, never a generated seventh.
 */
export const MAX_SELECTION = 6;

export function selectedCountries(state: AppState): string[] {
  return state.pinned.filter((ref) => ref.dim === 'country').map((ref) => ref.id).slice(0, MAX_SELECTION);
}

export function isSelected(state: AppState, iso3: string): boolean {
  return selectedCountries(state).includes(iso3);
}

/**
 * Adds or removes a country. An added country becomes the focus (read by the atlas); removing the
 * focused one moves the focus to the last remaining country. Returns false when the selection is full.
 */
export function toggleCountry(store: Store<AppState>, iso3: string): boolean {
  const state = store.get();
  const others = state.pinned.filter((ref) => ref.dim !== 'country');
  const current = selectedCountries(state);
  if (current.includes(iso3)) {
    const kept = current.filter((id) => id !== iso3);
    const last = kept[kept.length - 1];
    const focus = state.focus?.dim === 'country' && state.focus.id === iso3 ? (last === undefined ? null : ref(last)) : state.focus;
    store.set({ pinned: [...others, ...kept.map(ref)], focus });
    return true;
  }
  if (current.length >= MAX_SELECTION) return false;
  store.set({ pinned: [...others, ...current.map(ref), ref(iso3)], focus: ref(iso3) });
  return true;
}

export function clearCountries(store: Store<AppState>): void {
  const state = store.get();
  store.set({ pinned: state.pinned.filter((r) => r.dim !== 'country'), focus: state.focus?.dim === 'country' ? null : state.focus });
}

function ref(iso3: string): EntityRef {
  return { dim: 'country', id: iso3 };
}

/**
 * Colour slots that follow the country, not its position: removing the second country does not
 * repaint the third. A newly selected country takes the lowest free slot.
 */
export class SlotKeeper {
  private readonly slots = new Map<string, number>();

  assign(selected: readonly string[]): ReadonlyMap<string, number> {
    for (const iso3 of [...this.slots.keys()]) if (!selected.includes(iso3)) this.slots.delete(iso3);
    for (const iso3 of selected) {
      if (this.slots.has(iso3)) continue;
      const used = new Set(this.slots.values());
      let slot = 0;
      while (used.has(slot)) slot++;
      this.slots.set(iso3, slot);
    }
    return this.slots;
  }
}
