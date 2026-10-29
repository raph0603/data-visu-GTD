import type { AppState, EntityRef } from '../../core/state';
import type { Store } from '../../core/store';

/**
 * The selected countries live in AppState.pinned (dim "country"), in the order they were added; the
 * last one added is also AppState.focus, the country the atlas follows. Four at most: one identity
 * colour each among the non-blue colours of the palette (blue carries magnitude), and four columns
 * still fit side by side in the panel (D20).
 */
export const MAX_SELECTION = 4;

export type Level = 'world' | 'country' | 'incident';

/** World: no selection. Country: one to four selected countries. Incident: a sheet is open. */
export function levelOf(state: AppState): Level {
  if (state.incident !== null) return 'incident';
  return selectedCountries(state).length > 0 ? 'country' : 'world';
}

export function selectedCountries(state: AppState): string[] {
  return state.pinned.filter((r) => r.dim === 'country').map((r) => r.id).slice(0, MAX_SELECTION);
}

/** Adds or removes a country. Returns false when the selection is already full. */
export function toggleCountry(store: Store<AppState>, iso3: string): boolean {
  const current = selectedCountries(store.get());
  if (current.includes(iso3)) {
    setSelection(store, current.filter((id) => id !== iso3));
    return true;
  }
  if (current.length >= MAX_SELECTION) return false;
  setSelection(store, [...current, iso3]);
  return true;
}

/** Empties the selection (and closes the incident sheet). */
export function clearCountries(store: Store<AppState>): void {
  setSelection(store, []);
}

function setSelection(store: Store<AppState>, iso3s: readonly string[]): void {
  const last = iso3s[iso3s.length - 1];
  store.set((s) => ({
    pinned: [...s.pinned.filter((r) => r.dim !== 'country'), ...iso3s.map(ref)],
    focus: last === undefined ? (s.focus?.dim === 'country' ? null : s.focus) : ref(last),
    incident: iso3s.length === 0 ? null : s.incident,
  }));
}

function ref(iso3: string): EntityRef {
  return { dim: 'country', id: iso3 };
}

/**
 * Colour slots that follow the country, not its position: removing the first country does not
 * repaint the others. A newly selected country takes the lowest free slot.
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
