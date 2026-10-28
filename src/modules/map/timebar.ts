import { interval, type Timer } from 'd3';
import { categoryLabel } from '../../core/labels';
import { rangeLength, type YearRange } from '../../core/state';
import { formatCount, formatRange } from './format';
import { previousWindow, type Env, type Frame } from './frame';
import { icon, iconLabel } from './icons';
import { readFilters, UNKNOWN_GROUP } from './model';
import type { Sel } from './ui';

const PLAY_STEP_MS = 650;

/**
 * Breaks in the way the GTD was collected (codebook): Pinkerton until 1997, then other teams, then
 * the current semi-automated method from 2012. A rise just after a break is partly the method.
 */
const COLLECTION_BREAKS: readonly { year: number; text: string }[] = [
  { year: 1998, text: '1998 : changement d’équipe de collecte (fin des données Pinkerton)' },
  { year: 2012, text: '2012 : méthode de collecte actuelle, en partie automatisée ; la hausse qui suit lui est en partie due' },
];

export interface TimeBar {
  update(frame: Frame): void;
  /** Starts or stops the play (Space). */
  togglePlay(): void;
  destroy(): void;
}

export interface TimeBarActions {
  /** Opens the keyboard help. */
  readonly onHelp: () => void;
}

/**
 * The bar under the globe (D22). Always visible: the play, the period chosen on the histogram of
 * the yearly values (drag across years, drag the window to move it, click one year, or a decade),
 * the metric. Folded behind « Filtres » (Hick's law: fewer visible choices, faster decisions):
 * organization, suicide attacks, rates per million, comparison period. Then share and help.
 */
