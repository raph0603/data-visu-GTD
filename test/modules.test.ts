// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { DataApi } from '../src/core/data';
import type { ModuleContext } from '../src/core/module';
import { palette } from '../src/core/palette';
import { defaultState, sanitizeState, type AppState } from '../src/core/state';
import { createStore } from '../src/core/store';
import { VIEW_IDS } from '../src/core/tasks';
import { MODULES } from '../src/modules';
import { fixtureMeta } from './fixtures/meta';
import { rankingFile, rankingMeta } from './fixtures/leaderboard';

const offline: DataApi = {
  leaderboard: () => Promise.reject(new Error('offline')),
  countryYear: () => Promise.reject(new Error('offline')),
  regionYear: () => Promise.reject(new Error('offline')),
  groupYear: () => Promise.reject(new Error('offline')),
  topEvents: () => Promise.reject(new Error('offline')),
  cube: () => Promise.reject(new Error('offline')),
  incidents: () => Promise.reject(new Error('offline')),
  summaries: () => Promise.reject(new Error('offline')),
};

function context() {
  const store = createStore<AppState>(defaultState(fixtureMeta), { sanitize: (s) => sanitizeState(s, fixtureMeta) });
  const ctx: ModuleContext = { store, dataset: fixtureMeta, data: offline, palette };
  return { store, ctx };
}

describe.each(VIEW_IDS)('module "%s" honours the integration contract', (id) => {
  it('mounts into its host, follows the shared state, and leaves nothing behind on destroy', async () => {
    const { store, ctx } = context();
    const host = document.createElement('div');
    document.body.append(host);

    const handle = await MODULES[id].mount(host, ctx);
    expect(host.childElementCount).toBeGreaterThan(0);
    expect(store.subscriberCount()).toBeGreaterThan(0);

    store.set({ range: { from: 2001, to: 2005 }, metric: 'killed', focus: { dim: 'country', id: 'NGA' }, hover: { dim: 'country', id: 'IRQ' } });
    store.set({ filters: { group: ['X'] }, compare: { from: 2006, to: 2009 }, pinned: [{ dim: 'country', id: 'NGA' }], incident: '1' });

    handle.destroy();
    expect(host.childElementCount).toBe(0);
    expect(store.subscriberCount()).toBe(0);
    host.remove();
  });

  it('declares itself consistently', () => {
    expect(MODULES[id].id).toBe(id);
    expect(MODULES[id].title.length).toBeGreaterThan(0);
  });
});

describe('leaderboard integration with the shared shell', () => {
  it('links ISO filters and metrics, clears an inherited country selection, and cleans up', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    Object.defineProperty(SVGElement.prototype, 'getTotalLength', { configurable: true, value: () => 0 });
    const store = createStore<AppState>(defaultState(rankingMeta, 'leaderboard'), { sanitize: (s) => sanitizeState(s, rankingMeta) });
    store.set({ range: { from: 2000, to: 2004 }, filters: { country: ['NGA'] }, metric: 'killed',
      ext: { 'leaderboard.aggregation': 'period' } });
    const host = document.createElement('div'); document.body.append(host);
    const ctx: ModuleContext = { store, dataset: rankingMeta, palette, data: { ...offline, leaderboard: async () => rankingFile() } };
    const handle = await MODULES.leaderboard.mount(host, ctx);
    try {
      await vi.waitFor(() => expect(host.querySelectorAll('.leaderboard-row')).toHaveLength(1));
      expect(host.querySelector('.leaderboard-row')?.getAttribute('data-value')).toBe('6');
      const country = host.querySelector<HTMLSelectElement>('#filter-country')!;
      expect(country.value).toBe('__shared__');
      country.value = ''; country.dispatchEvent(new Event('change', { bubbles: true }));
      expect(store.get().filters.country).toBeUndefined();
      expect(host.querySelectorAll('.leaderboard-row')).toHaveLength(2);
      store.set({ metric: 'wounded' });
      expect(host.querySelector<HTMLSelectElement>('#metric')?.value).toBe('injuries');
      expect(host.querySelector('.selection-summary')?.textContent).toContain('3 incidents');
      store.set({ ext: {} });
      expect(host.querySelector<HTMLSelectElement>('#aggregation')?.value).toBe('year');
      store.set({ range: { from: 2003, to: 2003 } });
      expect(host.querySelector('.selection-summary')?.textContent).toContain('Aucune donnée');
    } finally {
      handle.destroy(); host.remove(); vi.unstubAllGlobals();
      delete (SVGElement.prototype as unknown as Record<string, unknown>).getTotalLength;
    }
    expect(host.childElementCount).toBe(0);
    expect(store.subscriberCount()).toBe(0);
  });

  it('ignores a load that completes after the module has been destroyed', async () => {
    const { store, ctx } = context();
    let resolve!: (file: ReturnType<typeof rankingFile>) => void;
    const pending = new Promise<ReturnType<typeof rankingFile>>((done) => { resolve = done; });
    const host = document.createElement('div');
    const handle = await MODULES.leaderboard.mount(host, { ...ctx, data: { ...offline, leaderboard: () => pending } });
    handle.destroy(); resolve(rankingFile());
    await Promise.resolve();
    expect(host.childElementCount).toBe(0);
    expect(store.subscriberCount()).toBe(0);
  });
});
