import type { Selection } from 'd3';
import type { Meta } from '../../core/contracts';
import { metricValue, type MetricDef } from '../../core/meta';
import type { PaletteApi } from '../../core/palette';
import type { YearlyIndex } from '../../core/series';
import type { YearRange } from '../../core/state';

const WIDTH = 260;
const HEIGHT = 56;

interface SparklineOptions {
  readonly years: Meta['years'];
  readonly range: YearRange;
  readonly compare: YearRange | null;
  readonly palette: PaletteApi;
}

/**
 * Yearly values of one country, main period dark, comparison period light (T9). Years without data
 * (1993) get a dashed outline instead of a bar, so that they never read as a zero; other years
 * without a value (a mean over no incident, unknown casualties) are left empty, with a tooltip.
 */
export function drawSparkline(
  parent: Selection<HTMLElement, unknown, null, undefined>,
  index: YearlyIndex,
  metric: MetricDef,
  iso3: string,
  { years, range, compare, palette }: SparklineOptions,
): void {
  const count = years.last - years.first + 1;
  // Each bar carries its year: indexes shift once the years without data are filtered out.
  const points = Array.from({ length: count }, (_, i) => {
    const year = years.first + i;
    return { year, value: metricValue(index, metric, iso3, year, year) };
  });
  const max = Math.max(0, ...points.map((p) => p.value).filter((v) => !Number.isNaN(v)));
  const step = WIDTH / count;
  const height = (v: number) => (max > 0 ? (v / max) * HEIGHT : 0);
  const inside = (year: number, r: YearRange | null) => r !== null && year >= r.from && year <= r.to;

  parent.append('p').attr('class', 'map-caption').text(`${metric.label} par année`);
  const svg = parent
    .append('svg')
    .attr('class', 'map-sparkline')
    .attr('viewBox', `0 0 ${WIDTH} ${HEIGHT + 14}`)
    .attr('role', 'img')
    .attr('aria-label', `${metric.label} par année, ${years.first}–${years.last}`);

  const bars = svg
    .selectAll('g')
    .data(points)
    .join('g')
    .attr('transform', (p) => `translate(${(p.year - years.first) * step}, 0)`);
  bars
    .append('title')
    .text((p) => `${p.year} : ${Number.isNaN(p.value) ? 'pas de donnée' : p.value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}`);
  bars
    .filter((p) => !Number.isNaN(p.value))
    .append('rect')
    .attr('x', 0.5)
    .attr('width', Math.max(1, step - 1))
    .attr('y', (p) => HEIGHT - height(p.value))
    .attr('height', (p) => height(p.value))
    .attr('fill', (p) => {
      if (inside(p.year, range)) return palette.sequential(0.85);
      return inside(p.year, compare) ? palette.sequential(0.35) : '#cfcec8';
    });
  bars
    .filter((p) => years.gaps.includes(p.year))
    .append('rect')
    .attr('class', 'map-sparkline-gap')
    .attr('x', 0.5)
    .attr('width', Math.max(1, step - 1))
    .attr('y', 0)
    .attr('height', HEIGHT)
    .attr('stroke', palette.noDataStroke);
  svg.append('line').attr('x1', 0).attr('x2', WIDTH).attr('y1', HEIGHT).attr('y2', HEIGHT).attr('class', 'map-sparkline-axis');
  svg.append('text').attr('x', 0).attr('y', HEIGHT + 12).text(years.first);
  svg.append('text').attr('x', WIDTH).attr('y', HEIGHT + 12).attr('text-anchor', 'end').text(years.last);
}