export function createTimeBar(parent: Sel<HTMLElement>, env: Env, actions: TimeBarActions): TimeBar {
  const { store, dataset, model } = env;
  const { first, last } = dataset.years;
  const span = last - first + 1;
  const bar = parent.append('div').attr('class', 'cv-timebar');
  const doc = bar.node()?.ownerDocument ?? document;
  const win = doc.defaultView;

  // ------------------------------------------------------------------ play + period
  const play = bar
    .append('button')
    .attr('type', 'button')
    .attr('class', 'cv-play')
    .on('click', () => togglePlay());

  const time = bar.append('div').attr('class', 'cv-time');
  const timeHead = time.append('div').attr('class', 'cv-time-head');
  const years = timeHead.append('output').attr('class', 'cv-years').attr('aria-live', 'off');
  const scope = timeHead.append('span').attr('class', 'cv-time-scope');
  const histo = time.append('div').attr('class', 'cv-histo');
  const bars = histo.append('div').attr('class', 'cv-bars');
  const cells = bars
    .selectAll('span')
    .data(Array.from({ length: span }, (_, i) => first + i))
    .join('span')
    .attr('class', 'cv-bar');
  cells.append('span').attr('class', 'cv-bar-fill');
  for (const mark of COLLECTION_BREAKS) {
    bars
      .append('span')
      .attr('class', 'cv-break')
      .attr('title', mark.text)
      .style('left', `${((mark.year - first) / span) * 100}%`);
  }
  const windowBox = bars.append('div').attr('class', 'cv-window');
  let current: YearRange = { from: first, to: last };
  const ends = (['from', 'to'] as const).map((end) =>
    histo
      .append('input')
      .attr('type', 'range')
      .attr('class', `cv-range cv-range-${end}`)
      .attr('min', first)
      .attr('max', last)
      .attr('step', 1)
      .attr('aria-label', end === 'from' ? 'Première année de la période' : 'Dernière année de la période')
      .on('input', (event: Event) => {
        stopPlay();
        const year = Number((event.target as HTMLInputElement).value);
        // Moving one end past the other drags it along, so the window never inverts.
        store.set({ range: end === 'from' ? { from: year, to: Math.max(year, current.to) } : { from: Math.min(year, current.from), to: year } });
      }),
  );
  const axis = time.append('div').attr('class', 'cv-axis').attr('aria-hidden', 'true');
  for (const year of [first, ...range(Math.ceil((first + 1) / 10) * 10, last - 3, 10), last]) {
    axis
      .append('span')
      .style('left', `${((year - first + 0.5) / span) * 100}%`)
      .text(String(year));
  }

  // Direct manipulation on the histogram: drag to brush a period, drag inside it to move it.
  const yearAt = (clientX: number): number => {
    const box = bars.node()?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return first;
    return Math.min(last, Math.max(first, first + Math.floor(((clientX - box.left) / box.width) * span)));
  };
  const movable = (year: number) => year >= current.from && year <= current.to && rangeLength(current) < span && rangeLength(current) > 1;
  let drag: { kind: 'brush' | 'move'; anchor: number; offset: number; moved: boolean } | null = null;
  bars
    .on('pointerdown', (event: PointerEvent) => {
      if (event.button !== 0) return;
      stopPlay();
      const year = yearAt(event.clientX);
      drag = movable(year) ? { kind: 'move', anchor: year, offset: year - current.from, moved: false } : { kind: 'brush', anchor: year, offset: 0, moved: false };
      (bars.node() as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    })
    .on('pointermove', (event: PointerEvent) => {
      const year = yearAt(event.clientX);
      if (drag === null) {
        bars.classed('is-over-window', movable(year));
        return;
      }
      if (year === drag.anchor && !drag.moved) return;
      drag.moved = true;
      if (drag.kind === 'brush') store.set({ range: { from: Math.min(drag.anchor, year), to: Math.max(drag.anchor, year) } });
      else {
        const length = rangeLength(current);
        const from = Math.min(last - length + 1, Math.max(first, year - drag.offset));
        store.set({ range: { from, to: from + length - 1 } });
      }
    })
    .on('pointerup pointercancel', (event: PointerEvent) => {
      if (drag !== null && !drag.moved && event.type === 'pointerup') {
        const year = yearAt(event.clientX);
        store.set({ range: { from: year, to: year } });
      }
      drag = null;
    });

  // Presets: the whole span and the decades.
  const presets = time.append('div').attr('class', 'cv-presets').attr('role', 'group').attr('aria-label', 'Périodes prédéfinies');
  const presetList: { label: string; range: YearRange }[] = [{ label: 'Tout', range: { from: first, to: last } }];
  for (let decade = Math.floor(first / 10) * 10; decade <= last; decade += 10) {
    const from = Math.max(first, decade);
    const to = Math.min(last, decade + 9);
    presetList.push({ label: to - from === 9 ? `Années ${String(decade).slice(2)}` : formatRange({ from, to }), range: { from, to } });
  }
  const presetButtons = presets
    .selectAll('button')
    .data(presetList)
    .join('button')
    .attr('type', 'button')
    .attr('title', (p) => formatRange(p.range))
    .text((p) => p.label)
    .on('click', (_event: MouseEvent, p) => {
      stopPlay();
      store.set({ range: p.range });
    });
  time
    .append('p')
    .attr('class', 'cv-time-note')
    .text('Glisser sur les barres : choisir une période · glisser la période : la déplacer · clic : une seule année · pointillés : changement de méthode de collecte.');

  // ------------------------------------------------------------------ metric
  const metricBox = bar.append('div').attr('class', 'cv-control cv-metric-control');
  metricBox.append('span').attr('class', 'cv-control-label').attr('id', 'cv-metric-label').text('Mesure');
  const metrics = metricBox
    .append('div')
    .attr('class', 'cv-segmented')
    .attr('role', 'radiogroup')
    .attr('aria-labelledby', 'cv-metric-label')
    .selectAll('button')
    .data(dataset.metrics)
    .join('button')
    .attr('type', 'button')
    .attr('role', 'radio')
    .text((m) => m.label)
    .on('click', (_event: MouseEvent, m) => store.set({ metric: m.id }));

  // ------------------------------------------------------------------ actions: filters, share, help
  const tools = bar.append('div').attr('class', 'cv-bar-tools');
  const filterButton = tools
    .append('button')
    .attr('type', 'button')
    .attr('class', 'cv-tool-button')
    .attr('aria-haspopup', 'dialog')
    .attr('aria-expanded', 'false')
    .attr('aria-controls', 'cv-filter-panel');
  const shareButton = tools
    .append('button')
    .attr('type', 'button')
    .attr('class', 'cv-tool-button')
    .attr('title', 'Copier le lien de cette vue (période, pays, filtres)')
    .html(iconLabel('share', 'Partager'))
    .on('click', () => void share());
  tools
    .append('button')
    .attr('type', 'button')
    .attr('class', 'cv-tool-button cv-icon-only')
    .attr('aria-label', 'Raccourcis clavier')
    .attr('title', 'Raccourcis clavier (?)')
    .html(icon('keyboard'))
    .on('click', () => actions.onHelp());
  const announce = tools.append('span').attr('class', 'cv-sr-only').attr('role', 'status');

  // ------------------------------------------------------------------ the filter panel
  const panel = bar.append('div').attr('class', 'cv-filter-panel').attr('id', 'cv-filter-panel').attr('role', 'dialog').attr('aria-label', 'Filtres et options').attr('hidden', '');
  const panelHead = panel.append('div').attr('class', 'cv-filter-head');
  panelHead.append('h3').text('Filtres et options');
  panelHead
    .append('button')
    .attr('type', 'button')
    .attr('class', 'cv-tool-button cv-icon-only')
    .attr('aria-label', 'Fermer les filtres')
    .html(icon('close'))
    .on('click', () => setPanel(false));

  // Organization.
  const groupBox = panel.append('div').attr('class', 'cv-control cv-group-filter');
  groupBox.append('label').attr('class', 'cv-control-label').attr('for', 'cv-group-input').text('Organisation');
  const groupListId = 'cv-group-names';
  const groupList = groupBox.append('datalist').attr('id', groupListId);
  // Every organization of the base, the most active first (1970–2017, all countries).
  const activity = model.scan(readFilters({}), { from: first, to: last }, []).combined.group;
  const known = new Map<string, string>();
  [...activity]
    .filter(([g]) => model.dict.group[g] !== UNKNOWN_GROUP)
    .sort((a, b) => b[1].incidents - a[1].incidents)
    .forEach(([g, totals]) => {
      const name = model.dict.group[g] ?? '';
      known.set(name.toLocaleLowerCase('fr'), name);
      groupList.append('option').attr('value', name).attr('label', `${formatCount(totals.incidents)} incidents`);
    });
  groupBox
    .append('div')
    .attr('class', 'cv-group-row')
    .append('input')
    .attr('id', 'cv-group-input')
    .attr('type', 'search')
    .attr('list', groupListId)
    .attr('autocomplete', 'off')
    .attr('placeholder', 'Toutes · rechercher…')
    .on('change', (event: Event) => {
      const target = event.target as HTMLInputElement;
      const name = known.get(target.value.trim().toLocaleLowerCase('fr'));
      if (name === undefined) return;
      target.value = '';
      store.set((s) => ({ filters: { ...s.filters, group: [...new Set([...(s.filters.group ?? []), name])] } }));
    });
  const groupChips = groupBox.append('div').attr('class', 'cv-chips');

  // Suicide attacks are deadlier on average (Pape 2005, Mroszczyk 2019): a filter to test it (T8).
  const suicideBox = panel.append('div').attr('class', 'cv-control');
  suicideBox.append('span').attr('class', 'cv-control-label').attr('id', 'cv-suicide-label').text('Attentats-suicides');
  const suicideButtons = suicideBox
    .append('div')
    .attr('class', 'cv-segmented cv-segmented-small')
    .attr('role', 'radiogroup')
    .attr('aria-labelledby', 'cv-suicide-label')
    .selectAll('button')
    .data([
      { value: null, label: 'Tous' },
      { value: '1', label: 'Suicide' },
      { value: '0', label: 'Hors suicide' },
    ])
    .join('button')
    .attr('type', 'button')
    .attr('role', 'radio')
    .text((o) => o.label)
    .on('click', (_event: MouseEvent, o) => store.set((s) => ({ filters: { ...s.filters, suicide: o.value === null ? [] : [o.value] } })));

  // Rates per million inhabitants (D21): for counts and casualties, not for a mean per incident.
  const perBox = panel.append('div').attr('class', 'cv-control');
  perBox.append('span').attr('class', 'cv-control-label').text('Valeurs');
  const perField = perBox.append('label').attr('class', 'cv-check');
  const perInput = perField
    .append('input')
    .attr('type', 'checkbox')
    .on('change', (event: Event) => {
      const on = (event.target as HTMLInputElement).checked;
      store.set((s) => ({ ext: { ...s.ext, 'map.per': on ? 'capita' : 'raw' } }));
    });
  perField.append('span').text('par million d’habitants');

  // Comparison period.
  const compareBox = panel.append('div').attr('class', 'cv-control');
  compareBox.append('label').attr('class', 'cv-control-label').attr('for', 'cv-compare-mode').text('Évolution comparée à');
  const compareRow = compareBox.append('div').attr('class', 'cv-compare-row');
  const mode = compareRow
    .append('select')
    .attr('id', 'cv-compare-mode')
    .on('change', (event: Event) => {
      const value = (event.target as HTMLSelectElement).value;
      const { range: now } = store.get();
      store.set({ compare: value === 'previous' ? null : (previousWindow(now, first) ?? { from: first, to: Math.min(last, first + rangeLength(now) - 1) }) });
    });
  mode.append('option').attr('value', 'previous').text('la période précédente');
  mode.append('option').attr('value', 'chosen').text('une période choisie');
  const yearSelect = (label: string, onPick: (year: number) => void) => {
    const select = compareRow
      .append('select')
      .attr('class', 'cv-compare-year')
      .attr('aria-label', label)
      .on('change', (event: Event) => onPick(Number((event.target as HTMLSelectElement).value)));
    select
      .selectAll('option')
      .data(range(first, last + 1, 1))
      .join('option')
      .attr('value', (y) => y)
      .text((y) => String(y));
    return select;
  };
  const fromYear = yearSelect('Comparaison : première année', (year) => {
    const compare = store.get().compare;
    if (compare !== null) store.set({ compare: { from: year, to: Math.max(year, compare.to) } });
  });
  const toYear = yearSelect('Comparaison : dernière année', (year) => {
    const compare = store.get().compare;
    if (compare !== null) store.set({ compare: { from: Math.min(year, compare.from), to: year } });
  });
  const compareText = compareRow.append('span').attr('class', 'cv-compare-text');

  // Filters set by another view, then the reset of every filter.
  const others = panel.append('p').attr('class', 'cv-caption cv-other-filters');
  const reset = panel
    .append('button')
    .attr('type', 'button')
    .attr('class', 'cv-button')
    .text('Retirer tous les filtres')
    .on('click', () => store.set({ filters: {} }));

  // ------------------------------------------------------------------ panel behaviour
  let open = false;
  function setPanel(next: boolean): void {
    open = next;
    panel.attr('hidden', next ? null : '');
    filterButton.attr('aria-expanded', String(next)).classed('is-open', next);
    if (next) (panel.select('input').node() as HTMLInputElement | null)?.focus();
    else (filterButton.node() as HTMLButtonElement | null)?.focus();
  }
  filterButton.on('click', () => setPanel(!open));
  panel.on('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation(); // Échap closes the panel, not the selection
    setPanel(false);
  });
  const onOutside = (event: PointerEvent) => {
    const target = event.target as Node;
    if (open && !panel.node()?.contains(target) && !filterButton.node()?.contains(target)) setPanel(false);
  };
  doc.addEventListener('pointerdown', onOutside);

  // ------------------------------------------------------------------ share
  let shareTimer: number | null = null;
  async function share(): Promise<void> {
    const url = win?.location.href ?? '';
    let copied = false;
    try {
      await win?.navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      copied = false;
    }
    shareButton.html(copied ? iconLabel('check', 'Lien copié') : iconLabel('share', 'Copiez l’adresse de la page')).classed('is-done', copied);
    announce.text(copied ? 'Lien de la vue copié dans le presse-papiers' : 'Copie impossible : copiez l’adresse de la page');
    if (shareTimer !== null) win?.clearTimeout(shareTimer);
    shareTimer =
      win?.setTimeout(() => {
        shareTimer = null;
        shareButton.html(iconLabel('share', 'Partager')).classed('is-done', false);
      }, 2200) ?? null;
  }

  // ------------------------------------------------------------------ play
  let timer: Timer | null = null;

  function setPlayButton(playing: boolean): void {
    play
      .classed('is-playing', playing)
      .attr('aria-label', playing ? 'Arrêter la lecture (Espace)' : 'Lire année par année (Espace)')
      .html(playing ? iconLabel('pause', 'Pause') : iconLabel('play', 'Lire'));
    bar.classed('is-playing', playing);
  }
  setPlayButton(false);

  function startPlay(): void {
    const { range: now } = store.get();
    // The whole span plays one year at a time; a chosen window slides, keeping its length.
    const length = rangeLength(now) >= span ? 1 : rangeLength(now);
    if (now.to >= last || length !== rangeLength(now)) store.set({ range: { from: first, to: first + length - 1 } });
    timer = interval(() => {
      const r = store.get().range;
      if (r.to >= last) {
        stopPlay();
        return;
      }
      store.set({ range: { from: r.from + 1, to: r.to + 1 } });
    }, PLAY_STEP_MS);
    setPlayButton(true);
  }

  function stopPlay(): void {
    if (timer === null) return;
    timer.stop();
    timer = null;
    setPlayButton(false);
  }

  function togglePlay(): void {
    if (timer === null) startPlay();
    else stopPlay();
  }

  return {
    togglePlay,
    update(f) {
      const { state } = f;
      current = state.range;
      years.text(formatRange(state.range));
      scope.text(`${f.display.label} par an · ${f.selected.length === 0 ? 'monde' : f.selected.map((iso3) => env.name(iso3)).join(', ')}${f.filtered ? ' · filtres actifs' : ''}`);
      const [fromInput, toInput] = ends;
      fromInput?.property('value', state.range.from);
      toInput?.property('value', state.range.to);

      let max = 0;
      for (const v of f.series) if (Number.isFinite(v) && v > max) max = v;
      cells
        .classed('is-in', (year) => year >= state.range.from && year <= state.range.to)
        .classed('is-gap', (year) => !Number.isFinite(f.series[year - first] ?? Number.NaN))
        .attr('title', (year) => {
          const v = f.series[year - first] ?? Number.NaN;
          return Number.isFinite(v) ? `${year} : ${f.display.withUnit(v)}` : `${year} : pas de donnée (perdues par la source)`;
        });
      cells.select<HTMLSpanElement>('.cv-bar-fill').style('height', (year) => {
        const v = f.series[year - first] ?? Number.NaN;
        return Number.isFinite(v) ? `${max > 0 ? Math.max(v > 0 ? 3 : 0, (100 * v) / max) : 0}%` : '100%';
      });
      windowBox.style('left', `${((state.range.from - first) / span) * 100}%`).style('width', `${(rangeLength(state.range) / span) * 100}%`);
      presetButtons
        .classed('is-active', (p) => p.range.from === state.range.from && p.range.to === state.range.to)
        .attr('aria-pressed', (p) => String(p.range.from === state.range.from && p.range.to === state.range.to));

      metrics.attr('aria-checked', (m) => String(m.id === state.metric)).classed('is-active', (m) => m.id === state.metric);

      // The button shows how many filters are on, so that a folded filter is never forgotten.
      const chosenGroups = state.filters.group ?? [];
      const otherFilters = Object.entries(state.filters)
        .filter(([dim]) => dim !== 'group' && dim !== 'suicide')
        .flatMap(([dim, values]) => values.map((value) => categoryLabel(dim, value)));
      const active = chosenGroups.length + (f.filters.suicide === null ? 0 : 1) + otherFilters.length;
      filterButton
        .html(`${icon('filters')}<span>Filtres</span>${active > 0 ? `<span class="cv-count">${active}</span>` : ''}`)
        .attr('aria-label', active > 0 ? `Filtres et options, ${active} filtre${active > 1 ? 's' : ''} actif${active > 1 ? 's' : ''}` : 'Filtres et options')
        .classed('is-active', active > 0 || f.display.perCapita);

      groupChips
        .selectAll<HTMLButtonElement, string>('button')
        .data(chosenGroups, (name) => name)
        .join('button')
        .attr('type', 'button')
        .attr('class', 'cv-chip')
        .attr('aria-label', (name) => `Retirer le filtre ${name}`)
        .attr('title', 'Retirer ce filtre')
        .text((name) => `${categoryLabel('group', name)} ×`)
        .on('click', (_event: MouseEvent, name) => store.set((s) => ({ filters: { ...s.filters, group: (s.filters.group ?? []).filter((v) => v !== name) } })));

      const suicide = f.filters.suicide === null ? null : String(f.filters.suicide);
      suicideButtons.attr('aria-checked', (o) => String(o.value === suicide)).classed('is-active', (o) => o.value === suicide);

      const ratable = f.metric.kind !== 'mean' && env.population !== null;
      perInput.property('checked', f.display.perCapita).attr('disabled', ratable ? null : '');
      perField
        .classed('is-disabled', !ratable)
        .attr('title', ratable ? 'Diviser par la population moyenne de la période (Banque mondiale)' : env.population === null ? 'Population indisponible' : 'Déjà un taux : sans objet pour les morts par incident');

      mode.property('value', f.compareChosen ? 'chosen' : 'previous');
      fromYear.attr('hidden', f.compareChosen ? null : '').property('value', f.compare?.from ?? first);
      toYear.attr('hidden', f.compareChosen ? null : '').property('value', f.compare?.to ?? first);
      compareText.text(f.compareChosen ? '' : f.compare === null ? '(aucune avant cette période)' : `(${formatRange(f.compare)})`);

      others.attr('hidden', otherFilters.length === 0 ? '' : null).text(otherFilters.length === 0 ? '' : `Filtres posés par une autre vue : ${otherFilters.join(', ')}`);
      reset.attr('hidden', active === 0 ? '' : null);
    },
    destroy() {
      stopPlay();
      if (shareTimer !== null) win?.clearTimeout(shareTimer);
      doc.removeEventListener('pointerdown', onOutside);
    },
  };
}

function range(start: number, stop: number, step: number): number[] {
  const out: number[] = [];
  for (let v = start; v < stop; v += step) out.push(v);
  return out;
}
