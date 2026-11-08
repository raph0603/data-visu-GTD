import { csv, csvParseRows, json, text } from 'd3';
import type { VizModule } from '../../core/module';
import { countryName } from '../../core/labels';
import engine from './engine.js';
import { mountRenderer, type FlowController } from './renderer.js';
import template from './template.html?raw';
import './flow.css';
import './native.css';
import './layout.css';

/** Native module: renders in host, uses the shared store and bundled D3 imports. */
const flow: VizModule = {
  id: 'flow', title: 'Modes opératoires', tasks: ['T6'],
  mount(host, ctx) {
    const doc = host.ownerDocument;
    const section = doc.createElement('section'); section.className = 'gtd-flow';
    const status = doc.createElement('p'); status.setAttribute('role', 'status');
    status.className = 'flow-status is-notice';
    status.textContent = 'Chargement du diagramme et de son CSV…';
    const resume = doc.createElement('button'); resume.type = 'button'; resume.className = 'fl-btn';
    resume.textContent = '↺ Sélection commune'; resume.disabled = true;
    resume.title = 'Retrouve la période, les pays, la mesure et les filtres des autres planches';
    const surface = doc.createElement('div'); surface.className = 'gtd-flow-surface';
    surface.append(status); section.append(surface); host.append(section);
    let alive = true;
    let controller: FlowController | null = null;
    let mapping: Array<{ iso3: string; gtd_country: string }> = [];
    let knownCountries: string[] = [];
    const abort = new AbortController();
    const send = () => {
      if (!controller) return;
      const state = ctx.store.get();
      // The explored countries are the pinned ones (the map, the context bar and the leaderboard write them).
      const countries = state.pinned.some(r => r.dim === 'country') ? state.pinned.filter(r => r.dim === 'country').map(r => r.id)
        : state.focus?.dim === 'country' ? [state.focus.id] : state.filters.country?.length ? state.filters.country : [];
      const filters: Record<string, string[]> = {};
      const dimMap: Record<string, string> = { attackType:'attack', weaponType:'weapon', targetType:'target', region:'region', group:'group', suicide:'suicide' };
      for (const [shared, local] of Object.entries(dimMap)) {
        const values = state.filters[shared];
        if (values?.length) filters[local] = shared === 'suicide'
          ? values.map(v => v === '0' ? 'Non' : v === '1' ? 'Oui' : 'Inconnu') : [...values];
      }
      const countryGroups = countries.map(id => ({ label:countryName(id),
        values:mapping.filter(r => r.iso3 === id && knownCountries.includes(r.gtd_country)).map(r => r.gtd_country) }));
      const missing = countryGroups.filter(g => !g.values.length).map(g => g.label);
      if (countries.length) {
        const names = [...new Set(countryGroups.flatMap(g => g.values))];
        filters.country = names.length ? names : ['Pays sans correspondance GTD'];
      }
      // The thickness of the ribbons follows the shared metric; « deaths per incident » has no ribbon, the last one stays.
      const metric = ({ incidents:'count', killed:'killed', wounded:'wounded' } as Record<string, string>)[state.metric];
      const applied = controller.applyShared({ period:[state.range.from, state.range.to], metric,
        compare:state.compare ? [state.compare.from, state.compare.to] : null, filters,
        countryGroups:countryGroups.filter(g => g.values.length),
        warning:missing.length ? `Pays sans correspondance : ${missing.join(', ')}. Seuls les pays reconnus sont représentés.` : '' });
      if (!applied) {
        status.textContent = 'CSV importé : exploration locale. Rétablissez le jeu intégré pour reprendre la sélection commune.';
        status.classList.add('is-notice');
      }
    };
    resume.addEventListener('click', send);
    const off = ctx.store.subscribe(s => JSON.stringify([s.range, s.compare, s.metric, s.filters, s.pinned, s.focus]), send);
    const dataset = ctx.dataset.dataset.id;
    const base = `${import.meta.env.BASE_URL}data/${encodeURIComponent(dataset)}/flow/`;
    void Promise.all([
      text(base + 'modes_operatoires.csv', { signal:abort.signal }),
      json<Record<string, unknown>>(base + 'metadata.json', { signal:abort.signal }),
      csv(base + 'mapping_pays.csv', { signal:abort.signal }),
    ]).then(([source, metadata, rows]) => {
      if (!alive) return;
      const data = engine.parseCSV(source, { csvParseRows }, 'modes_operatoires.csv');
      if (!metadata || data.meta.incidents !== metadata.incidents) throw new Error('Le total du CSV diffère des métadonnées.');
      data.meta = { ...data.meta, ...metadata, imported:false };
      mapping = rows.map(r => ({ iso3:r.iso3 ?? '', gtd_country:r.gtd_country ?? '' }));
      knownCountries = data.dicts.country ?? [];
      surface.innerHTML = template;
      surface.querySelector('#resumeSlot')?.replaceWith(resume);
      surface.querySelector('.fl-summary')?.append(status);
      status.classList.remove('is-notice');
      controller = mountRenderer(surface, data, ctx.palette, value => { if (alive) { status.textContent = value; status.classList.remove('is-notice'); } });
      wirePopovers(surface, abort.signal);
      wireLayoutToggle(surface, controller, abort.signal);
      // Instance-local inspection API: no globals, removed with the mounted view.
      Object.assign(surface, { flow:controller });
      resume.disabled = false; send();
    }).catch((error: unknown) => {
      if (!alive) return;
      status.textContent = `Sankey indisponible : ${error instanceof Error ? error.message : String(error)}`;
      status.classList.add('is-notice');
      const message = doc.createElement('p'); message.className = 'error';
      message.textContent = 'Vérifiez les trois fichiers dans public/data/<dataset>/flow/ (voir README).';
      surface.replaceChildren(status, message);
    });
    return { destroy() {
      alive = false; abort.abort(); off(); resume.removeEventListener('click', send);
      controller?.dispose(); section.remove();
    } };
  },
};

