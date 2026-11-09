import type { CubeFile } from '../core/contracts';
import type { ModuleContext } from '../core/module';
import { metricDef } from '../core/meta';
import { countryName } from '../core/labels';
import { rangeLength, type YearRange } from '../core/state';
import { el } from './dom';
import { pinnedCountries, yearlySeries } from './series';

const PLAY_STEP_MS = 650;
const NUMBER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/**
 * Breaks in the way the GTD was collected (codebook): Pinkerton until 1997, then other teams, then
 * the current semi-automated method from 2012. A rise just after a break is partly the method.
 */
const COLLECTION_BREAKS: readonly { year: number; text: string }[] = [
  { year: 1998, text: '1998 : changement d’équipe de collecte (fin des données Pinkerton)' },
  { year: 2012, text: '2012 : méthode de collecte actuelle, en partie automatisée ; la hausse qui suit lui est en partie due' },
];

export function formatYears(range: YearRange): string {
  return range.from === range.to ? String(range.from) : `${range.from}–${range.to}`;
}

export interface Timeline {
  /** Starts or stops the play (Space). */
  togglePlay(): void;
  /** Puts the keyboard on the period handles. */
  focus(): void;
  destroy(): void;
}

/**
 * The time zone shared by every plate, at the foot of the page: the histogram of the metric by year
 * for the countries and filters of the shared state, on which the period is chosen (drag across
 * years, drag the window to move it, click one year, or a decade), the play, and the comparison
 * period. It reads and writes the store only, so it serves every view alike.
 */
