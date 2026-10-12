import { describe, expect, it, vi } from 'vitest';
import { defaultState, sanitizeState, type AppState } from '../src/core/state';
import { createStore } from '../src/core/store';
import { fixtureMeta } from './fixtures/meta';

function makeStore(onError?: (e: unknown) => void) {
  return createStore<AppState>(defaultState(fixtureMeta), {
    sanitize: (s) => sanitizeState(s, fixtureMeta),
    ...(onError ? { onError } : {}),
  });
}

describe('store', () => {
  it('starts from a sanitized state', () => {
    const store = createStore<AppState>({ ...defaultState(fixtureMeta), range: { from: 1900, to: 3000 }, metric: 'nope' }, { sanitize: (s) => sanitizeState(s, fixtureMeta) });
    expect(store.get().range).toEqual({ from: 2000, to: 2009 });
    expect(store.get().metric).toBe('incidents');
  });

  it('notifies only when the selected slice really changes', () => {
    const store = makeStore();
    const onRange = vi.fn();
    const onMetric = vi.fn();
    store.subscribe((s) => s.range, onRange);
    store.subscribe((s) => s.metric, onMetric);

    store.set({ range: { from: 2001, to: 2004 } });
    store.set({ range: { from: 2001, to: 2004 } }); // deeply equal → no event
    expect(onRange).toHaveBeenCalledTimes(1);
    expect(onRange).toHaveBeenCalledWith({ from: 2001, to: 2004 }, { from: 2000, to: 2009 });
    expect(onMetric).not.toHaveBeenCalled();
  });

  it('keeps the reference of unchanged slices (structural sharing)', () => {
    const store = makeStore();
    store.set({ range: { from: 2001, to: 2004 } });
    const before = store.get();
    store.set({ metric: 'killed' });
    const after = store.get();
    expect(after).not.toBe(before);
    expect(after.range).toBe(before.range);
    expect(after.filters).toBe(before.filters);
  });

  it('applies the sanitizer to every update (range ordered and clamped)', () => {
    const store = makeStore();
    store.set({ range: { from: 2008, to: 1990 } });
    expect(store.get().range).toEqual({ from: 2000, to: 2008 });
    store.set({ focus: { dim: 'not_a_dim', id: 'X' } });
    expect(store.get().focus).toBeNull();
  });

  it('supports updater functions', () => {
    const store = makeStore();
    store.set((s) => ({ range: { from: s.range.from + 1, to: s.range.to } }));
    expect(store.get().range).toEqual({ from: 2001, to: 2009 });
  });

  it('freezes snapshots so a module cannot mutate shared state', () => {
    const store = makeStore();
    store.set({ pinned: [{ dim: 'country', id: 'NGA' }] });
    const state = store.get() as unknown as { range: { from: number }; pinned: { dim: string; id: string }[] };
    expect(() => {
      state.range.from = 1;
    }).toThrow(TypeError);
    expect(() => state.pinned.push({ dim: 'country', id: 'X' })).toThrow(TypeError);
  });

  it('stops notifying after unsubscribe and tracks the subscriber count', () => {
    const store = makeStore();
    const listener = vi.fn();
    const off = store.subscribe((s) => s.metric, listener);
    expect(store.subscriberCount()).toBe(1);
    off();
    expect(store.subscriberCount()).toBe(0);
    store.set({ metric: 'killed' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('can fire immediately with the current value', () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe((s) => s.metric, listener, { fireImmediately: true });
    expect(listener).toHaveBeenCalledWith('incidents', 'incidents');
  });

  it('lets listeners set state and converges (re-entrancy)', () => {
    const store = makeStore();
    // A module that mirrors the focused country into the pinned list.
    store.subscribe(
      (s) => s.focus,
      (focus) => {
        if (focus !== null) store.set((s) => ({ pinned: [...s.pinned, focus] }));
      },
    );
    const seen: number[] = [];
    store.subscribe((s) => s.pinned.length, (n) => seen.push(n));
    store.set({ focus: { dim: 'country', id: 'NGA' } });
    expect(store.get().pinned).toEqual([{ dim: 'country', id: 'NGA' }]);
    expect(seen).toEqual([1]);
  });

  it('throws on a notification cycle between modules instead of freezing the page', () => {
    const store = createStore<AppState>(defaultState(fixtureMeta), { sanitize: (s) => sanitizeState(s, fixtureMeta), maxCascade: 8, onError: () => undefined });
    // Two modules that keep flipping the metric in response to each other.
    store.subscribe((s) => s.metric, (m) => store.set({ metric: m === 'killed' ? 'incidents' : 'killed' }));
    expect(() => store.set({ metric: 'killed' })).toThrow(/cycles de notification/);
  });

  it('isolates a throwing listener from the others', () => {
    const errors: unknown[] = [];
    const store = makeStore((e) => errors.push(e));
    const healthy = vi.fn();
    store.subscribe((s) => s.metric, () => {
      throw new Error('boom');
    });
    store.subscribe((s) => s.metric, healthy);
    store.set({ metric: 'killed' });
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);
  });

  it('accepts a custom equality for derived selectors', () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe((s) => ({ m: s.metric }), listener, { equals: (a, b) => a.m === b.m });
    store.set({ range: { from: 2001, to: 2002 } });
    expect(listener).not.toHaveBeenCalled();
    store.set({ metric: 'killed' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
