import type { IncidentSummary, TopEventsFile } from '../../core/contracts';
import { categoryLabel } from '../../core/labels';
import type { MetricDef } from '../../core/meta';
import type { EntityRef } from '../../core/state';
import { describeChange, formatCount, formatRange, formatRate, formatShare, formatValue, formatWithUnit, ordinal, plural } from './format';
import { weightOf, weightUnit, type CountryFigures, type Env, type Frame } from './frame';
import { incidentCategory, incidentDate, type IncidentFiles } from './incidents';
import { isNamedGroup, knownShareOf, metricOf, UNKNOWN_GROUP, type Breakdown } from './model';
import { perMillion, WORLD } from './population';
import { clearCountries, MAX_SELECTION, toggleCountry } from './selection';
import type { Sel } from './ui';

const INCIDENTS_SHOWN = 5;

export interface PanelActions {
  /** An incident row is hovered or focused: ring it on the globe (null when left). */
  readonly previewIncident: (eventId: string | null) => void;
}

export interface Panel {
  update(frame: Frame): void;
  /** Country hovered on the globe, read at the world level. */
  hover(iso3: string | null): void;
}

interface Deadly {
  readonly eventId: string;
  readonly iso3: string;
  readonly year: number;
  readonly month: number | null;
  readonly day: number | null;
  readonly city: string | null;
  readonly killed: number | null;
  readonly wounded: number | null;
  readonly attackType: string;
  readonly group: string;
}

/**
 * The side panel, one question per level (D19, D20). World: the figures of the world, the hovered
 * country, the main organizations and the deadliest incidents. Selection (one to four countries):
 * their figures side by side against the comparison period, their yearly curves as small multiples,
 * their organizations and their deadliest incidents. Incident: the sheet, with the GTD summary.
 */