export function createTimeline(parent: HTMLElement, ctx: ModuleContext): Timeline {
  const { store, dataset: meta, data } = ctx;
  const { first, last } = meta.years;
  const span = last - first + 1;
  const doc = parent.ownerDocument;
  const win = doc.defaultView;

  const zone = el(doc, 'section', 'timeline');
  zone.setAttribute('aria-label', 'Période');
  parent.append(zone);

  // ------------------------------------------------------------------ play
  const play = el(doc, 'button', 'tl-play');
  play.type = 'button';
  play.addEventListener('click', () => togglePlay());
  zone.append(play);

  const main = el(doc, 'div', 'tl-main');
  zone.append(main);

  // ------------------------------------------------------------------ head: years, scope, presets, comparison
  const head = el(doc, 'div', 'tl-head');
  const years = el(doc, 'output', 'tl-years');
  years.setAttribute('aria-live', 'off');
  const scope = el(doc, 'span', 'tl-scope');
  const presets = el(doc, 'div', 'tl-presets');
  presets.setAttribute('role', 'group');
  presets.setAttribute('aria-label', 'Périodes prédéfinies');
  const compareButton = el(doc, 'button', 'tl-compare-button');
  compareButton.type = 'button';
  compareButton.setAttribute('aria-haspopup', 'dialog');
  compareButton.setAttribute('aria-expanded', 'false');
  head.append(years, scope, presets, compareButton);

  const presetList: { label: string; range: YearRange }[] = [{ label: 'Tout', range: { from: first, to: last } }];
  for (let decade = Math.floor(first / 10) * 10; decade <= last; decade += 10) {
    const from = Math.max(first, decade);
    const to = Math.min(last, decade + 9);
    presetList.push({ label: to - from === 9 ? `${String(decade).slice(2)}s` : formatYears({ from, to }), range: { from, to } });
  }
  const presetButtons = presetList.map((preset) => {
    const button = el(doc, 'button', undefined, preset.label);
    button.type = 'button';
    button.title = formatYears(preset.range);
    button.addEventListener('click', () => {
      stopPlay();
      store.set({ range: preset.range });
    });
    presets.append(button);
    return button;
  });

  // ------------------------------------------------------------------ histogram
  const histo = el(doc, 'div', 'tl-histo');
  const bars = el(doc, 'div', 'tl-bars');
  const cells = Array.from({ length: span }, () => {
    const cell = el(doc, 'span', 'tl-bar');
    cell.append(el(doc, 'span', 'tl-bar-fill'));
    bars.append(cell);
    return cell;
  });
  for (const mark of COLLECTION_BREAKS) {
    const node = el(doc, 'span', 'tl-break');
    node.title = mark.text;
    node.style.left = `${((mark.year - first) / span) * 100}%`;
    bars.append(node);
  }
  const windowBox = el(doc, 'div', 'tl-window');
  bars.append(windowBox);
  // The year under the pointer, with its value.
  const hover = el(doc, 'div', 'tl-hover');
  hover.hidden = true;
  hover.setAttribute('aria-hidden', 'true');
  histo.append(bars, hover);
  let current: YearRange = store.get().range;
  const ends = (['from', 'to'] as const).map((end) => {
    const input = el(doc, 'input', `tl-range tl-range-${end}`);
    input.type = 'range';
    input.min = String(first);
    input.max = String(last);
    input.step = '1';
    input.setAttribute('aria-label', end === 'from' ? 'Première année de la période' : 'Dernière année de la période');
    input.addEventListener('input', () => {
      stopPlay();
      const year = Number(input.value);
      // Moving one end past the other drags it along, so the window never inverts.
      store.set({ range: end === 'from' ? { from: year, to: Math.max(year, current.to) } : { from: Math.min(year, current.from), to: year } });
    });
    histo.append(input);
    return input;
  });
  // The years written on the edges of the window (both when it is wide enough, else one tag), in a layer
  // above the handles, which would hide them when the window is a single year.
  const tags = el(doc, 'div', 'tl-tags');
  tags.setAttribute('aria-hidden', 'true');
  const tagFrom = el(doc, 'span', 'tl-tag');
  const tagTo = el(doc, 'span', 'tl-tag');
  tags.append(tagFrom, tagTo);
  histo.append(tags);
  const axis = el(doc, 'div', 'tl-axis');
  axis.setAttribute('aria-hidden', 'true');
  for (let year = Math.ceil((first + 1) / 10) * 10; year < last - 3; year += 10) axis.append(axisLabel(year));
  axis.prepend(axisLabel(first));
  axis.append(axisLabel(last));
  function axisLabel(year: number): HTMLSpanElement {
    const node = el(doc, 'span', undefined, String(year));
    node.style.left = `${((year - first + 0.5) / span) * 100}%`;
    return node;
  }
  // One tick per year, longer every five years and every ten.
  const ticks = el(doc, 'div', 'tl-ticks');
  ticks.setAttribute('aria-hidden', 'true');
  for (let year = first; year <= last; year++) {
    const tick = el(doc, 'span', year % 10 === 0 ? 'tl-tick is-ten' : year % 5 === 0 ? 'tl-tick is-five' : 'tl-tick');
    tick.style.left = `${((year - first + 0.5) / span) * 100}%`;
    ticks.append(tick);
  }
  main.append(head, histo, ticks, axis);

  // Direct manipulation: drag to brush a period, drag inside it to move it.
  const yearAt = (clientX: number): number => {
    const box = bars.getBoundingClientRect();
    if (box.width === 0) return first;
    return Math.min(last, Math.max(first, first + Math.floor(((clientX - box.left) / box.width) * span)));
  };
  const movable = (year: number) => year >= current.from && year <= current.to && rangeLength(current) < span && rangeLength(current) > 1;
  let drag: { kind: 'brush' | 'move'; anchor: number; offset: number; moved: boolean } | null = null;
  bars.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    stopPlay();
    const year = yearAt(event.clientX);
    drag = movable(year) ? { kind: 'move', anchor: year, offset: year - current.from, moved: false } : { kind: 'brush', anchor: year, offset: 0, moved: false };
    bars.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  bars.addEventListener('pointermove', (event) => {
    const year = yearAt(event.clientX);
    showHover(year, event.clientX);
    if (drag === null) {
      bars.classList.toggle('is-over-window', movable(year));
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
  });
  bars.addEventListener('pointerleave', () => {
    if (drag === null) hover.hidden = true;
  });
  function showHover(year: number, clientX: number): void {
    const metric = metricDef(meta, store.get().metric);
    const v = series[year - first] ?? Number.NaN;
    hover.textContent = cube === null ? String(year) : Number.isFinite(v) ? `${year} : ${NUMBER.format(v)} ${metric.unit}` : `${year} : pas de donnée`;
    hover.hidden = false;
    const box = histo.getBoundingClientRect();
    const half = hover.offsetWidth / 2;
    hover.style.left = `${Math.min(Math.max(clientX - box.left, half), box.width - half)}px`;
  }
  const release = (event: PointerEvent) => {
    hover.hidden = true;
    if (drag !== null && !drag.moved && event.type === 'pointerup') {
      const year = yearAt(event.clientX);
      store.set({ range: { from: year, to: year } });
    }
    drag = null;
  };
  bars.addEventListener('pointerup', release);
  bars.addEventListener('pointercancel', release);

  // ------------------------------------------------------------------ comparison period
  const pop = el(doc, 'div', 'tl-pop');
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Période de comparaison');
  pop.hidden = true;
  const popLabel = el(doc, 'label', 'tl-pop-label', 'Évolution comparée à');
  popLabel.htmlFor = 'tl-compare-mode';
  const mode = el(doc, 'select');
  mode.id = 'tl-compare-mode';
  for (const [value, label] of [
    ['previous', 'la période précédente'],
    ['chosen', 'une période choisie'],
  ] as const) {
    const option = el(doc, 'option', undefined, label);
    option.value = value;
    mode.append(option);
  }
  const yearSelect = (label: string, onPick: (year: number) => void): HTMLSelectElement => {
    const select = el(doc, 'select', 'tl-compare-year');
    select.setAttribute('aria-label', label);
    for (let year = first; year <= last; year++) {
      const option = el(doc, 'option', undefined, String(year));
      option.value = String(year);
      select.append(option);
    }
    select.addEventListener('change', () => onPick(Number(select.value)));
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
  const compareText = el(doc, 'span', 'tl-compare-text');
  mode.addEventListener('change', () => {
    const now = store.get().range;
    const length = rangeLength(now);
    const previous = now.from - length >= first ? { from: now.from - length, to: now.from - 1 } : null;
    store.set({ compare: mode.value === 'previous' ? null : (previous ?? { from: first, to: Math.min(last, first + length - 1) }) });
  });
  pop.append(popLabel, mode, fromYear, toYear, compareText);
  zone.append(pop);

  let popOpen = false;
  function setPop(next: boolean): void {
    popOpen = next;
    pop.hidden = !next;
    compareButton.setAttribute('aria-expanded', String(next));
    if (next) mode.focus();
    else compareButton.focus();
  }
  compareButton.addEventListener('click', () => setPop(!popOpen));
  pop.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    setPop(false);
  });
  const onOutside = (event: PointerEvent) => {
    const target = event.target as Node;
    if (popOpen && !pop.contains(target) && !compareButton.contains(target)) setPop(false);
  };
  doc.addEventListener('pointerdown', onOutside);

  // ------------------------------------------------------------------ play
  let timer: number | null = null;

  function setPlayButton(playing: boolean): void {
    play.classList.toggle('is-playing', playing);
    play.setAttribute('aria-label', playing ? 'Arrêter la lecture (Espace)' : 'Lire année par année (Espace)');
    play.textContent = playing ? '❚❚ Pause' : '▶ Lire';
    zone.classList.toggle('is-playing', playing);
  }
  setPlayButton(false);

  function startPlay(): void {
    const now = store.get().range;
    // The whole span plays one year at a time; a chosen window slides, keeping its length.
    const length = rangeLength(now) >= span ? 1 : rangeLength(now);
    if (now.to >= last || length !== rangeLength(now)) store.set({ range: { from: first, to: first + length - 1 } });
    timer = win?.setInterval(() => {
      const r = store.get().range;
      if (r.to >= last) {
        stopPlay();
        return;
      }
      store.set({ range: { from: r.from + 1, to: r.to + 1 } });
    }, PLAY_STEP_MS) ?? null;
    setPlayButton(true);
  }

  function stopPlay(): void {
    if (timer === null) return;
    win?.clearInterval(timer);
    timer = null;
    setPlayButton(false);
  }

  function togglePlay(): void {
    if (timer === null) startPlay();
    else stopPlay();
  }

  // ------------------------------------------------------------------ rendering
  const onResize = () => drawTags(store.get().range);
  let cube: CubeFile | null = null;
  let series: Float64Array = new Float64Array(span);

  function drawBars(): void {
    const state = store.get();
    const metric = metricDef(meta, state.metric);
    let max = 0;
    for (const v of series) if (Number.isFinite(v) && v > max) max = v;
    cells.forEach((cell, i) => {
      const v = series[i] ?? Number.NaN;
      const loaded = cube !== null;
      cell.classList.toggle('is-gap', loaded && !Number.isFinite(v));
      const fill = cell.firstElementChild as HTMLElement | null;
      if (fill !== null) fill.style.height = !loaded ? '0%' : Number.isFinite(v) ? `${max > 0 ? Math.max(v > 0 ? 3 : 0, (100 * v) / max) : 0}%` : '100%';
    });
    const explored = pinnedCountries(state);
    const filtered = Object.values(state.filters).some((values) => values.length > 0);
    scope.textContent = `${metric.label} par an · ${explored.length === 0 ? 'monde' : explored.map((iso3) => countryName(iso3)).join(', ')}${filtered ? ' · filtres actifs' : ''}`;
  }

  function drawWindow(): void {
    const state = store.get();
    current = state.range;
    years.textContent = formatYears(state.range);
    ends[0]!.value = String(state.range.from);
    ends[1]!.value = String(state.range.to);
    cells.forEach((cell, i) => cell.classList.toggle('is-in', first + i >= state.range.from && first + i <= state.range.to));
    windowBox.style.left = `${((state.range.from - first) / span) * 100}%`;
    windowBox.style.width = `${(rangeLength(state.range) / span) * 100}%`;
    drawTags(state.range);
    presetList.forEach((preset, i) => {
      const on = preset.range.from === state.range.from && preset.range.to === state.range.to;
      presetButtons[i]?.classList.toggle('is-active', on);
      presetButtons[i]?.setAttribute('aria-pressed', String(on));
    });
    const chosen = state.compare !== null;
    const previous = state.range.from - rangeLength(state.range) >= first ? { from: state.range.from - rangeLength(state.range), to: state.range.from - 1 } : null;
    mode.value = chosen ? 'chosen' : 'previous';
    fromYear.hidden = !chosen;
    toYear.hidden = !chosen;
    fromYear.value = String(state.compare?.from ?? first);
    toYear.value = String(state.compare?.to ?? first);
    compareText.textContent = chosen ? '' : previous === null ? '(aucune avant cette période)' : `(${formatYears(previous)})`;
    compareButton.textContent = `Comparer · ${chosen ? formatYears(state.compare as YearRange) : previous === null ? 'aucune' : formatYears(previous)}`;
    compareButton.title = 'Choisir la période à laquelle comparer l’évolution';
  }

  function drawTags(range: YearRange): void {
    const total = bars.clientWidth;
    const x = (year: number) => ((year - first) / span) * total;
    const single = range.from === range.to || (rangeLength(range) / span) * total < 84;
    tagTo.hidden = single;
    tagTo.textContent = String(range.to);
    tagFrom.textContent = single ? formatYears(range) : String(range.from);
    if (single) {
      // One tag, centred on the window and kept inside the histogram.
      const half = tagFrom.offsetWidth / 2;
      tagFrom.style.left = `${Math.min(Math.max((x(range.from) + x(range.to + 1)) / 2, half), total - half)}px`;
      tagFrom.style.translate = '-50% 0';
    } else {
      tagFrom.style.left = `${x(range.from)}px`;
      tagFrom.style.translate = '0 0';
      tagTo.style.left = `${x(range.to + 1)}px`;
      tagTo.style.translate = '-100% 0';
    }
  }

  function recompute(): void {
    if (cube !== null) series = yearlySeries(cube, meta, store.get());
    drawBars();
  }

  drawWindow();
  drawBars();
  // The tags depend on the width of the histogram, known once it is laid out and when it changes.
  const resizer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
  resizer?.observe(bars);
  void data.cube().then((file) => {
    cube = file;
    recompute();
  });
  // The period does not enter the series: moving the window redraws only the window.
  const offs = [
    store.subscribe((s) => s.range, drawWindow),
    store.subscribe((s) => s.compare, drawWindow),
    store.subscribe((s) => s.metric, recompute),
    store.subscribe((s) => s.filters, recompute),
    store.subscribe((s) => s.pinned, recompute),
  ];

  return {
    togglePlay,
    focus() {
      ends[0]?.focus();
    },
    destroy() {
      stopPlay();
      offs.forEach((off) => off());
      doc.removeEventListener('pointerdown', onOutside);
      resizer?.disconnect();
      zone.remove();
    },
  };
}
