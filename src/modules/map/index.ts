import { geoEqualEarth, geoGraticule10, geoPath, pointer, select, zoom, type GeoSphere, type Selection } from 'd3';
import type { CountryYearFile } from '../../core/contracts';
import { loadCountryAtlas, type CountryAtlas, type CountryFeature, type UncodedFeature } from '../../core/geo';
import { metricDef, metricKnownShare, metricValue, type MetricDef } from '../../core/meta';
import type { ModuleContext, ModuleHandle, VizModule } from '../../core/module';
import { YearlyIndex } from '../../core/series';
import type { AppState, YearRange } from '../../core/state';
import { describeChange, formatCount, formatRange, formatShare, formatTick, formatValue, formatWithUnit } from './format';
import { MIN_INCIDENTS_FOR_MEAN, rankCountries, type Ranking } from './ranking';
import { periodControl } from './period';
import { drawSparkline } from './sparkline';
import './map.css';

const WIDTH = 960;
const HEIGHT = 500;
const TOP = 10;
const SPHERE: GeoSphere = { type: 'Sphere' };

type Div = Selection<HTMLDivElement, unknown, null, undefined>;

interface Loaded {
  readonly atlas: CountryAtlas;
  readonly countries: CountryYearFile;
  readonly index: YearlyIndex;
}

/** One window of the metric: every country's value and the ranking. */
interface Frame {
  readonly range: YearRange;
  readonly ranking: Ranking;
  value(iso3: string): number;
  /** Incidents of the window; 0 means "no incident", which is not "no data". */
  incidents(iso3: string): number;
}

/**
 * Choropleth by country (T1), with a period window (T3), a metric selector (T4), a comparison
 * period with the change of the selected country (T9) and the rank changes of the top 10 (T12).
 */