export function createPanel<E extends Element>(parent: Sel<E>, env: Env, files: IncidentFiles, actions: PanelActions): Panel {
  const { store, dataset, model, data } = env;
  const root = parent.append('aside').attr('class', 'cv-panel').attr('aria-label', 'Détails');
  const crumbs = root.append('nav').attr('class', 'cv-crumbs').attr('aria-label', 'Niveau de lecture').append('ol');
  const scroll = root.append('div').attr('class', 'cv-panel-scroll');
  const head = scroll.append('header').attr('class', 'cv-panel-head');
  // The hovered country's readout comes first, where it stays in sight above the panel's fold (D23).
  const hovered = scroll.append('section').attr('class', 'cv-section cv-hovered').attr('aria-live', 'polite');
  const figures = scroll.append('section').attr('class', 'cv-section cv-figures').attr('aria-label', 'Chiffres clés');
  const trends = scroll.append('section').attr('class', 'cv-section cv-trends');
  const groups = scroll.append('section').attr('class', 'cv-section cv-groups');
  const deadliest = scroll.append('section').attr('class', 'cv-section cv-deadliest');
  const sheet = scroll.append('article').attr('class', 'cv-section cv-sheet');
  const search = scroll.append('section').attr('class', 'cv-section cv-search');
  const note = scroll.append('p').attr('class', 'cv-panel-note');

  const doc = root.node()?.ownerDocument ?? document;
  const listId = 'cv-country-names';
  const datalist = root.append('datalist').attr('id', listId);
  const byName = new Map<string, string>();
  [...env.drawable]
    .sort((a, b) => env.name(a).localeCompare(env.name(b), 'fr'))
    .forEach((iso3) => {
      byName.set(normalize(env.name(iso3)), iso3);
      datalist.append('option').attr('value', env.name(iso3));
    });

  let frame: Frame | null = null;
  let hoverIso: string | null = null;
  let summaryToken = 0;
  let summaryFor = '';
  let topEvents: TopEventsFile | null = null;
  let topEventsState: 'idle' | 'loading' | 'failed' = 'idle';
  let levelKey = '';

  /** Rebuilds a section, keeping the keyboard focus on the element with the same data-key. */
  function rebuild(section: Sel<HTMLElement>, build: (section: Sel<HTMLElement>) => void): void {
    const node = section.node();
    const active = doc.activeElement;
    const key = active instanceof HTMLElement && node?.contains(active) ? active.dataset.key : undefined;
    section.selectAll('*').remove();
    build(section);
    if (key !== undefined) (node?.querySelector(`[data-key="${key}"]`) as HTMLElement | null)?.focus();
  }

  /**
   * Linking (D22): pointing at a country or an organization in the panel, with the mouse or the
   * keyboard, sets the shared hover, which the globe outlines.
   */
  const point = <P extends Element>(sel: Sel<P>, ref: EntityRef): void => {
    sel
      .on('mouseenter focusin', () => store.set({ hover: ref }))
      .on('mouseleave focusout', () => {
        const hover = store.get().hover;
        if (hover?.dim === ref.dim && hover.id === ref.id) store.set({ hover: null });
      });
  };

  /** A click on a yearly curve keeps that year alone. */
  const pickYear = (svg: Sel<SVGSVGElement>, toYear: (x: number, width: number) => number): void => {
    svg
      .classed('is-pickable', true)
      .on('click', (event: MouseEvent) => {
        const box = svg.node()?.getBoundingClientRect();
        if (box === undefined || box.width === 0) return;
        const year = Math.min(model.last, Math.max(model.first, toYear(event.clientX - box.left, box.width)));
        store.set({ range: { from: year, to: year } });
      })
      .append('title')
      .text('Cliquer une année pour ne garder qu’elle');
  };

  const swatch = <P extends Element>(parent: Sel<P>, f: Frame, iso3: string) => parent.append('span').attr('class', 'cv-swatch').style('background', f.colors.get(iso3) ?? '');

  // ------------------------------------------------------------------ breadcrumb
  function renderCrumbs(f: Frame): void {
    crumbs.selectAll('*').remove();
    const step = (label: string, current: boolean, onClick: () => void) => {
      const li = crumbs.append('li');
      if (current) li.append('span').attr('aria-current', 'page').text(label);
      else li.append('button').attr('type', 'button').attr('class', 'cv-crumb').text(label).on('click', onClick);
    };
    step('Monde', f.level === 'world', () => clearCountries(store));
    if (f.selected.length > 0) step(f.selected.map((iso3) => env.name(iso3)).join(', '), f.level === 'country', () => store.set({ incident: null }));
    if (f.level === 'incident') {
      const found = f.state.incident === null ? undefined : files.find(f.state.incident);
      const c = found?.set.file.columns;
      step(found === undefined || c === undefined ? 'Incident' : incidentDate(c.year[found.index] ?? 0, c.month[found.index], c.day[found.index]), true, () => undefined);
    }
  }

  // ------------------------------------------------------------------ head
  function renderHead(f: Frame): void {
    rebuild(head, (h) => {
      const period = formatRange(f.state.range);
      const against = f.compare === null ? 'pas de période précédente à comparer' : `évolution comparée à ${formatRange(f.compare)}`;
      if (f.level === 'incident') {
        const found = f.state.incident === null ? undefined : files.find(f.state.incident);
        if (found === undefined) {
          h.append('h2').text('Incident');
          return;
        }
        const c = found.set.file.columns;
        const i = found.index;
        h.append('h2').text(incidentDate(c.year[i] ?? 0, c.month[i], c.day[i]));
        h.append('p').attr('class', 'cv-panel-sub').text([c.city[i], env.name(found.set.iso3)].filter((v) => v != null && v !== '' && v !== 'Unknown').join(', '));
        return;
      }
      if (f.selected.length === 0) {
        h.append('h2').text('Monde');
        h.append('p').attr('class', 'cv-panel-sub').text(`${period} · ${against}`);
        return;
      }
      const [only] = f.selected;
      h.append('h2').text(f.selected.length === 1 && only !== undefined ? env.name(only) : `${f.selected.length} pays comparés`);
      const regions = [...new Set(f.selected.map((iso3) => env.region(iso3)).filter((r) => r !== ''))];
      h.append('p').attr('class', 'cv-panel-sub').text([f.selected.length === 1 ? regions.join(' · ') : '', period, against].filter((s) => s !== '').join(' · '));
      // One chip per country: identity colour, name, rank, and the button that removes it.
      const chips = h.append('ul').attr('class', 'cv-selection').attr('aria-label', 'Pays sélectionnés');
      for (const iso3 of f.selected) {
        const li = chips.append('li');
        point(li, { dim: 'country', id: iso3 });
        swatch(li, f, iso3);
        const text = li.append('span').attr('class', 'cv-selection-text');
        text.append('span').attr('class', 'cv-selection-name').text(env.name(iso3));
        const rank = f.ranking.rank.get(iso3);
        text.append('span').attr('class', 'cv-selection-rank').text(rank === undefined ? 'hors classement' : `${ordinal(rank)} sur ${f.ranking.ordered.length}${rankBefore(f, iso3)}`);
        li.append('button')
          .attr('type', 'button')
          .attr('class', 'cv-chip-remove')
          .attr('data-key', `remove-${iso3}`)
          .attr('aria-label', `Retirer ${env.name(iso3)} de la sélection`)
          .attr('title', `Retirer ${env.name(iso3)}`)
          .text('×')
          .on('click', () => toggleCountry(store, iso3));
      }
      const tools = h.append('div').attr('class', 'cv-head-tools');
      tools
        .append('button')
        .attr('type', 'button')
        .attr('class', 'cv-button')
        .attr('data-key', 'clear')
        .text(f.selected.length > 1 ? 'Tout désélectionner' : 'Désélectionner')
        .on('click', () => clearCountries(store));
      if (f.selected.length < MAX_SELECTION) tools.append('span').attr('class', 'cv-caption').text(`Cliquez d’autres pays pour comparer (${MAX_SELECTION} au plus).`);
    });
  }

  function rankBefore(f: Frame, iso3: string): string {
    if (f.compare === null || f.compareRanking === null) return '';
    const before = f.compareRanking.rank.get(iso3);
    return before === undefined ? ` · hors classement en ${formatRange(f.compare)}` : ` · ${ordinal(before)} en ${formatRange(f.compare)}`;
  }

  // ------------------------------------------------------------------ figures
  function renderFigures(f: Frame): void {
    figures.attr('hidden', f.level === 'incident' ? '' : null);
    if (f.level === 'incident') return;
    rebuild(figures, (section) => {
      const columns: { iso3: string | null; figures: CountryFigures }[] =
        f.selected.length === 0 ? [{ iso3: null, figures: f.world }] : f.selected.map((iso3) => ({ iso3, figures: f.figures.get(iso3) ?? f.world }));
      const table = section.append('table').attr('class', 'cv-figures-table').classed('is-wide', columns.length > 2);
      if (columns.length > 1) {
        const row = table.append('thead').append('tr');
        row.append('td');
        for (const column of columns) {
          const th = row.append('th').attr('scope', 'col');
          if (column.iso3 !== null) point(th, { dim: 'country', id: column.iso3 });
          swatch(th, f, column.iso3 ?? '');
          th.append('span').text(env.name(column.iso3 ?? ''));
        }
      }
      const body = table.append('tbody');
      for (const metric of dataset.metrics) {
        const tr = body.append('tr').classed('is-active', metric.id === f.state.metric);
        tr.append('th')
          .attr('scope', 'row')
          .append('button')
          .attr('type', 'button')
          .attr('class', 'cv-metric-switch')
          .attr('data-key', `metric-${metric.id}`)
          .attr('aria-pressed', String(metric.id === f.state.metric))
          .attr('title', `Colorer le globe selon : ${metric.label.toLowerCase()}`)
          .text(metric.label)
          .on('click', () => store.set({ metric: metric.id }));
        for (const column of columns) figureCell(tr.append('td'), f, metric, column.figures, column.iso3 ?? WORLD);
      }
      section.append('p').attr('class', 'cv-caption').text('Cliquez une mesure pour l’appliquer au globe. ↑ : hausse par rapport à la période comparée.');
      // 2.5 % of the base has no valid coordinates: in every figure here, but not on the globe.
      const total = f.selected.length === 0 ? f.world.now.incidents : f.selected.reduce((sum, iso3) => sum + (f.figures.get(iso3)?.now.incidents ?? 0), 0);
      const missing = f.selected.length === 0 ? f.withoutCoordinates.world : [...f.withoutCoordinates.byCountry.values()].reduce((a, b) => a + b, 0);
      if (missing > 0) {
        const share = total > 0 && !f.filtered ? ` (${formatShare(missing / total)})` : '';
        section
          .append('p')
          .attr('class', 'cv-caption')
          .text(`${plural(missing, 'incident')}${share} sans coordonnées sur la période : comptés dans ces chiffres, absents du globe${f.filtered ? ' (compte sans les filtres)' : ''}.`);
      }
    });
  }

  function figureCell(td: Sel<HTMLTableCellElement>, f: Frame, metric: MetricDef, figures: CountryFigures, code: string): void {
    const now = metricOf(figures.now, metric, f.covered);
    td.append('span').attr('class', 'cv-fig-value').text(formatValue(now, metric));
    if (metric.kind !== 'mean' && env.population !== null) {
      const rate = perMillion(now, env.population.mean(code, f.state.range));
      if (!Number.isNaN(rate)) td.append('span').attr('class', 'cv-fig-rate').text(`${formatRate(rate)} par million d’hab.`);
    }
    if (f.compare !== null && figures.before !== null) {
      const before = metricOf(figures.before, metric, model.coveredYears(f.compare) > 0);
      const change = describeChange(now, before);
      // More terrorism is worse: a rise reads as a deterioration (arrow + words, never colour alone).
      const arrow = change.kind === 'up' ? '↑ ' : change.kind === 'down' ? '↓ ' : '';
      td.append('span')
        .attr('class', `cv-fig-delta ${change.kind === 'up' ? 'is-worse' : change.kind === 'down' ? 'is-better' : ''}`)
        .attr('title', `${formatRange(f.compare)} : ${formatWithUnit(before, metric)}`)
        .text(change.kind === 'none' ? '' : `${arrow}${change.text}`);
    }
    const share = knownShareOf(figures.now, metric);
    if (metric.kind !== 'count' && !Number.isNaN(share) && share < 0.995) td.append('span').attr('class', 'cv-fig-note').text(`connu pour ${formatShare(share)}`);
  }

  // ------------------------------------------------------------------ hovered country (world)
  function renderHovered(f: Frame): void {
    hovered.attr('hidden', f.level === 'world' ? null : '');
    if (f.level !== 'world') return;
    rebuild(hovered, (section) => {
      const iso3 = hoverIso;
      if (iso3 === null || env.countries.entities[iso3] === undefined) {
        section.append('p').attr('class', 'cv-invite').text('Survolez un pays pour lire sa valeur et son rang ; cliquez-le pour l’ajouter à la sélection.');
        return;
      }
      const value = f.values.get(iso3) ?? Number.NaN;
      const rank = f.ranking.rank.get(iso3);
      section.append('h3').text(env.name(iso3));
      section.append('p').attr('class', 'cv-hovered-value').text(f.display.withUnit(value));
      section
        .append('p')
        .attr('class', 'cv-caption')
        .text(rank === undefined ? 'Hors classement sur la période' : `${ordinal(rank)} pays sur ${f.ranking.ordered.length}${rankBefore(f, iso3)}`);
    });
  }

  // ------------------------------------------------------------------ small multiples (selection)
  /** Yearly values of one country, raw or per million inhabitants like the globe. */
  function seriesOf(f: Frame, iso3: string): Float64Array {
    const c = model.countryOf(iso3);
    const series = model.series(f.table, c < 0 ? [] : [c], f.metric);
    const population = env.population;
    if (f.display.perCapita && population !== null) series.forEach((v, y) => (series[y] = perMillion(v, population.at(iso3, model.first + y))));
    return series;
  }

  /**
   * One yearly curve per selected country, with the same time axis. Two readings (D21):
   * - one scale per country (juxtaposition): the shapes, the peaks and the onsets compare at a
   *   glance, whatever the magnitudes;
   * - an index, base 100 = the country's mean over the chosen period: the curves share one scale
   *   and are superposed, so that trajectories (rise, decline, timing) compare directly.
   * Both are static, which suits analysis better than the animation (Robertson et al. 2008).
   */
  function renderTrends(f: Frame): void {
    trends.attr('hidden', f.level === 'country' ? null : '');
    if (f.level !== 'country') return;
    const indexed = f.state.ext['map.index'] === '1';
    rebuild(trends, (section) => {
      const header = section.append('div').attr('class', 'cv-trend-head');
      header.append('h3').text(`${f.display.label} par an`);
      const switcher = header.append('div').attr('class', 'cv-segmented cv-segmented-small').attr('role', 'radiogroup').attr('aria-label', 'Échelle des courbes');
      for (const option of [
        { id: '0', label: 'Une échelle par pays' },
        { id: '1', label: 'Indice base 100' },
      ]) {
        const on = (option.id === '1') === indexed;
        switcher
          .append('button')
          .attr('type', 'button')
          .attr('role', 'radio')
          .attr('data-key', `index-${option.id}`)
          .attr('aria-checked', String(on))
          .classed('is-active', on)
          .text(option.label)
          .on('click', () => store.set((s) => ({ ext: { ...s.ext, 'map.index': option.id } })));
      }
      if (indexed) indexChart(section, f);
      else multiples(section, f);
    });
  }

  function multiples(section: Sel<HTMLElement>, f: Frame): void {
    const list = section.append('ul').attr('class', 'cv-trend-list');
    for (const iso3 of f.selected) {
      const series = seriesOf(f, iso3);
      let max = 0;
      let peak = model.first;
      series.forEach((v, y) => {
        if (Number.isFinite(v) && v > max) {
          max = v;
          peak = model.first + y;
        }
      });
      const li = list.append('li');
      point(li, { dim: 'country', id: iso3 });
      const label = li.append('div').attr('class', 'cv-trend-label');
      swatch(label, f, iso3);
      label.append('span').text(env.name(iso3));
      label.append('span').attr('class', 'cv-trend-max').text(max > 0 ? `max ${f.display.format(max)} (${peak})` : 'aucun');
      const svg = li
        .append('svg')
        .attr('class', 'cv-trend')
        .attr('viewBox', `0 0 ${model.span} 24`)
        .attr('preserveAspectRatio', 'none')
        .attr('role', 'img')
        .attr('aria-label', `${env.name(iso3)} : ${f.display.label.toLowerCase()} par an, maximum ${f.display.format(max)} en ${peak}`);
      pickYear(svg, (x, width) => model.first + Math.floor((x / width) * model.span));
      svg
        .append('rect')
        .attr('class', 'cv-trend-window')
        .attr('x', f.state.range.from - model.first)
        .attr('width', f.state.range.to - f.state.range.from + 1)
        .attr('height', 24);
      series.forEach((v, y) => {
        if (!Number.isFinite(v)) {
          svg.append('rect').attr('class', 'cv-trend-gap').attr('x', y + 0.15).attr('y', 0).attr('width', 0.7).attr('height', 24);
          return;
        }
        const h = max > 0 ? (22 * v) / max : 0;
        svg
          .append('rect')
          .attr('x', y + 0.1)
          .attr('y', 24 - h)
          .attr('width', 0.8)
          .attr('height', h)
          .attr('fill', f.colors.get(iso3) ?? '#555');
      });
    }
    section.append('p').attr('class', 'cv-caption').text('1970 → 2017, une échelle par pays · le fond marque la période · hachuré : 1993, pas de donnée.');
  }

  function indexChart(section: Sel<HTMLElement>, f: Frame): void {
    const W = 320;
    const H = 120;
    const pad = { left: 30, right: 8, top: 8, bottom: 16 };
    const x = (year: number) => pad.left + ((year - model.first + 0.5) / model.span) * (W - pad.left - pad.right);
    const lines: { iso3: string; points: [number, number][]; base: number }[] = [];
    const without: string[] = [];
    let top = 100;
    for (const iso3 of f.selected) {
      const series = seriesOf(f, iso3);
      let sum = 0;
      let n = 0;
      for (let year = f.state.range.from; year <= f.state.range.to; year++) {
        const v = series[year - model.first] ?? Number.NaN;
        if (Number.isFinite(v)) {
          sum += v;
          n++;
        }
      }
      const base = n === 0 ? 0 : sum / n;
      if (!(base > 0)) {
        without.push(env.name(iso3));
        continue;
      }
      const points: [number, number][] = [];
      series.forEach((v, y) => {
        if (!Number.isFinite(v)) return;
        const index = (100 * v) / base;
        points.push([model.first + y, index]);
        if (index > top) top = index;
      });
      lines.push({ iso3, points, base });
    }
    const y = (index: number) => H - pad.bottom - (index / top) * (H - pad.top - pad.bottom);
    const svg = section
      .append('svg')
      .attr('class', 'cv-index')
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('role', 'img')
      .attr(
        'aria-label',
        `Indice base 100 (moyenne de ${formatRange(f.state.range)}) : ${lines.map((l) => `${env.name(l.iso3)} jusqu’à ${Math.round(Math.max(...l.points.map((p) => p[1])))}`).join(', ')}`,
      );
    pickYear(svg, (px, width) => model.first + Math.floor((((px / width) * W - pad.left) / (W - pad.left - pad.right)) * model.span));
    svg
      .append('rect')
      .attr('class', 'cv-index-window')
      .attr('x', x(f.state.range.from) - (x(model.first + 1) - x(model.first)) / 2)
      .attr('width', ((f.state.range.to - f.state.range.from + 1) / model.span) * (W - pad.left - pad.right))
      .attr('y', pad.top)
      .attr('height', H - pad.top - pad.bottom);
    for (const tick of [0, 100, Math.round(top)].filter((t, i, all) => all.indexOf(t) === i && (t === 100 || t === 0 || top - 100 > top * 0.15))) {
      svg.append('line').attr('class', tick === 100 ? 'cv-index-base' : 'cv-index-grid').attr('x1', pad.left).attr('x2', W - pad.right).attr('y1', y(tick)).attr('y2', y(tick));
      svg.append('text').attr('class', 'cv-index-tick').attr('x', pad.left - 4).attr('y', y(tick) + 3).text(String(tick));
    }
    for (const year of [model.first, 1990, 2010, model.last]) {
      svg.append('text').attr('class', 'cv-index-year').attr('x', x(year)).attr('y', H - 3).text(String(year));
    }
    for (const line of lines) {
      // A gap year (1993) breaks the line instead of being drawn as a fall to zero.
      let d = '';
      let previous: number | null = null;
      for (const [year, index] of line.points) {
        d += `${previous !== null && year === previous + 1 ? 'L' : 'M'}${x(year).toFixed(1)},${y(index).toFixed(1)}`;
        previous = year;
      }
      svg.append('path').attr('class', 'cv-index-line').attr('d', d).attr('stroke', f.colors.get(line.iso3) ?? '#555');
    }
    const keys = section.append('div').attr('class', 'cv-legend-row');
    for (const line of lines) {
      swatch(keys, f, line.iso3);
      keys.append('span').text(`${env.name(line.iso3)} (100 = ${f.display.format(line.base)} par an)`);
    }
    section
      .append('p')
      .attr('class', 'cv-caption')
      .text(
        `Base 100 = moyenne annuelle de chaque pays sur ${formatRange(f.state.range)} (fond bleu) ; une seule échelle pour tous.${without.length > 0 ? ` Sans indice (aucune valeur sur la période) : ${without.join(', ')}.` : ''}`,
      );
  }

  // ------------------------------------------------------------------ organizations
  function renderGroups(f: Frame): void {
    groups.attr('hidden', f.level === 'incident' ? '' : null);
    if (f.level === 'incident') return;
    rebuild(groups, (section) => {
      section.append('h3').text('Organisations');
      const unit = weightUnit(f.metric);
      const chosen = new Set(f.state.filters.group ?? []);
      const blocks: { iso3: string | null; breakdown: Breakdown | undefined; activity: ReadonlyMap<number, Float64Array> | undefined }[] =
        f.selected.length === 0
          ? [{ iso3: null, breakdown: f.scan.combined, activity: undefined }]
          : f.selected.map((iso3) => {
              const c = model.countryOf(iso3);
              return { iso3, breakdown: f.scan.perCountry.get(c), activity: f.scan.groupActivity.get(c) };
            });
      const shown = f.selected.length > 1 ? 3 : 5;
      for (const { iso3, breakdown, activity } of blocks) {
        const block = section.append('div').attr('class', 'cv-groups-block');
        if (iso3 !== null && f.selected.length > 1) {
          const title = block.append('p').attr('class', 'cv-block-title');
          swatch(title, f, iso3);
          title.append('span').text(env.name(iso3));
        }
        if (breakdown === undefined || breakdown.total.incidents === 0) {
          block.append('p').attr('class', 'cv-empty').text('Aucun incident sur la période.');
          continue;
        }
        const unknown = [...breakdown.group].find(([g]) => model.dict.group[g] === UNKNOWN_GROUP)?.[1].incidents ?? 0;
        const rows = [...breakdown.group]
          .filter(([g, t]) => t.incidents > 0 && model.dict.group[g] !== UNKNOWN_GROUP)
          .map(([g, totals]) => ({ g, name: model.dict.group[g] ?? '', totals, weight: weightOf(totals, f.metric) }))
          .sort((a, b) => b.weight - a.weight || b.totals.incidents - a.totals.incidents)
          .slice(0, shown);
        const list = block.append('ol').attr('class', 'cv-group-list');
        const peak = Math.max(1, ...rows.map((r) => Math.max(...(activity?.get(r.g) ?? [0]))));
        for (const row of rows) {
          const li = list.append('li');
          point(li, { dim: 'group', id: row.name });
          const line = li.append('div').attr('class', 'cv-group-line');
          line
            .append('button')
            .attr('type', 'button')
            .attr('class', 'cv-group-name')
            .attr('data-key', `group-${row.g}`)
            .attr('aria-pressed', String(chosen.has(row.name)))
            .attr('title', chosen.has(row.name) ? 'Retirer ce filtre' : 'Ne montrer que cette organisation, partout')
            .text(categoryLabel('group', row.name))
            .on('click', () => toggleGroup(row.name));
          line.append('span').attr('class', 'cv-group-value').text(`${formatCount(row.weight)} ${unit}`);
          if (!isNamedGroup(row.name)) li.append('span').attr('class', 'cv-tag').text('étiquette générique');
          if (activity !== undefined) strip(li, f, activity.get(row.g), peak);
        }
        if (rows.length === 0) block.append('p').attr('class', 'cv-empty').text('Aucune organisation identifiée sur la période.');
        block.append('p').attr('class', 'cv-caption').text(`Auteur inconnu pour ${formatShare(unknown / breakdown.total.incidents)} des incidents.`);
      }
      section
        .append('p')
        .attr('class', 'cv-caption')
        .text(f.selected.length > 0 ? 'Cliquez une organisation pour ne montrer qu’elle. Frise : incidents par an, 1970–2017 ; le cadre marque la période.' : 'Cliquez une organisation pour ne montrer qu’elle sur le globe et dans les chiffres.');
    });
  }

  function toggleGroup(name: string): void {
    store.set((s) => {
      const current = s.filters.group ?? [];
      return { filters: { ...s.filters, group: current.includes(name) ? current.filter((v) => v !== name) : [...current, name] } };
    });
  }

  /** Activity strip of a group: one cell per year of the span, darker when more active. */
  function strip(parent: Sel<HTMLLIElement>, f: Frame, years: Float64Array | undefined, peak: number): void {
    const cells = parent.append('div').attr('class', 'cv-strip').attr('role', 'img');
    let first: number | null = null;
    let last: number | null = null;
    let best = 0;
    let bestYear = 0;
    for (let y = 0; y < model.span; y++) {
      const year = model.first + y;
      const value = years?.[y] ?? 0;
      const cell = cells.append('span');
      if (model.gaps.includes(year)) cell.attr('class', 'is-gap');
      else if (value > 0) {
        cell.style('background', env.palette.sequential(Math.sqrt(value / peak)));
        first ??= year;
        last = year;
        if (value > best) {
          best = value;
          bestYear = year;
        }
      }
    }
    const left = ((f.state.range.from - model.first) / model.span) * 100;
    const width = ((f.state.range.to - f.state.range.from + 1) / model.span) * 100;
    cells.append('span').attr('class', 'cv-strip-window').style('left', `${left}%`).style('width', `${width}%`);
    const text = first === null ? 'Aucune activité' : `Active de ${first} à ${last ?? first} ; année la plus active : ${bestYear} (${plural(best, 'incident')})`;
    cells.attr('aria-label', text).attr('title', text);
  }

  // ------------------------------------------------------------------ deadliest incidents
  function worldEntries(f: Frame): Deadly[] | null {
    if (topEvents === null) {
      if (topEventsState === 'idle') {
        topEventsState = 'loading';
        data
          .topEvents()
          .then((file) => {
            topEvents = file;
            topEventsState = 'idle';
            if (frame !== null) renderDeadliest(frame);
          })
          .catch(() => {
            topEventsState = 'failed';
            if (frame !== null) renderDeadliest(frame);
          });
      }
      return null;
    }
    const attack = f.filters.attackType;
    const group = f.filters.group;
    const entries: Deadly[] = [];
    for (const [iso3, list] of Object.entries(topEvents.countries)) {
      for (const e of list as IncidentSummary[]) {
        if (e.year < f.state.range.from || e.year > f.state.range.to) continue;
        if (attack !== null && !attack.has(e.attackType)) continue;
        if (group !== null && !group.has(e.group)) continue;
        entries.push({ ...e, iso3 });
      }
    }
    return entries;
  }

  function selectionEntries(f: Frame): Deadly[] {
    const entries: Deadly[] = [];
    for (const iso3 of f.selected) {
      const set = files.get(iso3);
      if (set === undefined) continue;
      const c = set.file.columns;
      for (const i of files.visible(iso3, f.filters, f.state.range)) {
        entries.push({
          eventId: c.eventId[i] ?? '',
          iso3,
          year: c.year[i] ?? 0,
          month: c.month[i] ?? null,
          day: c.day[i] ?? null,
          city: c.city[i] ?? null,
          killed: c.killed[i] ?? null,
          wounded: c.wounded[i] ?? null,
          attackType: incidentCategory(set, 'attackType', i),
          group: incidentCategory(set, 'group', i),
        });
      }
    }
    return entries;
  }

  function renderDeadliest(f: Frame): void {
    actions.previewIncident(null);
    deadliest.attr('hidden', f.level === 'incident' ? '' : null);
    if (f.level === 'incident') return;
    rebuild(deadliest, (section) => {
      section.append('h3').text('Les plus meurtriers');
      const world = f.selected.length === 0;
      if (!world && files.missing(f.selected)) {
        section.append('p').attr('class', 'cv-empty').text('Chargement des incidents…');
        return;
      }
      const entries = world ? worldEntries(f) : selectionEntries(f);
      if (entries === null) {
        section.append('p').attr('class', 'cv-empty').text(topEventsState === 'failed' ? 'Liste indisponible.' : 'Chargement…');
        return;
      }
      entries.sort((a, b) => (b.killed ?? -1) - (a.killed ?? -1) || (b.wounded ?? -1) - (a.wounded ?? -1) || (a.eventId < b.eventId ? -1 : 1));
      const top = entries.slice(0, INCIDENTS_SHOWN);
      if (top.length === 0) {
        section.append('p').attr('class', 'cv-empty').text('Aucun incident sur la période.');
        return;
      }
      const list = section.append('ol').attr('class', 'cv-incident-list');
      for (const e of top) {
        const button = list
          .append('li')
          .append('button')
          .attr('type', 'button')
          .attr('data-key', `incident-${e.eventId}`)
          .on('click', () => void files.ensure([e.iso3]).then(() => store.set({ incident: e.eventId })))
          .on('mouseenter focus', () => actions.previewIncident(e.eventId))
          .on('mouseleave blur', () => actions.previewIncident(null));
        button
          .append('span')
          .attr('class', 'cv-incident-killed')
          .text(e.killed === null ? '?' : formatCount(e.killed));
        const text = button.append('span').attr('class', 'cv-incident-text');
        const title = text.append('span').attr('class', 'cv-incident-title');
        if (f.selected.length > 1) swatch(title, f, e.iso3);
        const place = [e.city === 'Unknown' ? null : e.city, f.selected.length === 1 ? null : env.name(e.iso3)].filter((v) => v != null && v !== '').join(', ');
        title.append('span').text(`${incidentDate(e.year, e.month, e.day)}${place === '' ? '' : ` · ${place}`}`);
        text.append('span').attr('class', 'cv-incident-meta').text(`${categoryLabel('attackType', e.attackType)} · ${categoryLabel('group', e.group)}`);
      }
      section.append('p').attr('class', 'cv-caption').text('Nombre de morts à gauche · cliquez pour la fiche et le résumé.');
    });
  }

  // ------------------------------------------------------------------ incident sheet
  function renderSheet(f: Frame): void {
    sheet.attr('hidden', f.level === 'incident' ? null : '');
    if (f.level !== 'incident') {
      summaryFor = '';
      return;
    }
    const id = f.state.incident ?? '';
    if (summaryFor === id) return; // the sheet does not depend on the window or the metric
    const found = files.find(id);
    if (found === undefined) {
      sheet.selectAll('*').remove();
      sheet.append('p').attr('class', 'cv-empty').text('Chargement de l’incident…');
      return;
    }
    summaryFor = id;
    rebuild(sheet, (section) => {
      const { set, index: i } = found;
      const c = set.file.columns;
      const facts = section.append('dl').attr('class', 'cv-facts');
      const fact = (label: string, value: string) => {
        facts.append('dt').text(label);
        facts.append('dd').text(value);
      };
      fact('Morts', c.killed[i] == null ? 'inconnu' : formatCount(c.killed[i] ?? 0));
      fact('Blessés', c.wounded[i] == null ? 'inconnu' : formatCount(c.wounded[i] ?? 0));
      fact('Attaque', categoryLabel('attackType', incidentCategory(set, 'attackType', i)));
      fact('Cible', categoryLabel('targetType', incidentCategory(set, 'targetType', i)));
      fact('Arme', categoryLabel('weaponType', incidentCategory(set, 'weaponType', i)));
      fact('Organisation', categoryLabel('group', incidentCategory(set, 'group', i)));
      fact('Attentat-suicide', c.suicide[i] === 1 ? 'oui' : 'non');
      const summary = section.append('blockquote').attr('class', 'cv-summary').attr('lang', 'en').text('Chargement du résumé…');
      section.append('p').attr('class', 'cv-caption').text(`Résumé de la GTD, en anglais · identifiant ${id}`);
      section
        .append('button')
        .attr('type', 'button')
        .attr('class', 'cv-link-button')
        .attr('data-key', 'back')
        .text('Fermer la fiche')
        .on('click', () => store.set({ incident: null }));
      const token = ++summaryToken;
      data
        .summaries(set.iso3)
        .then((file) => {
          if (token === summaryToken) summary.text(file.summaries[id] ?? 'Pas de résumé pour cet incident dans la GTD.');
        })
        .catch(() => {
          if (token === summaryToken) summary.text('Résumé indisponible.');
        });
    });
  }

  // ------------------------------------------------------------------ search
  function renderSearch(f: Frame): void {
    search.attr('hidden', f.level === 'incident' ? '' : null);
    if (search.select('input').size() > 0) return;
    const wrap = search.append('label').attr('class', 'cv-search-field');
    wrap.append('span').text('Ajouter un pays');
    wrap
      .append('input')
      .attr('type', 'search')
      .attr('list', listId)
      .attr('autocomplete', 'off')
      .attr('placeholder', 'Nom du pays')
      .on('change', (event: Event) => {
        const target = event.target as HTMLInputElement;
        const iso3 = byName.get(normalize(target.value));
        if (iso3 === undefined) return;
        target.value = '';
        if (!selectedHas(iso3)) toggleCountry(store, iso3);
      });
  }

  function selectedHas(iso3: string): boolean {
    return frame?.selected.includes(iso3) ?? false;
  }

  function renderNote(f: Frame): void {
    if (f.level !== 'world') {
      note.text('');
      return;
    }
    const rest = model.countryOf('');
    const hidden = rest < 0 ? 0 : model.totals(f.table, [rest], f.state.range).incidents;
    note.text(
      `Données de la GTD (version 2018), de 1970 à 2017. ${plural(hidden, 'incident')} de ${formatRange(f.state.range)} sans pays représentable (URSS, Yougoslavie, Tchécoslovaquie, Serbie-Monténégro, Kosovo, « International ») : absents du globe, comptés dans le monde.`,
    );
  }

  return {
    update(next) {
      frame = next;
      root.classed('is-compare', next.selected.length > 1);
      // A new level slides in (200 ms, none with reduced motion): the panel visibly changes subject.
      const key = `${next.level}|${next.selected.join(',')}|${next.state.incident ?? ''}`;
      const node = scroll.node();
      if (key !== levelKey && levelKey !== '' && node !== null) {
        node.classList.remove('is-entering');
        void node.offsetWidth;
        node.classList.add('is-entering');
      }
      levelKey = key;
      renderCrumbs(next);
      renderHead(next);
      renderFigures(next);
      renderHovered(next);
      renderTrends(next);
      renderGroups(next);
      renderDeadliest(next);
      renderSheet(next);
      renderSearch(next);
      renderNote(next);
    },
    hover(iso3) {
      if (iso3 === hoverIso) return;
      hoverIso = iso3;
      if (frame !== null) renderHovered(frame);
    },
  };
}

function normalize(name: string): string {
  return name.trim().toLocaleLowerCase('fr').normalize('NFD').replace(/\p{Diacritic}/gu, '');
}
