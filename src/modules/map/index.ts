import { select } from 'd3';
import { loadCountryAtlas } from '../../core/geo';
import type { ModuleContext, ModuleHandle, VizModule } from '../../core/module';
import { createComparePanel, type ComparePanel } from './compare';
import { createComposition, type Composition } from './composition';
import { createFilterBar, type FilterBar } from './filterbar';
import { formatCount, formatRange } from './format';
import { buildFrame, createEnv, type Env } from './frame';
import { createGroups, type Groups } from './groups';
import { createIncidentPanel, type IncidentPanel } from './incidentpanel';
import { IncidentFiles } from './incidents';
import { createKpis, type Kpis } from './kpis';
import { CountryModel, FILTER_DIMS, readFilters, type FilterDim } from './model';
import { createRace, type Race } from './race';
import { createFlow, type Flow } from './sankey';
import { SlotKeeper } from './selection';
import { createTimeSeries, type TimeSeries } from './timeseries';
import { card, Tooltip } from './ui';
import { createProjection, createWorldMap, type WorldMap } from './worldmap';
import './map.css';

interface Panels {
  readonly filters: FilterBar;
  readonly kpis: Kpis;
  readonly map: WorldMap;
  readonly compare: ComparePanel;
  readonly series: TimeSeries;
  readonly composition: Composition;
  readonly flow: Flow;
  readonly race: Race;
  readonly groups: Groups;
  readonly incidents: IncidentPanel;
}

const NO_FILTERS = readFilters({});

type Counts = Record<FilterDim, Map<string, number>>;
const emptyCounts = (): Counts => ({ attackType: new Map(), targetType: new Map(), weaponType: new Map(), group: new Map() });

/**
 * The country view: everything about countries, linked together. A filter row scopes every panel;
 * the map shows the filtered metric by country, the exact incidents and the organizations that link
 * the selected countries; up to six countries are compared in figures, curves, operating profiles,
 * a moving ranking, a flow diagram, their organizations and their deadliest incidents.
 */
