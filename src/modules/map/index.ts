import { json, select } from 'd3';
import coarseTopologyUrl from 'world-atlas/countries-110m.json?url';
import { buildCountryAtlas, loadCountryAtlas, type CountryAtlas } from '../../core/geo';
import type { ModuleContext, ModuleHandle, VizModule } from '../../core/module';
import { buildFrame, createEnv, type Env } from './frame';
import { createGlobe, type Globe } from './globe';
import { icon } from './icons';
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
      parts?.globe.highlight(ref);
      parts?.panel.hover(ref?.dim === 'country' ? ref.id : null);
    }

    // ------------------------------------------------------------------ keyboard help (D22)
    const SHORTCUTS: readonly [string, string][] = [
      ['Glisser, flèches', 'tourner le globe'],
      ['Molette, + et −', 'zoomer'],
      ['Clic', 'ajouter ou retirer un pays (4 au plus)'],
      ['Double-clic', 'zoomer sur un pays'],
      ['Entrée', 'sélectionner le pays au centre du globe'],
      ['Espace', 'lancer ou arrêter la lecture'],
      ['Échap', 'fermer la fiche, puis vider la sélection'],
      ['?', 'afficher ou masquer cette aide'],
    ];
    const help = globeBox.append('div').attr('class', 'cv-help').attr('role', 'dialog').attr('aria-labelledby', 'cv-help-title').attr('hidden', '');
    const helpHead = help.append('div').attr('class', 'cv-filter-head');
    helpHead.append('h3').attr('id', 'cv-help-title').text('Raccourcis');
    helpHead
      .append('button')
      .attr('type', 'button')
      .attr('class', 'cv-tool-button cv-icon-only')
      .attr('aria-label', 'Fermer l’aide')
      .html(icon('close'))
      .on('click', () => toggleHelp(false));
    const keys = help.append('dl');
    for (const [key, action] of SHORTCUTS) {
      keys.append('dt').append('kbd').text(key);
      keys.append('dd').text(action);
    }
    function toggleHelp(show = help.attr('hidden') !== null): void {
      help.attr('hidden', show ? null : '');
      if (show) (help.select('button').node() as HTMLButtonElement | null)?.focus();
    }

    /** Space and ? work wherever the focus is, except while typing or on a control that uses them. */
    const doc = host.ownerDocument;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target !== null && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName));
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === '?') {
        event.preventDefault();
        toggleHelp();
      } else if (event.key === ' ' && (target === null || target === doc.body || target.tagName === 'CANVAS')) {
        event.preventDefault();
        parts?.timebar.togglePlay();
      }
    };
    doc.addEventListener('keydown', onKey);

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
      if (help.attr('hidden') === null) toggleHelp(false);
      else if (state.incident !== null) store.set({ incident: null });
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
        const globe = createGlobe(globeBox, built, { detail, coarse }, files);
        parts = {
          globe,
          panel: createPanel(stage, built, files, { previewIncident: (eventId) => globe.previewIncident(eventId) }),
          timebar: createTimeBar(view, built, { onHelp: () => toggleHelp() }),
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
        doc.removeEventListener('keydown', onKey);
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