/** The settings that open as a panel under their button: one at a time, closed by a click elsewhere or Échap. */
function wirePopovers(surface: HTMLElement, signal: AbortSignal): void {
  const wraps = [...surface.querySelectorAll<HTMLElement>('.fl-popwrap')];
  const set = (wrap: HTMLElement, open: boolean) => {
    const button = wrap.querySelector<HTMLButtonElement>('.fl-btn');
    const pop = wrap.querySelector<HTMLElement>('.fl-pop');
    if (!button || !pop) return;
    pop.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.classList.toggle('is-open', open);
  };
  const closeAll = (except?: HTMLElement) => { for (const wrap of wraps) if (wrap !== except) set(wrap, false); };
  for (const wrap of wraps) {
    wrap.querySelector('.fl-btn')?.addEventListener('click', () => {
      const wasClosed = wrap.querySelector<HTMLElement>('.fl-pop')?.hasAttribute('hidden') ?? true;
      closeAll(wrap);
      set(wrap, wasClosed);
    }, { signal });
  }
  surface.ownerDocument.addEventListener('pointerdown', event => {
    if (!wraps.some(wrap => wrap.contains(event.target as Node))) closeAll();
  }, { signal });
  surface.addEventListener('keydown', event => { if (event.key === 'Escape') closeAll(); }, { signal });
}

/**
 * One button for the two readings of the same flows: horizontal columns or a circle. The renderer
 * animates the change from its own (hidden) buttons; this one only presses the right one and says
 * which reading it leads to.
 */
function wireLayoutToggle(surface: HTMLElement, controller: FlowController, signal: AbortSignal): void {
  const toggle = surface.querySelector<HTMLButtonElement>('#layoutToggle');
  const label = surface.querySelector<HTMLElement>('#geometryLabel');
  const horizontal = surface.querySelector<HTMLButtonElement>('#horizontalButton');
  const radial = surface.querySelector<HTMLButtonElement>('#radialButton');
  if (!toggle || !label || !horizontal || !radial) return;
  const sync = () => {
    const isRadial = label.textContent === 'RADIAL';
    toggle.setAttribute('aria-pressed', String(isRadial));
    toggle.title = isRadial ? 'Revenir à la disposition horizontale' : 'Passer en disposition radiale';
    const text = toggle.querySelector('.lt-text');
    if (text) text.textContent = isRadial ? 'Horizontal' : 'Radial';
  };
  const observer = new MutationObserver(sync);
  observer.observe(label, { childList: true, characterData: true, subtree: true });
  signal.addEventListener('abort', () => observer.disconnect());
  toggle.addEventListener('click', () => {
    const { morph } = controller.getState() as { morph: number };
    (morph < 50 ? radial : horizontal).click();
  }, { signal });
  sync();
}

export default flow;
