// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { DataApi } from '../src/core/data';
import type { ModuleContext } from '../src/core/module';
import { palette } from '../src/core/palette';
import { defaultState, sanitizeState, type AppState } from '../src/core/state';
import { createStore } from '../src/core/store';
import { VIEW_IDS } from '../src/core/tasks';
import { MODULES } from '../src/modules';
import { fixtureMeta } from './fixtures/meta';

const offline: DataApi = {
  countryYear: () => Promise.reject(new Error('offline')),
  regionYear: () => Promise.reject(new Error('offline')),
  topEvents: () => Promise.reject(new Error('offline')),
  incidents: () => Promise.reject(new Error('offline')),
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