const mapModule: VizModule = {
  id: 'map',
  title: 'Carte par pays',
  tasks: ['T1', 'T3', 'T4', 'T9', 'T12'],
  mount(host: HTMLElement, ctx: ModuleContext): ModuleHandle {
    const { store, dataset, palette, data } = ctx;
    const view = select(host).append('section').attr('class', 'cv');
    const status = view.append('p').attr('class', 'cv-status').text('Chargement des données…');
    const tooltip = new Tooltip(view);
    const footnote = view.append('p').attr('class', 'cv-footnote');

    let alive = true;
    let env: Env | null = null;
    let panels: Panels | null = null;
    const slots = new SlotKeeper();
    let scheduled = false;
    let countsKey = '';
    let counts = emptyCounts();

    function render(): void {
      scheduled = false;
      if (!alive || env === null || panels === null) return;
      const { model } = env;
      const state = store.get();
      const frame = buildFrame(env, state, slots);

      // Option counts of the filter lists: the window and the selection, without any filter.
      const key = `${state.range.from}-${state.range.to}|${frame.selectedIdx.join(',')}`;
      if (key !== countsKey) {
        countsKey = key;
        const scan = model.scan(NO_FILTERS, state.range, frame.selectedIdx);
        counts = emptyCounts();
        for (const [g, t] of scan.combined.group) counts.group.set(model.dict.group[g] ?? '', t.incidents);
        for (const dim of ['attackType', 'targetType', 'weaponType'] as const) {
          scan.combined[dim].forEach((t, i) => counts[dim].set(model.dict[dim][i] ?? '', t.incidents));
        }
      }
      // A filtered value stays listed even with no incident in the window, so it can be removed.
      for (const dim of FILTER_DIMS) for (const value of frame.filters[dim] ?? []) if (!counts[dim].has(value)) counts[dim].set(value, 0);

      panels.filters.update(frame, counts);
      panels.kpis.update(frame);
      panels.map.update(frame);
      panels.compare.update(frame);
      panels.series.update(frame);
      panels.composition.update(frame);
      panels.flow.update(frame);
      panels.race.update(frame);
      panels.groups.update(frame);
      panels.incidents.update(frame);
      highlight();

      const rest = model.countryOf('');
      const hidden = rest < 0 ? 0 : model.totals(frame.table, [rest], state.range).incidents;
      footnote.text(
        `${formatCount(hidden)} incident(s) de ${formatRange(state.range)} sans pays représentable (URSS, Yougoslavie, Tchécoslovaquie, ` +
          'Serbie-Monténégro, Kosovo, « International ») : absents de la carte, comptés dans les chiffres du monde.',
      );
    }

    // Several slices often change in one interaction: render once, after the store settles.
    function schedule(): void {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(render);
    }

    function highlight(): void {
      if (panels === null) return;
      const hover = store.get().hover;
      const hovered = hover?.dim === 'country' ? hover.id : null;
      panels.map.highlight(hovered);
      panels.compare.highlight(hovered);
      panels.race.highlight(hovered);
    }

    const offs = [
      store.subscribe((s) => s.metric, schedule),
      store.subscribe((s) => s.range, schedule),
      store.subscribe((s) => s.compare, schedule),
      store.subscribe((s) => s.filters, schedule),
      store.subscribe((s) => s.pinned, schedule),
      store.subscribe((s) => s.incident, schedule),
      store.subscribe((s) => s.ext, schedule),
      store.subscribe((s) => s.hover, highlight),
    ];

    Promise.all([loadCountryAtlas(), data.countryYear(), data.cube()])
      .then(([atlas, countries, cube]) => {
        if (!alive) return;
        status.remove();
        const model = new CountryModel(cube, dataset.years.gaps);
        const built = createEnv({ store, dataset, palette, data, model, countries, tooltip });
        env = built;
        const projection = createProjection();
        const files = new IncidentFiles(data, projection);

        const filters = createFilterBar(view, built);
        const kpis = createKpis(view, built);
        const main = view.append('div').attr('class', 'cv-main');
        const mapCard = card(main, 'cv-card-map', 'Carte des pays');
        const side = main.append('div').attr('class', 'cv-side');
        const compareCard = card(side, 'cv-card-compare', 'Pays comparés');
        const seriesCard = card(side, 'cv-card-series', 'Évolution');
        const rowA = view.append('div').attr('class', 'cv-row');
        const compositionCard = card(rowA, 'cv-card-composition', 'Modes opératoires');
        const flowCard = card(rowA, 'cv-card-flow', 'Flux : attaque → cible → arme');
        const rowB = view.append('div').attr('class', 'cv-row');
        const raceCard = card(rowB, 'cv-card-race', 'Classement dynamique');
        const groupsCard = card(rowB, 'cv-card-groups', 'Organisations');
        const incidentsCard = card(view, 'cv-card-incidents', 'Incidents');
        footnote.raise(); // closes the view, after the panels

        const map = createWorldMap(built, mapCard, atlas, projection, files, (eventId) => store.set({ incident: eventId }));
        panels = {
          filters,
          kpis,
          map,
          compare: createComparePanel(built, compareCard),
          series: createTimeSeries(built, seriesCard),
          composition: createComposition(built, compositionCard),
          flow: createFlow(built, flowCard),
          race: createRace(built, raceCard),
          groups: createGroups(built, groupsCard),
          incidents: createIncidentPanel(built, incidentsCard, files, (set, i) => map.locate(set, i)),
        };
        render();
      })
      .catch((error: unknown) => {
        if (!alive) return;
        status.attr('class', 'cv-status error').text(`Vue indisponible : ${error instanceof Error ? error.message : String(error)}`);
      });

    return {
      destroy() {
        alive = false;
        offs.forEach((off) => off());
        panels?.filters.destroy();
        panels?.race.destroy();
        panels?.map.destroy();
        view.remove();
      },
    };
  },
};

export default mapModule;
