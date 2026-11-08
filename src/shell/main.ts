import '@fontsource-variable/libre-franklin';
import './style.css';
import './plate.css';
import { ContractError } from '../core/contracts';
import { createDataApi, loadDataset } from '../core/data';
import { bindHash, browserHashEnv, createHashCodec, type HashEnv } from '../core/hash';
import type { ModuleContext, ModuleHandle } from '../core/module';
import { palette } from '../core/palette';
import { defaultState, sanitizeState, type AppState } from '../core/state';
import { createStore } from '../core/store';
import { TASKS, VIEW_TASKS, type ViewId } from '../core/tasks';
import { MODULES } from '../modules';
import { createContextBar } from './context';
import { renderCover } from './cover';
import { fr, PLANCHES, plancheOf } from './planches';
import { createTimeline } from './timeline';

/**
 * Integrated shell, laid out as a thematic atlas (D23): a cover, then one plate per view, each
 * titled by its question. It loads one dataset, owns the store and the URL binding, and mounts one
 * module at a time.
 * On a plate the page does not scroll (D28): the masthead, the context bar, the view and the time
 * zone share the height of the window, and only the view's own side panels scroll.
 * Dataset selection: ?ds=<id> (default "gtd") → public/data/<id>/. It is a page-level choice, not part of
 * AppState, because changing dataset invalidates every other piece of state.
 */

type Page = 'cover' | 'planche';

/**
 * The cover is a page of the shell, not a view: VIEW_IDS are fixed in core and the empty hash already
 * means the default view. Which page an entry of the history shows is kept in history.state, so
 * that Back turns to the previous plate, then to the cover, and a reload stays where it was.
 */
function pageOf(state: unknown): Page | null {
  if (typeof state !== 'object' || state === null || !('gtdPage' in state)) return null;
  return state.gtdPage === 'cover' ? 'cover' : 'planche';
}

/** browserHashEnv, but the history entry keeps its page when the hash is rewritten. */
function shellHashEnv(win: Window): HashEnv {
  return {
    ...browserHashEnv(win),
    write(hash) {
      const url = win.location.pathname + win.location.search + (hash.length > 0 ? `#${hash}` : '');
      win.history.replaceState(win.history.state, '', url);
    },
  };
}

const ATLAS_TITLE = (meta: { years: { first: number; last: number } }) => `Atlas du terrorisme, ${meta.years.first}–${meta.years.last}`;

