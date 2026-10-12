import { interval, scaleLinear, type Timer } from 'd3';
import { formatValue, formatWithUnit } from './format';
import { MIN_INCIDENTS_FOR_MEAN, rank, type Env, type Frame } from './frame';
import { metricOf } from './model';
import { toggleCountry } from './selection';
import type { Card } from './ui';

const TOP = 10;
const W = 560;
const ROW = 26;
const LABEL_WIDTH = 150;
const STEP_MS = 900;
const NEUTRAL = '#b9b8b1';

export interface Race {
  update(frame: Frame): void;
  highlight(hovered: string | null): void;
  destroy(): void;
}

/**
 * Ranking of the countries that moves with time (T11, T12): for each year of the period, the top 10
 * by the metric, cumulated since the start of the period or for the year alone. The selected
 * countries keep their colour, the others stay grey (emphasis).
 */
export function createRace(env: Env, card: Card): Race {
  const { store, model, tooltip } = env;
  const controls = card.header.append('div').attr('class', 'cv-tools');
  const play = controls.append('button').attr('type', 'button').attr('class', 'cv-play').attr('aria-label', 'Lancer l’animation');
  const slider = controls.append('input').attr('type', 'range').attr('step', 1).attr('aria-label', 'Année du classement');
  const yearLabel = controls.append('output').attr('class', 'cv-race-year');
  const modes = controls.append('div').attr('class', 'cv-segmented').attr('role', 'radiogroup').attr('aria-label', 'Mode du classement');
  const modeButtons = modes
    .selectAll('button')
    .data([
      { id: 'cumul', label: 'Cumulé' },
      { id: 'year', label: 'Annuel' },
    ])
    .join('button')
    .attr('type', 'button')
    .attr('role', 'radio')
    .text((m) => m.label)
    .on('click', (_event: MouseEvent, m) => store.set((s) => ({ ext: { ...s.ext, 'map.race': m.id } })));

  const svg = card.body.append('svg').attr('class', 'cv-chart').attr('viewBox', `0 0 ${W} ${TOP * ROW + 8}`).attr('role', 'img');
  const bars = svg.append('g');

  let frame: Frame | null = null;
  let year = 0;
  let timer: Timer | null = null;
  let hovered: string | null = null;

  function render(animate: boolean): void {
    if (frame === null) return;
    const f = frame;
    const { range } = f.state;
    const cumulative = f.state.ext['map.race'] !== 'year';
    const window = cumulative ? { from: range.from, to: year } : { from: year, to: year };
    const covered = model.coveredYears(window) > 0;
    const values = new Map<string, number>();
    const incidents = new Map<string, number>();
    for (const iso3 of env.drawable) {
      const c = model.countryOf(iso3);
      const totals = model.totals(f.table, c < 0 ? [] : [c], window);
      values.set(iso3, metricOf(totals, f.metric, covered));
      incidents.set(iso3, totals.incidents);
    }
    const ranking = rank(values, incidents, f.metric);
    const top = ranking.ordered.slice(0, TOP);
    const best = values.get(top[0] ?? '') ?? 1;
    const x = scaleLinear().domain([0, best > 0 ? best : 1]).range([0, W - LABEL_WIDTH - 70]);
    yearLabel.text(cumulative ? `${range.from}–${year}` : model.gaps.includes(year) ? `${year} (aucune donnée)` : String(year));
    card.caption.text(
      `${f.metric.label}${cumulative ? ` cumulés depuis ${range.from}` : ' de l’année'}` +
        (f.metric.kind === 'mean' ? ` · pays d’au moins ${MIN_INCIDENTS_FOR_MEAN} incidents` : '') +
        ' · cliquez sur une barre pour comparer le pays',
    );
    svg.attr('aria-label', `Classement ${yearLabel.text()} : ${top.map((iso3) => env.name(iso3)).join(', ')}`);

    const duration = animate ? STEP_MS * 0.85 : 0;
    const rows = bars
      .selectAll<SVGGElement, string>('g.cv-race-row')
      .data(top, (iso3) => iso3)
      .join(
        (enter) => {
          const g = enter
            .append('g')
            .attr('class', 'cv-race-row')
            .attr('transform', `translate(0, ${TOP * ROW})`)
            .attr('opacity', 0);
          g.append('text').attr('class', 'cv-race-rank').attr('x', 14).attr('y', ROW / 2).attr('text-anchor', 'end').attr('dominant-baseline', 'middle');
          g.append('text').attr('class', 'cv-race-name').attr('x', LABEL_WIDTH - 8).attr('y', ROW / 2).attr('text-anchor', 'end').attr('dominant-baseline', 'middle');
          g.append('rect').attr('class', 'cv-bar').attr('x', LABEL_WIDTH).attr('y', (ROW - 16) / 2).attr('height', 16).attr('rx', 4).attr('width', 0);
          g.append('text').attr('class', 'cv-bar-value').attr('y', ROW / 2).attr('dominant-baseline', 'middle');
          g.append('rect').attr('class', 'cv-hit').attr('x', 0).attr('width', W).attr('height', ROW);
          return g;
        },
        (update) => update,
        (exit) => (animate ? exit.transition().duration(duration).attr('opacity', 0).attr('transform', `translate(0, ${TOP * ROW})`).remove() : exit.remove()),
      );
    const rowY = (_iso3: string, i: number) => `translate(0, ${i * ROW + 4})`;
    const barWidth = (iso3: string) => Math.max(1, x(values.get(iso3) ?? 0));
    const valueX = (iso3: string) => LABEL_WIDTH + x(values.get(iso3) ?? 0) + 6;
    rows.select('.cv-race-rank').text((iso3) => String(ranking.rank.get(iso3) ?? ''));
    rows.select('.cv-race-name').text((iso3) => env.name(iso3));
    const bar = rows
      .select('.cv-bar')
      .attr('fill', (iso3) => f.colors.get(iso3) ?? NEUTRAL)
      .classed('is-hover', (iso3) => iso3 === hovered);
    const label = rows.select('.cv-bar-value').text((iso3) => formatValue(values.get(iso3) ?? Number.NaN, f.metric));
    // Without animation the positions apply at once: a transition waits for a frame, which a
    // hidden or printed page never draws.
    if (animate) {
      rows.transition().duration(duration).attr('opacity', 1).attr('transform', rowY);
      bar.transition().duration(duration).attr('width', barWidth);
      label.transition().duration(duration).attr('x', valueX);
    } else {
      rows.interrupt().attr('opacity', 1).attr('transform', rowY);
      bar.interrupt().attr('width', barWidth);
      label.interrupt().attr('x', valueX);
    }
    rows
      .select('.cv-hit')
      .on('click', (_event: MouseEvent, iso3) => toggleCountry(store, iso3))
      .on('pointerenter', (_event: PointerEvent, iso3) => store.set({ hover: { dim: 'country', id: iso3 } }))
      .on('pointermove', (event: PointerEvent, iso3) =>
        tooltip.show(event, `${env.name(iso3)} · ${yearLabel.text()}`, [
          { text: `${formatWithUnit(values.get(iso3) ?? Number.NaN, f.metric)} · ${ranking.rank.get(iso3) ?? ''}e`, strong: true, key: f.colors.get(iso3) ?? NEUTRAL },
        ]),
      )
      .on('pointerleave', () => {
        tooltip.hide();
        store.set({ hover: null });
      });
    bars.selectAll('.cv-race-empty').remove();
    if (top.length === 0) {
      bars.append('text').attr('class', 'cv-race-empty cv-empty-svg').attr('x', W / 2).attr('y', (TOP * ROW) / 2).attr('text-anchor', 'middle').text('Aucun pays à classer pour cette année.');
    }
  }

  function stop(): void {
    timer?.stop();
    timer = null;
    play.classed('is-playing', false).attr('aria-label', 'Lancer l’animation');
  }

  play.on('click', () => {
    if (frame === null) return;
    if (timer !== null) {
      stop();
      return;
    }
    const { range } = frame.state;
    if (year >= range.to) year = range.from;
    render(false);
    play.classed('is-playing', true).attr('aria-label', 'Mettre en pause');
    timer = interval(() => {
      if (frame === null || year >= frame.state.range.to) {
        stop();
        return;
      }
      year += 1;
      slider.property('value', year);
      render(true);
    }, STEP_MS);
  });

  slider.on('input', (event: Event) => {
    stop();
    year = Number((event.target as HTMLInputElement).value);
    render(true);
  });

  return {
    update(next) {
      const previous = frame;
      frame = next;
      const { range } = next.state;
      slider.attr('min', range.from).attr('max', range.to);
      const rangeChanged = previous === null || previous.state.range !== range;
      if (rangeChanged && timer === null) year = range.to;
      year = Math.min(Math.max(year, range.from), range.to);
      slider.property('value', year);
      const cumulative = next.state.ext['map.race'] !== 'year';
      modeButtons.attr('aria-checked', (m) => String((m.id === 'cumul') === cumulative)).classed('is-active', (m) => (m.id === 'cumul') === cumulative);
      render(previous !== null && !rangeChanged);
    },
    highlight(next) {
      hovered = next;
      bars.selectAll<SVGRectElement, string>('.cv-bar').classed('is-hover', (iso3) => iso3 === hovered);
    },
    destroy() {
      stop();
      svg.selectAll('*').interrupt();
    },
  };
}
