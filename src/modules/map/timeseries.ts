import { axisBottom, axisLeft, line, max, pointer, scaleLinear, type ScaleLinear } from 'd3';
import { formatRange, formatWithUnit } from './format';
import type { Env, Frame } from './frame';
import type { Card } from './ui';

const W = 560;
const H = 220;
const M = { top: 12, right: 16, bottom: 26, left: 52 };

interface Series {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly values: Float64Array;
}

export interface TimeSeries {
  update(frame: Frame): void;
}

/**
 * Yearly values of the metric over the whole span, one line per selected country (the world when
 * nothing is selected): trend (T2), periods (T3, T9). One axis; years without data break the line.
 */
export function createTimeSeries(env: Env, card: Card): TimeSeries {
  const { model, palette, tooltip } = env;
  const legend = card.body.append('div').attr('class', 'cv-series-legend');
  const svg = card.body
    .append('svg')
    .attr('class', 'cv-chart')
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('role', 'img');
  const bands = svg.append('g');
  const grid = svg.append('g').attr('class', 'cv-grid');
  const xAxis = svg.append('g').attr('class', 'cv-axis').attr('transform', `translate(0,${H - M.bottom})`);
  const yAxis = svg.append('g').attr('class', 'cv-axis').attr('transform', `translate(${M.left},0)`);
  const lines = svg.append('g');
  const cross = svg.append('line').attr('class', 'cv-crosshair').attr('y1', M.top).attr('y2', H - M.bottom).attr('hidden', '');
  const dots = svg.append('g');
  const hit = svg.append('rect').attr('class', 'cv-hit').attr('x', M.left).attr('y', M.top).attr('width', W - M.left - M.right).attr('height', H - M.top - M.bottom);

  const x = scaleLinear().domain([model.first, model.last]).range([M.left, W - M.right]);

  return {
    update(frame) {
      const { state, metric } = frame;
      const series: Series[] =
        frame.selected.length === 0
          ? [{ id: 'world', label: frame.filtered ? 'Monde (filtré)' : 'Monde', color: palette.sequential(0.85), values: model.series(frame.table, null, metric) }]
          : frame.selected.map((iso3) => ({
              id: iso3,
              label: env.name(iso3),
              color: frame.colors.get(iso3) ?? '#555',
              values: model.series(frame.table, [model.countryOf(iso3)], metric),
            }));
      card.caption.text(`${metric.label} par année, ${model.first}–${model.last} · bande foncée : ${formatRange(state.range)}${state.compare === null ? '' : ` · bande claire : ${formatRange(state.compare)}`}`);
      svg.attr('aria-label', `${metric.label} par année pour ${series.map((s) => s.label).join(', ')}`);

      legend
        .selectAll<HTMLSpanElement, Series>('span.cv-series-key')
        .data(series.length > 1 ? series : [], (s) => s.id)
        .join((enter) => {
          const s = enter.append('span').attr('class', 'cv-series-key');
          s.append('span').attr('class', 'cv-line-key');
          s.append('span');
          return s;
        })
        .call((s) => s.select('.cv-line-key').style('background', (d) => d.color))
        .call((s) => s.select('span:last-child').text((d) => d.label));

      const top = max(series, (s) => max(s.values, (v) => (Number.isNaN(v) ? 0 : v))) ?? 0;
      const y: ScaleLinear<number, number> = scaleLinear()
        .domain([0, top > 0 ? top : 1])
        .nice()
        .range([H - M.bottom, M.top]);

      bands.selectAll('*').remove();
      const band = (range: { from: number; to: number }, cls: string) =>
        bands
          .append('rect')
          .attr('class', cls)
          .attr('x', x(range.from - 0.5))
          .attr('width', Math.max(2, x(range.to + 0.5) - x(range.from - 0.5)))
          .attr('y', M.top)
          .attr('height', H - M.top - M.bottom);
      if (state.compare !== null) band(state.compare, 'cv-band-compare');
      band(state.range, 'cv-band');
      for (const gap of model.gaps) {
        bands
          .append('rect')
          .attr('class', 'cv-band-gap')
          .attr('x', x(gap - 0.5))
          .attr('width', x(gap + 0.5) - x(gap - 0.5))
          .attr('y', M.top)
          .attr('height', H - M.top - M.bottom)
          .attr('fill', palette.ensureNoDataPattern(svg.node() as SVGSVGElement));
      }

      grid.call((g) =>
        g
          .selectAll('line')
          .data(y.ticks(4))
          .join('line')
          .attr('x1', M.left)
          .attr('x2', W - M.right)
          .attr('y1', (d) => y(d))
          .attr('y2', (d) => y(d)),
      );
      xAxis.call(axisBottom(x).ticks(8).tickFormat((d) => String(d)).tickSizeOuter(0));
      yAxis.call(
        axisLeft(y)
          .ticks(4)
          .tickSize(0)
          .tickPadding(6)
          // One notation for every tick of the axis: compact as soon as the scale reaches 10 000.
          .tickFormat((d) => Number(d).toLocaleString('fr-FR', { maximumFractionDigits: metric.kind === 'mean' ? 1 : 0, notation: (y.domain()[1] ?? 0) >= 10000 ? 'compact' : 'standard' })),
      );
      yAxis.select('.domain').remove();

      const path = line<number>()
        .defined((v) => !Number.isNaN(v))
        .x((_v, i) => x(model.first + i))
        .y((v) => y(v));
      lines
        .selectAll<SVGPathElement, Series>('path')
        .data(series, (s) => s.id)
        .join('path')
        .attr('class', 'cv-line')
        .attr('stroke', (s) => s.color)
        .attr('d', (s) => path(Array.from(s.values)));

      const showAt = (event: PointerEvent) => {
        const [mx] = pointer(event, svg.node());
        const year = Math.round(x.invert(mx));
        if (year < model.first || year > model.last) return;
        const i = year - model.first;
        cross.attr('hidden', null).attr('x1', x(year)).attr('x2', x(year));
        dots
          .selectAll<SVGCircleElement, Series>('circle')
          .data(series.filter((s) => !Number.isNaN(s.values[i] ?? Number.NaN)), (s) => s.id)
          .join('circle')
          .attr('class', 'cv-dot-marker')
          .attr('r', 4)
          .attr('cx', x(year))
          .attr('cy', (s) => y(s.values[i] ?? 0))
          .attr('fill', (s) => s.color);
        const ordered = [...series].sort((a, b) => (b.values[i] ?? -1) - (a.values[i] ?? -1));
        tooltip.show(
          event,
          model.gaps.includes(year) ? `${year} · aucune donnée (perdue par la source)` : String(year),
          ordered.map((s) => ({ text: `${formatWithUnit(s.values[i] ?? Number.NaN, metric)} · ${s.label}`, key: s.color, strong: series.length === 1 })),
        );
      };
      hit
        .on('pointermove', showAt)
        .on('pointerleave', () => {
          cross.attr('hidden', '');
          dots.selectAll('*').remove();
          tooltip.hide();
        });
    },
  };
}

