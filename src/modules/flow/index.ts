import { csv, csvParseRows, json, text } from 'd3';
import type { VizModule } from '../../core/module';
import { countryName } from '../../core/labels';
import engine from './engine.js';
import { mountRenderer, type FlowController } from './renderer.js';
import template from './template.html?raw';
import './flow.css';
import './native.css';

/** Native module: renders in host, uses the shared store and bundled D3 imports. */
const flow: VizModule = {
  id: 'flow', title: 'Modes opératoires', tasks: ['T6'],
  mount(host, ctx) {
    const doc = host.ownerDocument;
    const section = doc.createElement('section'); section.className = 'gtd-flow';
    const tools = doc.createElement('div'); tools.className = 'gtd-flow-tools';
    const status = doc.createElement('p'); status.setAttribute('role', 'status');
    status.textContent = 'Chargement du diagramme et de son CSV…';
    const resume = doc.createElement('button'); resume.type = 'button';
    resume.textContent = 'Reprendre la sélection commune'; resume.disabled = true;
    const surface = doc.createElement('div'); surface.className = 'gtd-flow-surface';
    tools.append(status, resume); section.append(tools, surface); host.append(section);
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
      if (!applied) status.textContent = 'CSV importé : exploration locale. Rétablissez le jeu intégré pour reprendre la sélection commune.';
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
      controller = mountRenderer(surface, data, ctx.palette, value => { if (alive) status.textContent = value; });
      // Instance-local inspection API: no globals, removed with the mounted view.
      Object.assign(surface, { flow:controller });
      resume.disabled = false; send();
    }).catch((error: unknown) => {
      if (!alive) return;
      status.textContent = `Sankey indisponible : ${error instanceof Error ? error.message : String(error)}`;
      const message = doc.createElement('p'); message.className = 'error';
      message.textContent = 'Vérifiez les trois fichiers dans public/data/<dataset>/flow/ (voir README).';
      surface.replaceChildren(message);
    });
    return { destroy() {
      alive = false; abort.abort(); off(); resume.removeEventListener('click', send);
      controller?.dispose(); section.remove();
    } };
  },
};
export default flow;