async function boot(root: HTMLElement): Promise<void> {
  const datasetId = new URLSearchParams(window.location.search).get('ds') ?? 'gtd';
  const meta = await loadDataset(datasetId);

  const defaults = defaultState(meta);
  const codec = createHashCodec(defaults);
  const store = createStore<AppState>(codec.decode(window.location.hash.slice(1)), { sanitize: (s) => sanitizeState(s, meta) });
  bindHash(store, codec, shellHashEnv(window));

  const ctx: ModuleContext = { store, dataset: meta, data: createDataApi(datasetId, meta), palette };
  const preparing = new Set(PLANCHES.filter((p) => MODULES[p.id].tasks.length === 0).map((p) => p.id));
  const doc = root.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    if (cls !== undefined) node.className = cls;
    if (text !== undefined) node.textContent = fr(text);
    return node;
  };

  // ------------------------------------------------------------------ header: title and folios
  root.replaceChildren();
  const skip = el('a', 'skip', 'Aller au contenu');
  skip.href = '#contenu';
  skip.addEventListener('click', (event) => {
    event.preventDefault();
    focusTitle();
  });
  const header = el('header', 'masthead');
  const title = el('a', 'atlas-title', ATLAS_TITLE(meta));
  title.href = window.location.pathname + window.location.search;
  title.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    go('cover');
  });
  const nav = el('nav', 'folios');
  nav.setAttribute('aria-label', 'Planches');
  const folios = new Map<ViewId, HTMLButtonElement>();
  for (const p of PLANCHES) {
    const b = el('button', 'folio');
    b.type = 'button';
    b.classList.toggle('is-preparing', preparing.has(p.id));
    b.append(el('span', 'folio-n', String(p.n)), el('span', 'folio-q', p.question));
    b.title = fr(`Planche ${p.n} · ${p.title}${preparing.has(p.id) ? ' (en préparation)' : ''}`);
    b.addEventListener('click', () => go('planche', p.id));
    nav.append(b);
    folios.set(p.id, b);
  }
  header.append(title, nav);
  if (meta.build.kind === 'extract') {
    const banner = el('p', 'banner', `Extrait de test (${meta.rows.total} lignes de ${meta.build.sourceFile}) : les chiffres ne sont pas ceux de la base complète.`);
    header.append(banner);
  }

  // ------------------------------------------------------------------ main: the cover or one plate
  const main = el('main');
  main.id = 'contenu';
  const planche = el('article', 'planche');
  planche.setAttribute('aria-labelledby', 'planche-titre');
  const head = el('header', 'planche-head visually-hidden');
  const heading = el('h1', 'planche-title');
  heading.id = 'planche-titre';
  heading.tabIndex = -1;
  const headingN = el('span', 'planche-n');
  const headingQ = el('span', 'planche-q');
  heading.append(headingN, headingQ);
  const name = el('p', 'planche-name');
  head.append(heading, name);
  const notice = el('section', 'preparing');
  const host = el('div', 'planche-body');
  planche.append(head, notice, host);
  main.append(planche);
  // The context bar and the time zone frame the view on every plate; the cover has neither.
  const contextSlot = el('div', 'slot-context');
  const timeSlot = el('div', 'slot-timeline');
  root.append(skip, header, contextSlot, main, timeSlot);
  const timeline = createTimeline(timeSlot, ctx);
  createContextBar(contextSlot, ctx, { onPeriod: () => timeline.focus() });

  // The GTD terms of use (section 4.a) require this citation wherever its data is shown. It is in
  // English and set as given, without French spacing.
  if (meta.dataset.citation !== null) {
    const footer = el('footer', 'colophon');
    const citation = el('p');
    citation.append(el('span', undefined, 'Source : '), doc.createTextNode(meta.dataset.citation));
    footer.append(citation);
    if (meta.dataset.license !== null) {
      const license = el('p');
      license.textContent = meta.dataset.license;
      footer.append(license);
    }
    root.append(footer);

    // On a plate the colophon is folded away: the same text opens from the masthead.
    const dialog = doc.createElement('dialog');
    dialog.className = 'sources-dialog';
    const dialogHead = el('div', 'sources-head');
    dialogHead.append(el('h2', undefined, 'Source et conditions d’utilisation'));
    const closeDialog = el('button', 'sources-close', '×');
    closeDialog.type = 'button';
    closeDialog.setAttribute('aria-label', 'Fermer');
    closeDialog.addEventListener('click', () => dialog.close());
    dialogHead.append(closeDialog);
    dialog.append(dialogHead, citation.cloneNode(true));
    if (meta.dataset.license !== null) dialog.append(el('p', undefined, meta.dataset.license));
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    const sources = el('button', 'sources-button', 'Sources');
    sources.type = 'button';
    sources.title = 'Source des données et conditions d’utilisation';
    sources.addEventListener('click', () => dialog.showModal());
    header.append(sources);
    root.append(dialog);
  }

  // ------------------------------------------------------------------ pages and plates
  let page: Page | null = null;
  let closeCover: (() => void) | null = null;
  let current: ModuleHandle | null = null;
  let mounted: ViewId | null = null;
  let token = 0;

  function focusTitle(): void {
    const target = page === 'cover' ? main.querySelector<HTMLElement>('.cover-h1') : heading;
    target?.focus({ preventScroll: true });
  }

  function turn(node: HTMLElement): void {
    node.classList.remove('is-turning');
    void node.offsetWidth;
    node.classList.add('is-turning');
  }

  function unmount(): void {
    ++token;
    current?.destroy();
    current = null;
    mounted = null;
    host.replaceChildren();
  }

  function frame(view: ViewId): void {
    const p = plancheOf(view);
    headingN.textContent = String(p.n);
    headingQ.textContent = fr(p.title);
    name.replaceChildren(doc.createTextNode(p.name));
    planche.classList.toggle('is-preparing', preparing.has(view));
    notice.replaceChildren();
    if (preparing.has(view)) {
      name.append(el('span', 'tag', 'en préparation'));
      notice.append(el('h2', 'preparing-title', 'Cette planche est en préparation. Elle répondra à :'));
      const tasks = el('ol', 'preparing-tasks');
      for (const id of VIEW_TASKS[view]) {
        const task = TASKS.find((t) => t.id === id);
        if (task === undefined) continue;
        const item = el('li');
        item.append(el('span', 'task-id', task.id), el('span', 'task-label', task.label), el('span', 'task-example', task.example));
        tasks.append(item);
      }
      // The stand-in's live state is for the team: folded away, the plate shows what it promises.
      const state = el('details', 'preparing-state');
      state.append(el('summary', undefined, 'État partagé de l’application (aide au développement)'));
      notice.append(tasks, state);
    }
    doc.title = fr(`Planche ${p.n} · ${p.title} — ${ATLAS_TITLE(meta)}`);
  }

  async function show(view: ViewId): Promise<void> {
    if (page !== 'planche') return;
    // A view without a plate (the atlas) is the map: its deepest zoom is the incident by incident reading.
    if (!PLANCHES.some((p) => p.id === view)) {
      store.set({ view: 'map' });
      return;
    }
    if (view === mounted) return;
    unmount();
    const mine = token;
    mounted = view;
    frame(view);
    updateFolios();
    turn(planche);
    try {
      const handle = await MODULES[view].mount(host, ctx);
      if (mine === token) current = handle;
      else handle.destroy();
    } catch (error) {
      if (mine !== token) return;
      const p = el('p', 'error', `Planche « ${plancheOf(view).title} » : ${error instanceof Error ? error.message : String(error)}`);
      host.append(p);
    }
  }

  function updateFolios(): void {
    const view = store.get().view;
    for (const [id, b] of folios) {
      if (page === 'planche' && id === view) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
  }

  function setPage(next: Page): void {
    if (next === page) return;
    page = next;
    root.classList.toggle('is-plate', next === 'planche');
    if (page === 'cover') {
      unmount();
      planche.hidden = true;
      const cover = el('div', 'cover-page');
      main.prepend(cover);
      const close = renderCover(cover, { meta, data: ctx.data, palette, preparing, open: (view) => go('planche', view) });
      closeCover = () => {
        close();
        cover.remove();
      };
      turn(cover);
      doc.title = ATLAS_TITLE(meta);
      updateFolios();
    } else {
      closeCover?.();
      closeCover = null;
      planche.hidden = false;
      void show(store.get().view);
    }
  }

  /** A navigation asked for by the reader: a new history entry, then focus on the new title. */
  function go(next: Page, view?: ViewId): void {
    const sameView = view === undefined || view === store.get().view;
    if (next === page && (next === 'cover' || sameView)) return;
    window.history.pushState({ gtdPage: next }, '', window.location.href);
    if (view !== undefined) store.set({ view });
    setPage(next);
    focusTitle();
    window.scrollTo({ top: 0 });
  }

  // Space plays the time zone from anywhere on a plate, except while typing or on a control that uses it.
  doc.addEventListener('keydown', (event) => {
    if (event.key !== ' ' || event.ctrlKey || event.metaKey || event.altKey || page !== 'planche') return;
    const target = event.target as HTMLElement | null;
    if (target === null || (target !== doc.body && target.tagName !== 'CANVAS')) return;
    event.preventDefault();
    timeline.togglePlay();
  });

  // popstate comes before hashchange: read the entry's state now, so the plate is mounted once.
  window.addEventListener('popstate', (event) => {
    store.set(codec.decode(window.location.hash.slice(1)));
    setPage(pageOf(event.state) ?? 'planche');
  });
  store.subscribe(
    (s) => s.view,
    (view) => {
      void show(view);
      updateFolios();
    },
  );

  const startPage = pageOf(window.history.state) ?? (window.location.hash.length > 1 ? 'planche' : 'cover');
  window.history.replaceState({ gtdPage: startPage }, '', window.location.href);
  setPage(startPage);
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
