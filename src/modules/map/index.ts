import { json, select } from 'd3';
import coarseTopologyUrl from 'world-atlas/countries-110m.json?url';
import { buildCountryAtlas, loadCountryAtlas, type CountryAtlas } from '../../core/geo';
import type { ModuleContext, ModuleHandle, VizModule } from '../../core/module';
import { buildFrame, createEnv, type Env } from './frame';
import { createGlobe, type Globe } from './globe';
import { IncidentFiles } from './incidents';
import { CountryModel } from './model';
import { createPanel, type Panel } from './panel';
import { loadPopulation } from './population';
import { clearCountries, SlotKeeper } from './selection';
import { createTimeBar, type TimeBar } from './timebar';
import { Tooltip } from './ui';
import './map.css';

interface Parts {
  readonly globe: Globe;
  readonly panel: Panel;
  readonly timebar: TimeBar;
}

/** Simplified geometry drawn while the globe moves; the view works without it. */
function loadCoarseAtlas(): Promise<CountryAtlas | null> {
  return json(coarseTopologyUrl)
    .then(buildCountryAtlas)
    .catch(() => null);
}

/**
 * The country view (D19): a globe to turn and dive into. Its level follows the shared state: the
 * world, one explored country (focus) with an optional second one (pinned), one incident. The
 * panel beside it answers the question of the level; the bar under it holds the period, the play,
 * the metric and the comparison period.
 */
const mapModule: VizModule = {
  id: 'map',
  title: 'Carte par pays',
  tasks: ['T1', 'T3', 'T4', 'T9', 'T12'],
  mount(host: HTMLElement, ctx: ModuleContext): ModuleHandle {
    const { store, dataset, palette, data } = ctx;
    const view = select(host).append('section').attr('class', 'cv');
    const stage = view.append('div').attr('class', 'cv-stage');
    const globeBox = stage.append('div').attr('class', 'cv-globe');
    globeBox.append('div').attr('class', 'cv-globe-skeleton').attr('aria-hidden', 'true');
    const status = globeBox.append('p').attr('class', 'cv-status').text('Chargement des données…');
    const tooltip = new Tooltip(view);

    let alive = true;
    let env: Env | null = null;
    let parts: Parts | null = null;
    let files: IncidentFiles | null = null;
    const slots = new SlotKeeper();
    let scheduled = false;
    let loadingAll = false;
    let progressTimer: number | null = null;

    function render(): void {
      scheduled = false;
      if (!alive || env === null || parts === null || files === null) return;
      const frame = buildFrame(env, store.get(), slots);
      if (frame.selected.length > 0 && files.missing(frame.selected)) void files.ensure(frame.selected).then(schedule);
      if (frame.layer === 'events') loadAll(env.drawable);
      parts.timebar.update(frame);
      parts.panel.update(frame);
      parts.globe.update(frame);
    }

    /**
     * The incident layer needs every country's file (2.5 MB gzip in all): they load in the
     * background, and the globe fills in as they arrive, a render every half second at most.
     */
    function loadAll(iso3s: readonly string[]): void {
      if (loadingAll || files === null) return;
      loadingAll = true;
      const loader = files;
      const onProgress = () => {
        if (!alive || progressTimer !== null) return;
        progressTimer = window.setTimeout(() => {
          progressTimer = null;
          schedule();
        }, 500);
      };
      for (const iso3 of iso3s) void loader.ensure([iso3]).then(onProgress);
    }

    // Several slices often change in one interaction: render once, after the store settles.
    function schedule(): void {
      if (scheduled || !alive) return;
      scheduled = true;
      queueMicrotask(render);
    }

    function hover(): void {
      const ref = store.get().hover;
      const iso3 = ref?.dim === 'country' ? ref.id : null;
      parts?.globe.highlight(iso3);
      parts?.panel.hover(iso3);
    }

    const offs = [
      store.subscribe((s) => s.metric, schedule),
      store.subscribe((s) => s.range, schedule),
      store.subscribe((s) => s.compare, schedule),
      store.subscribe((s) => s.filters, schedule),
      store.subscribe((s) => s.focus, schedule),
      store.subscribe((s) => s.pinned, schedule),
      store.subscribe((s) => s.incident, schedule),
      store.subscribe((s) => s.ext, schedule),
      store.subscribe((s) => s.hover, hover),
    ];

    // Échap closes the incident sheet, then empties the selection, from anywhere in the view.
    view.on('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const state = store.get();
      if (state.incident !== null) store.set({ incident: null });
      else if (state.pinned.some((r) => r.dim === 'country')) clearCountries(store);
      else return;
      event.preventDefault();
    });

    Promise.all([loadCountryAtlas(), loadCoarseAtlas(), data.countryYear(), data.cube(), loadPopulation()])
      .then(([detail, coarse, countries, cube, population]) => {
        if (!alive) return;
        status.remove();
        globeBox.select('.cv-globe-skeleton').remove();
        const model = new CountryModel(cube, dataset.years.gaps);
        const built = createEnv({ store, dataset, palette, data, model, countries, population, tooltip });
        env = built;
        files = new IncidentFiles(data);
        parts = {
          globe: createGlobe(globeBox, built, { detail, coarse }, files),
          panel: createPanel(stage, built, files),
          timebar: createTimeBar(view, built),
        };
        render();
        hover();
      })
      .catch((error: unknown) => {
        if (!alive) return;
        status.attr('class', 'cv-status is-error').text(`Vue indisponible : ${error instanceof Error ? error.message : String(error)}`);
      });

    return {
      destroy() {
        alive = false;
        if (progressTimer !== null) window.clearTimeout(progressTimer);
        offs.forEach((off) => off());
        parts?.globe.destroy();
        parts?.timebar.destroy();
        view.on('keydown', null);
        view.remove();
      },
    };
  },
};

export default mapModule;