const mapModule: VizModule = {
  id: 'map',
  title: 'Carte par pays',
  tasks: ['T1', 'T3', 'T4', 'T9', 'T12'],
  mount(host: HTMLElement, ctx: ModuleContext): ModuleHandle {
    const { store, dataset, palette } = ctx;
    const view = select(host).append('section').attr('class', 'map-view');

    // ------------------------------------------------------------------ controls
    const controls = view.append('div').attr('class', 'map-controls');
    const metricLabel = controls.append('label').attr('class', 'map-field');
    metricLabel.append('span').text('Métrique');
    const metricSelect = metricLabel.append('select').on('change', (event: Event) => {
      store.set({ metric: (event.target as HTMLSelectElement).value });
    });
    metricSelect
      .selectAll('option')
      .data(dataset.metrics)
      .join('option')
      .attr('value', (m) => m.id)
      .text((m) => m.label);

    const years = dataset.years;
    const mainPeriod = periodControl(controls, 'Période', years, (range) => store.set({ range }));
    const compareToggle = controls.append('label').attr('class', 'map-field map-toggle');
    const compareBox = compareToggle
      .append('input')
      .attr('type', 'checkbox')
      .on('change', (event: Event) => {
        const on = (event.target as HTMLInputElement).checked;
        store.set((s) => ({ compare: on ? previousWindow(s.range, years.first) : null }));
      });
    compareToggle.append('span').text('Comparer à une autre période');
    const comparePeriod = periodControl(controls, 'Comparaison', years, (compare) => store.set({ compare }));
    const gapNote = view.append('p').attr('class', 'map-note');

    // ---------------------------------------------------------------- map + side
    const body = view.append('div').attr('class', 'map-body');
    const canvas: Div = body.append('div').attr('class', 'map-canvas');
    const status = canvas.append('p').attr('class', 'map-status').text('Chargement de la carte…');
    const svg = canvas
      .append('svg')
      .attr('viewBox', `0 0 ${WIDTH} ${HEIGHT}`)
      .attr('role', 'img')
      .attr('aria-label', 'Carte du monde colorée selon la métrique choisie');
    const noData = palette.ensureNoDataPattern(svg.node() as SVGSVGElement);
    const layer = svg.append('g');
    const legend = svg.append('g').attr('class', 'map-legend');
    const tooltip: Div = canvas.append('div').attr('class', 'map-tooltip').attr('hidden', '');
    const footnote = view.append('p').attr('class', 'map-footnote');

    const side = body.append('aside').attr('class', 'map-side');
    const focusCard = side.append('section').attr('class', 'map-focus');
    const rankingBox = side.append('section').attr('class', 'map-ranking');

    let loaded: Loaded | null = null;
    let countryPaths: Selection<SVGPathElement, CountryFeature, SVGGElement, unknown> | null = null;
    let alive = true;

    const metric = (): MetricDef => metricDef(dataset, store.get().metric);

    function frame(range: YearRange): Frame | null {
      if (loaded === null) return null;
      const { index } = loaded;
      const def = metric();
      return {
        range,
        ranking: rankCountries(index, def, range),
        value: (iso3) => metricValue(index, def, iso3, range.from, range.to),
        incidents: (iso3) => index.window(iso3, 'incidents', range.from, range.to),
      };
    }

    // ----------------------------------------------------------------- drawing
    function drawMap(atlas: CountryAtlas): void {
      const projection = geoEqualEarth().fitExtent(
        [
          [8, 8],
          [WIDTH - 8, HEIGHT - 8],
        ],
        SPHERE,
      );
      const path = geoPath(projection);
      layer.append('path').datum(SPHERE).attr('class', 'map-sphere').attr('d', path);
      layer.append('path').datum(geoGraticule10()).attr('class', 'map-graticule').attr('d', path);
      layer
        .append('g')
        .selectAll('path')
        .data(atlas.uncoded)
        .join('path')
        .attr('class', 'map-uncoded')
        .attr('d', path)
        .attr('fill', noData)
        .on('pointermove', (event: PointerEvent, d) => showTooltip(event, uncodedTooltip(d)))
        .on('pointerleave', hideTooltip);
      countryPaths = layer
        .append('g')
        .selectAll<SVGPathElement, CountryFeature>('path')
        .data(atlas.countries)
        .join('path')
        .attr('class', 'map-country')
        .attr('d', path)
        .on('pointerenter', (_event: PointerEvent, d) => store.set({ hover: { dim: 'country', id: d.properties.iso3 } }))
        .on('pointermove', (event: PointerEvent, d) => showTooltip(event, countryTooltip(d.properties.iso3)))
        .on('pointerleave', () => {
          hideTooltip();
          store.set({ hover: null });
        })
        .on('click', (_event: MouseEvent, d) => toggleFocus(d.properties.iso3));

      svg.call(
        zoom<SVGSVGElement, unknown>()
          .scaleExtent([1, 8])
          .translateExtent([
            [0, 0],
            [WIDTH, HEIGHT],
          ])
          .on('zoom', (event: { transform: { toString(): string } }) => layer.attr('transform', event.transform.toString())),
      );
    }

    function recolor(main: Frame): void {
      if (countryPaths === null) return;
      const def = metric();
      // Log scale: a few countries (Iraq, Afghanistan…) are orders of magnitude above the rest.
      const max = Math.max(0, ...main.ranking.value.values());
      const t = (v: number) => (max > 0 ? Math.log1p(v) / Math.log1p(max) : 0);
      countryPaths.attr('fill', (d) => {
        const iso3 = d.properties.iso3;
        const v = main.value(iso3);
        // A mean over no incident is undefined but nothing is missing: drawn like a zero, not hatched.
        if (Number.isNaN(v)) return main.incidents(iso3) === 0 ? palette.zero : noData;
        return v === 0 ? palette.zero : palette.sequential(t(v));
      });
      drawLegend(max, def);
    }

    function drawLegend(max: number, def: MetricDef): void {
      legend.selectAll('*').remove();
      legend.attr('transform', `translate(16, ${HEIGHT - 70})`);
      legend.append('rect').attr('class', 'map-legend-bg').attr('x', -8).attr('y', -18).attr('width', 262).attr('height', 82);
      legend.append('text').attr('class', 'map-legend-title').attr('y', -4).text(`${def.label} (échelle log.)`);
      const steps = 24;
      const w = 180;
      legend
        .selectAll('rect.map-legend-step')
        .data([...Array(steps).keys()])
        .join('rect')
        .attr('class', 'map-legend-step')
        .attr('x', (i) => (i * w) / steps)
        .attr('y', 4)
        .attr('width', w / steps + 0.5)
        .attr('height', 10)
        .attr('fill', (i) => palette.sequential((i + 0.5) / steps));
      const ticks = max > 0 ? logTicks(max, w) : [];
      legend
        .selectAll('text.map-legend-tick')
        .data(ticks)
        .join('text')
        .attr('class', 'map-legend-tick')
        .attr('x', (v) => (Math.log1p(v) / Math.log1p(max)) * w)
        .attr('y', 26)
        .text(formatTick);
      const swatches = [
        { fill: palette.zero, label: def.kind === 'mean' ? '0 ou aucun incident' : 'zéro' },
        { fill: noData, label: 'pas de donnée' },
      ];
      const sw = legend.selectAll('g.map-legend-swatch').data(swatches).join('g').attr('class', 'map-legend-swatch');
      sw.attr('transform', (_d, i) => `translate(${i * 135}, 38)`);
      sw.append('rect').attr('width', 14).attr('height', 10).attr('fill', (d) => d.fill).attr('stroke', palette.noDataStroke).attr('stroke-width', 0.5);
      sw.append('text').attr('x', 19).attr('y', 9).text((d) => d.label);
    }

    function highlight(state: AppState): void {
      if (countryPaths === null) return;
      const hovered = state.hover?.dim === 'country' ? state.hover.id : null;
      const focused = state.focus?.dim === 'country' ? state.focus.id : null;
      countryPaths
        .classed('is-hover', (d) => d.properties.iso3 === hovered)
        .classed('is-focus', (d) => d.properties.iso3 === focused)
        .filter((d) => d.properties.iso3 === hovered || d.properties.iso3 === focused)
        .raise();
      rankingBox.selectAll<HTMLButtonElement, string>('button').classed('is-hover', (iso3) => iso3 === hovered).classed('is-focus', (iso3) => iso3 === focused);
    }

    // --------------------------------------------------------------- tooltip
    function showTooltip(event: PointerEvent, lines: readonly string[]): void {
      const [x, y] = pointer(event, canvas.node());
      const width = canvas.node()?.clientWidth ?? WIDTH;
      tooltip
        .attr('hidden', null)
        .style('left', `${Math.min(x + 14, width - 260)}px`)
        .style('top', `${y + 14}px`)
        .selectAll('p')
        .data(lines)
        .join('p')
        .text((line) => line);
    }

    function hideTooltip(): void {
      tooltip.attr('hidden', '');
    }

    function label(iso3: string): string {
      return loaded?.countries.entities[iso3]?.label ?? iso3;
    }

    function countryTooltip(iso3: string): string[] {
      const state = store.get();
      const main = frame(state.range);
      if (main === null || loaded === null) return [label(iso3)];
      const def = metric();
      const lines = [`${label(iso3)} · ${formatRange(state.range)}`, describeValue(iso3, main, def)];
      const share = metricKnownShare(loaded.index, def, iso3, state.range.from, state.range.to);
      if (def.kind !== 'count' && share < 1) lines.push(`valeur connue pour ${formatShare(share)} des incidents`);
      if (state.compare !== null) {
        const before = frame(state.compare);
        if (before !== null) {
          const change = describeChange(main.value(iso3), before.value(iso3));
          lines.push(`${formatRange(state.compare)} : ${formatWithUnit(before.value(iso3), def)} (${change.text})`);
        }
      }
      return lines;
    }

    function describeValue(iso3: string, current: Frame, def: MetricDef): string {
      const v = current.value(iso3);
      if (Number.isNaN(v)) {
        if (current.range.from === current.range.to && years.gaps.includes(current.range.from)) {
          return `pas de donnée : ${current.range.from} a été perdue par la source`;
        }
        if (current.incidents(iso3) === 0) return 'aucun incident enregistré';
        return def.kind === 'count' ? 'pas de donnée' : 'pas de donnée : nombre de victimes inconnu';
      }
      if (v === 0) return def.kind === 'count' ? 'aucun incident enregistré' : `0 ${def.unit}`;
      const rank = current.ranking.rank.get(iso3);
      if (rank !== undefined) return `${formatWithUnit(v, def)} · rang ${rank} sur ${current.ranking.ordered.length}`;
      return def.kind === 'mean'
        ? `${formatWithUnit(v, def)} (moins de ${MIN_INCIDENTS_FOR_MEAN} incidents : non classé)`
        : formatWithUnit(v, def);
    }

    function uncodedTooltip(d: UncodedFeature): string[] {
      return [
        d.properties.name || 'Territoire sans nom',
        'Territoire sans code ISO : ses incidents sont comptés avec un autre pays ou parmi les non représentables.',
      ];
    }

    // ------------------------------------------------------------ side panel
    function toggleFocus(iso3: string): void {
      store.set((s) => ({ focus: s.focus?.dim === 'country' && s.focus.id === iso3 ? null : { dim: 'country', id: iso3 } }));
    }

    function renderRanking(main: Frame, before: Frame | null, state: AppState): void {
      const def = metric();
      rankingBox.selectAll('*').remove();
      rankingBox.append('h3').text(`Les ${TOP} pays les plus touchés`);
      rankingBox
        .append('p')
        .attr('class', 'map-caption')
        .text(
          `${def.label}, ${formatRange(state.range)}` +
            (def.kind === 'mean' ? ` · pays d'au moins ${MIN_INCIDENTS_FOR_MEAN} incidents` : '') +
            (before !== null ? ` · rang comparé à ${formatRange(before.range)}` : ''),
        );
      const top = main.ranking.ordered.slice(0, TOP);
      if (top.length === 0) {
        rankingBox.append('p').attr('class', 'map-empty').text('Aucun pays à classer sur cette période.');
        return;
      }
      const best = main.ranking.value.get(top[0] ?? '') ?? 1;
      const items = rankingBox.append('ol').selectAll('li').data(top).join('li');
      const buttons = items
        .append('button')
        .attr('type', 'button')
        .attr('aria-label', (iso3) => `${label(iso3)}, rang ${main.ranking.rank.get(iso3) ?? ''}, ${formatWithUnit(main.ranking.value.get(iso3) ?? Number.NaN, def)}`)
        .on('click', (_event: MouseEvent, iso3) => toggleFocus(iso3))
        .on('pointerenter', (_event: PointerEvent, iso3) => store.set({ hover: { dim: 'country', id: iso3 } }))
        .on('pointerleave', () => store.set({ hover: null }));
      buttons.append('span').attr('class', 'map-rank').text((iso3) => String(main.ranking.rank.get(iso3) ?? ''));
      buttons.append('span').attr('class', 'map-name').text(label);
      buttons.append('span').attr('class', 'map-value').text((iso3) => formatValue(main.ranking.value.get(iso3) ?? Number.NaN, def));
      buttons
        .append('span')
        .attr('class', 'map-bar')
        .append('span')
        .style('width', (iso3) => `${(100 * (main.ranking.value.get(iso3) ?? 0)) / best}%`);
      if (before !== null) {
        buttons
          .append('span')
          .attr('class', (iso3) => `map-move map-move-${move(iso3, main, before).kind}`)
          .attr('title', (iso3) => move(iso3, main, before).title)
          .text((iso3) => move(iso3, main, before).text);
        const left = before.ranking.ordered.slice(0, TOP).filter((iso3) => !top.includes(iso3));
        if (left.length > 0) {
          rankingBox.append('p').attr('class', 'map-caption').text(`Sortis du top ${TOP} : ${left.map(label).join(', ')}`);
        }
      }
    }

    function renderFocus(main: Frame | null, before: Frame | null, state: AppState): void {
      focusCard.selectAll('*').remove();
      const iso3 = state.focus?.dim === 'country' ? state.focus.id : null;
      if (iso3 === null || main === null || loaded === null || loaded.countries.entities[iso3] === undefined) {
        focusCard.append('p').attr('class', 'map-hint').text('Cliquez sur un pays pour voir son détail et comparer deux périodes.');
        return;
      }
      const def = metric();
      const entity = loaded.countries.entities[iso3];
      focusCard.append('h3').text(label(iso3));
      if (entity?.region) focusCard.append('p').attr('class', 'map-caption').text(entity.region);

      const figures = focusCard.append('dl').attr('class', 'map-figures');
      const period = (current: Frame) => {
        figures.append('dt').text(formatRange(current.range));
        figures.append('dd').text(describeValue(iso3, current, def));
      };
      period(main);
      if (before !== null) {
        period(before);
        const change = describeChange(main.value(iso3), before.value(iso3));
        figures.append('dt').text('Évolution');
        figures
          .append('dd')
          .attr('class', `map-change map-change-${change.kind}`)
          .text(`${change.kind === 'up' ? '↑ ' : change.kind === 'down' ? '↓ ' : ''}${change.text}`);
        const now = main.ranking.rank.get(iso3);
        const then = before.ranking.rank.get(iso3);
        if (now !== undefined && then !== undefined && now !== then) {
          figures.append('dt').text('Rang');
          figures.append('dd').text(`${then}e → ${now}e`);
        }
      }
      const share = metricKnownShare(loaded.index, def, iso3, state.range.from, state.range.to);
      if (def.kind !== 'count' && share < 1 && !Number.isNaN(share)) {
        focusCard.append('p').attr('class', 'map-caption').text(`Valeur connue pour ${formatShare(share)} des incidents de la période.`);
      }
      drawSparkline(focusCard, loaded.index, def, iso3, { years, range: state.range, compare: state.compare, palette });
      const actions = focusCard.append('div').attr('class', 'map-actions');
      actions
        .append('button')
        .attr('type', 'button')
        .text("Voir dans l'atlas")
        .on('click', () => store.set({ view: 'atlas' }));
      actions
        .append('button')
        .attr('type', 'button')
        .text('Désélectionner')
        .on('click', () => store.set({ focus: null }));
    }

    function renderFootnote(main: Frame | null, state: AppState): void {
      if (main === null || loaded === null) return;
      const rest = loaded.countries.notRepresentable.incidents
        .slice(state.range.from - years.first, state.range.to - years.first + 1)
        .reduce<number>((sum, n) => sum + (n ?? 0), 0);
      footnote.text(
        `Absents de la carte sur ${formatRange(state.range)} : ${formatCount(rest)} incident(s) sans pays représentable ` +
          '(URSS, Yougoslavie, Tchécoslovaquie, Serbie-Monténégro, Kosovo, « International »), comptés dans les totaux régionaux. ' +
          'Zoom : molette ou double-clic.',
      );
    }

    // ---------------------------------------------------------------- update
    function update(): void {
      const state = store.get();
      metricSelect.property('value', state.metric);
      mainPeriod.update(state.range);
      compareBox.property('checked', state.compare !== null);
      comparePeriod.update(state.compare);
      const gaps = years.gaps.filter((y) => inRange(y, state.range) || (state.compare !== null && inRange(y, state.compare)));
      gapNote.text(gaps.length > 0 ? `${gaps.join(', ')} : aucune donnée (perdue par la source), non comptée comme zéro.` : '');

      const main = frame(state.range);
      const before = state.compare === null ? null : frame(state.compare);
      if (main !== null) {
        recolor(main);
        renderRanking(main, before, state);
      }
      renderFocus(main, before, state);
      renderFootnote(main, state);
      highlight(state);
    }

    const offs = [
      store.subscribe((s) => s.metric, update),
      store.subscribe((s) => s.range, update),
      store.subscribe((s) => s.compare, update),
      store.subscribe((s) => s.focus, update),
      store.subscribe((s) => s.hover, () => highlight(store.get())),
    ];
    update();

    Promise.all([loadCountryAtlas(), ctx.data.countryYear()])
      .then(([atlas, countries]) => {
        if (!alive) return;
        loaded = { atlas, countries, index: new YearlyIndex(countries) };
        status.remove();
        drawMap(atlas);
        update();
      })
      .catch((error: unknown) => {
        if (!alive) return;
        status.attr('class', 'map-status error').text(`Carte indisponible : ${error instanceof Error ? error.message : String(error)}`);
      });

    return {
      destroy() {
        alive = false;
        offs.forEach((off) => off());
        svg.on('.zoom', null);
        view.remove();
      },
    };
  },
};

