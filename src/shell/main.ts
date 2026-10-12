import './style.css';
import { createDataApi, fetchMeta } from '../core/data';
import { DatasetError } from '../core/meta';
import { bindHash, browserHashEnv, createHashCodec } from '../core/hash';
import type { ModuleContext, ModuleHandle } from '../core/module';
import { palette } from '../core/palette';
import { defaultState, sanitizeState, type AppState } from '../core/state';
import { createStore } from '../core/store';
import { VIEW_IDS, VIEW_LABELS, type ViewId } from '../core/tasks';
import { MODULES } from '../modules';

/**
 * Integrated shell: loads one dataset, owns the store and the URL binding, mounts one module at a time.
 * Dataset selection: ?ds=<id> (default "gtd") → public/data/<id>/. It is a page-level choice, not part of
 * AppState, because changing dataset invalidates every other piece of state.
 */
async function boot(root: HTMLElement): Promise<void> {
  const datasetId = new URLSearchParams(window.location.search).get('ds') ?? 'gtd';
  const baseUrl = `${import.meta.env.BASE_URL}data/${encodeURIComponent(datasetId)}`.replace(/^\.\//, '');
  const meta = await fetchMeta(baseUrl);

  const defaults = defaultState(meta);
  const codec = createHashCodec(defaults);
  const store = createStore<AppState>(codec.decode(window.location.hash.slice(1)), { sanitize: (s) => sanitizeState(s, meta) });
  bindHash(store, codec, browserHashEnv());

  const ctx: ModuleContext = { store, dataset: meta, data: createDataApi(baseUrl), palette };

  root.replaceChildren();
  const header = document.createElement('header');
  const heading = document.createElement('h1');
  heading.textContent = meta.name;
  const tabs = document.createElement('nav');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Vues');
  header.append(heading, tabs);
  if (meta.build.kind === 'dev-stub') {
    const banner = document.createElement('p');
    banner.className = 'banner';
    banner.textContent = 'Descripteur de développement : aucune donnée agrégée chargée (Phase 2 non exécutée).';
    header.append(banner);
  }
  const host = document.createElement('main');
  root.append(header, host);

  const buttons = new Map<ViewId, HTMLButtonElement>();
  for (const id of VIEW_IDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.textContent = VIEW_LABELS[id];
    b.addEventListener('click', () => store.set({ view: id }));
    tabs.append(b);
    buttons.set(id, b);
  }

  let current: ModuleHandle | null = null;
  let token = 0;
  async function show(view: ViewId): Promise<void> {
    const mine = ++token;
    for (const [id, b] of buttons) b.setAttribute('aria-selected', String(id === view));
    current?.destroy();
    current = null;
    host.replaceChildren();
    try {
      const handle = await MODULES[view].mount(host, ctx);
      if (mine === token) current = handle;
      else handle.destroy();
    } catch (error) {
      const p = document.createElement('p');
      p.className = 'error';
      p.textContent = `Module "${view}" : ${error instanceof Error ? error.message : String(error)}`;
      host.append(p);
    }
  }

  store.subscribe((s) => s.view, (view) => void show(view));
  await show(store.get().view);
}

const root = document.getElementById('app');
if (root !== null) {
  boot(root).catch((error: unknown) => {
    const p = document.createElement('p');
    p.className = 'error';
    p.textContent =
      error instanceof DatasetError
        ? `Données illisibles — ${error.message}`
        : `Erreur au démarrage — ${error instanceof Error ? error.message : String(error)}`;
    root.replaceChildren(p);
  });
}
