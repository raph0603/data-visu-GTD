import { interval, type Timer } from 'd3';
import { categoryLabel } from '../../core/labels';
import { rangeLength, type YearRange } from '../../core/state';
import { formatCount, formatRange } from './format';
import { previousWindow, type Env, type Frame } from './frame';
import { readFilters, UNKNOWN_GROUP } from './model';
import type { Sel } from './ui';

const PLAY_STEP_MS = 650;
const PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>';

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
  destroy(): void;
}

/**
 * The bar under the globe. The period is chosen directly on the histogram of the yearly values:
 * drag across years to select them, drag the window to move it, click a year to keep it alone,
 * or pick a decade. Then the play, the metric, the organization filter and the comparison period.
 */
export function createTimeBar(parent: Sel<HTMLElement>, env: Env): TimeBar {
  const { store, dataset, model } = env;
  const { first, last } = dataset.years;
  const span = last - first + 1;
  const bar = parent.append('div').attr('class', 'cv-timebar');

  // ------------------------------------------------------------------ play + period
  const play = bar
    .append('button')
    .attr('type', 'button')
    .attr('class', 'cv-play')
    .on('click', () => (timer === null ? startPlay() : stopPlay()));

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
  let drag: { kind: 'brush' | 'move'; anchor: number; offset: number; moved: boolean } | null = null;
  bars
    .on('pointerdown', (event: PointerEvent) => {
      if (event.button !== 0) return;
      stopPlay();
      const year = yearAt(event.clientX);
      const inside = year >= current.from && year <= current.to && rangeLength(current) < span && rangeLength(current) > 1;
      drag = inside ? { kind: 'move', anchor: year, offset: year - current.from, moved: false } : { kind: 'brush', anchor: year, offset: 0, moved: false };
      (bars.node() as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    })
    .on('pointermove', (event: PointerEvent) => {
      const year = yearAt(event.clientX);
      if (drag === null) {
        bars.classed('is-over-window', year >= current.from && year <= current.to && rangeLength(current) < span && rangeLength(current) > 1);
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
  // Rates per million inhabitants (D21): for counts and casualties, not for a mean per incident.
  const perField = metricBox.append('label').attr('class', 'cv-check');
  const perBox = perField
    .append('input')
    .attr('type', 'checkbox')
    .on('change', (event: Event) => {
      const on = (event.target as HTMLInputElement).checked;
      store.set((s) => ({ ext: { ...s.ext, 'map.per': on ? 'capita' : 'raw' } }));
    });
  perField.append('span').text('par million d’habitants');

  // ------------------------------------------------------------------ organization filter
  const groupBox = bar.append('div').attr('class', 'cv-control cv-group-filter');
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
  const groupRow = groupBox.append('div').attr('class', 'cv-group-row');
  groupRow
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
  groupBox.append('span').attr('class', 'cv-control-label').attr('id', 'cv-suicide-label').text('Attentats-suicides');
  const suicideButtons = groupBox
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

  // ------------------------------------------------------------------ comparison
  const compareBox = bar.append('div').attr('class', 'cv-control cv-compare-control');
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

  // ------------------------------------------------------------------ filters set by another view
  const filters = bar.append('div').attr('class', 'cv-active-filters');

  // ------------------------------------------------------------------ play
  let timer: Timer | null = null;

  function setPlayButton(playing: boolean): void {
    play
      .classed('is-playing', playing)
      .attr('aria-label', playing ? 'Arrêter la lecture' : 'Lire année par année')
      .attr('title', playing ? 'Arrêter la lecture' : 'Lire année par année')
      .html(playing ? PAUSE_ICON : PLAY_ICON);
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

  return {
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
      const ratable = f.metric.kind !== 'mean' && env.population !== null;
      perBox.property('checked', f.display.perCapita).attr('disabled', ratable ? null : '');
      perField
        .classed('is-disabled', !ratable)
        .attr('title', ratable ? 'Diviser par la population moyenne de la période (Banque mondiale)' : env.population === null ? 'Population indisponible' : 'Déjà un taux : sans objet pour les morts par incident');
      const suicide = f.filters.suicide === null ? null : String(f.filters.suicide);
      suicideButtons.attr('aria-checked', (o) => String(o.value === suicide)).classed('is-active', (o) => o.value === suicide);

      const chosenGroups = state.filters.group ?? [];
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

      mode.property('value', f.compareChosen ? 'chosen' : 'previous');
      fromYear.attr('hidden', f.compareChosen ? null : '').property('value', f.compare?.from ?? first);
      toYear.attr('hidden', f.compareChosen ? null : '').property('value', f.compare?.to ?? first);
      compareText.text(f.compareChosen ? '' : f.compare === null ? '(aucune avant cette période)' : `(${formatRange(f.compare)})`);

      const others = Object.entries(state.filters)
        .filter(([dim]) => dim !== 'group' && dim !== 'suicide')
        .flatMap(([dim, values]) => values.map((value) => categoryLabel(dim, value)));
      filters.attr('hidden', others.length === 0 ? '' : null).selectAll('*').remove();
      if (others.length > 0) {
        filters.append('span').text(`Filtres posés par une autre vue : ${others.join(', ')}`);
        filters
          .append('button')
          .attr('type', 'button')
          .attr('class', 'cv-link-button')
          .text('Les retirer')
          .on('click', () =>
            store.set((s) => {
              const kept: Record<string, readonly string[]> = {};
              if (s.filters.group !== undefined) kept.group = s.filters.group;
              if (s.filters.suicide !== undefined) kept.suicide = s.filters.suicide;
              return { filters: kept };
            }),
          );
      }
    },
    destroy() {
      stopPlay();
    },
  };
}

function range(start: number, stop: number, step: number): number[] {
  const out: number[] = [];
  for (let v = start; v < stop; v += step) out.push(v);
  return out;
}
