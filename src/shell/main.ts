import './style.css';
import { ContractError } from '../core/contracts';
import { createDataApi, loadDataset } from '../core/data';
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
  const meta = await loadDataset(datasetId);

  const defaults = defaultState(meta);
  const codec = createHashCodec(defaults);
  const store = createStore<AppState>(codec.decode(window.location.hash.slice(1)), { sanitize: (s) => sanitizeState(s, meta) });
  bindHash(store, codec, browserHashEnv());

  const ctx: ModuleContext = { store, dataset: meta, data: createDataApi(datasetId, meta), palette };

  root.replaceChildren();
  const header = document.createElement('header');
  const heading = document.createElement('h1');
  heading.textContent = meta.dataset.title;
  const tabs = document.createElement('nav');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Vues');
  header.append(heading, tabs);
  if (meta.build.kind === 'extract') {
    const banner = document.createElement('p');
    banner.className = 'banner';
    banner.textContent = `Extrait de test (${meta.rows.total} lignes de ${meta.build.sourceFile}) : les chiffres ne sont pas ceux de la base complète.`;
    header.append(banner);
  }
  const host = document.createElement('main');
  root.append(header, host);
  // The GTD terms of use (section 4.a) require this citation wherever its data is shown.
  if (meta.dataset.citation !== null) {
    const footer = document.createElement('footer');
    const source = document.createElement('p');
    source.textContent = `Source : ${meta.dataset.citation}`;
    footer.append(source);
    if (meta.dataset.license !== null) {
      const license = document.createElement('p');
      license.textContent = meta.dataset.license;
      footer.append(license);
    }
    root.append(footer);
  }

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
    const message = error instanceof Error ? error.message : String(error);
    p.textContent =
      error instanceof Error && error.cause instanceof ContractError
        ? `Données illisibles — ${message}`
        : `Données introuvables — ${message}. Générez-les avec : python preprocess/preprocess.py`;
    root.replaceChildren(p);
  });
}