function inRange(year: number, range: YearRange): boolean {
  return year >= range.from && year <= range.to;
}

/** The window of the same length just before `range` (clipped to the first year). */
function previousWindow(range: YearRange, first: number): YearRange {
  const length = range.to - range.from + 1;
  if (range.from === first) return { from: first, to: first };
  return { from: Math.max(first, range.from - length), to: range.from - 1 };
}

/** Rank change of a top-10 country against the comparison period (T12). */
function move(iso3: string, main: Frame, before: Frame): { kind: 'up' | 'down' | 'same' | 'new'; text: string; title: string } {
  const now = main.ranking.rank.get(iso3);
  const then = before.ranking.rank.get(iso3);
  if (now === undefined) return { kind: 'same', text: '', title: '' };
  if (then === undefined) return { kind: 'new', text: 'nouveau', title: 'non classé sur la période de comparaison' };
  if (then > TOP) return { kind: 'new', text: `▲ ${then - now}`, title: `entre dans le top ${TOP} (${then}e auparavant)` };
  if (then === now) return { kind: 'same', text: '=', title: 'même rang' };
  return then > now
    ? { kind: 'up', text: `▲ ${then - now}`, title: `${then}e auparavant` }
    : { kind: 'down', text: `▼ ${now - then}`, title: `${then}e auparavant` };
}

/**
 * 1, 10, 100… up to max, then max itself, on a log1p axis `width` px wide. A power of ten closer
 * than MIN_TICK_GAP px to max is dropped so that the labels never overlap.
 */
function logTicks(max: number, width: number): number[] {
  const MIN_TICK_GAP = 40;
  const x = (v: number) => (Math.log1p(v) / Math.log1p(max)) * width;
  const ticks: number[] = [];
  for (let p = 1; p < max; p *= 10) ticks.push(p);
  while (ticks.length > 0 && x(max) - x(ticks[ticks.length - 1] ?? 0) < MIN_TICK_GAP) ticks.pop();
  ticks.push(max >= 10 ? Math.round(max) : Math.round(max * 10) / 10);
  return ticks;
}

export default mapModule;
