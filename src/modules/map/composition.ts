import { scaleBand, scaleLinear } from 'd3';
import { categoryLabel } from '../../core/labels';
import { formatCount, formatShare } from './format';
import { weightOf, weightUnit, type Env, type Frame } from './frame';
import { CATEGORY_DIMS, type Breakdown, type CategoryDim } from './model';
import type { Card } from './ui';

const TOP_CATEGORIES = 7;
const W = 560;
const LABEL_WIDTH = 190;
const TABS: Readonly<Record<CategoryDim, string>> = { attackType: 'Attaque', targetType: 'Cible', weaponType: 'Arme' };

interface Bar {
  readonly row: string;
  readonly series: string;
  readonly label: string;
  readonly color: string;
  readonly weight: number;
  readonly share: number;
}

export interface Composition {
  update(frame: Frame): void;
}

/**
 * Operating profile (T6): share of each attack, target or weapon type in each selected country, so
 * that countries of very different sizes compare. Clicking a category adds it to the filters.
 */
export function createComposition(env: Env, card: Card): Composition {
  const { store, model, palette, tooltip } = env;
  const tabs = card.header.append('div').attr('class', 'cv-tabs').attr('role', 'tablist');
  const tabButtons = tabs
    .selectAll('button')
    .data(CATEGORY_DIMS)
    .join('button')
    .attr('type', 'button')
    .attr('role', 'tab')
    .text((dim) => TABS[dim])
    .on('click', (_event: MouseEvent, dim) => store.set((s) => ({ ext: { ...s.ext, 'map.compo': dim } })));
  const svg = card.body.append('svg').attr('class', 'cv-chart').attr('role', 'img');

  return {
    update(frame) {
      const raw = frame.state.ext['map.compo'];
      const dim: CategoryDim = raw === 'targetType' || raw === 'weaponType' ? raw : 'attackType';
      tabButtons.attr('aria-selected', (d) => String(d === dim));
      const unit = weightUnit(frame.metric);
      card.caption.text(`Part de chaque ${TABS[dim].toLowerCase()} dans le total de chaque pays (${unit}) · cliquez sur une catégorie pour filtrer`);

      const series: { id: string; label: string; color: string; breakdown: Breakdown }[] =
        frame.selected.length === 0
          ? [{ id: 'world', label: 'Monde', color: palette.sequential(0.85), breakdown: frame.scan.combined }]
          : frame.selected.flatMap((iso3) => {
              const breakdown = frame.scan.perCountry.get(model.countryOf(iso3));
              return breakdown === undefined ? [] : [{ id: iso3, label: env.name(iso3), color: frame.colors.get(iso3) ?? '#555', breakdown }];
            });

      // Rows: the categories that weigh most in the selection together; the rest folds into "Autres".
      const totalsByCategory = frame.scan.combined[dim].map((t, i) => ({ i, weight: weightOf(t, frame.metric) }));
      const top = totalsByCategory.filter((c) => c.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, TOP_CATEGORIES).map((c) => c.i);
      const rows = [...top.map((i) => model.dict[dim][i] ?? ''), ...(totalsByCategory.some((c) => c.weight > 0 && !top.includes(c.i)) ? ['__other'] : [])];

      const bars: Bar[] = [];
      for (const s of series) {
        const all = weightOf(s.breakdown.total, frame.metric);
        for (const row of rows) {
          const weight =
            row === '__other'
              ? s.breakdown[dim].reduce((sum, t, i) => sum + (top.includes(i) ? 0 : weightOf(t, frame.metric)), 0)
              : weightOf(s.breakdown[dim][model.indexOf(dim, row)] ?? s.breakdown.total, frame.metric);
          bars.push({ row, series: s.id, label: s.label, color: s.color, weight, share: all > 0 ? weight / all : 0 });
        }
      }

      const thickness = series.length === 1 ? 12 : Math.max(4, Math.min(8, 24 / series.length));
      const rowHeight = series.length * (thickness + 2) + 8;
      const height = Math.max(60, rows.length * rowHeight + 24);
      svg.attr('viewBox', `0 0 ${W} ${height}`).attr('aria-label', `Répartition par ${TABS[dim].toLowerCase()}`);
      const y = scaleBand<string>().domain(rows).range([4, height - 20]);
      const maxShare = Math.max(0.05, ...bars.map((b) => b.share));
      const x = scaleLinear().domain([0, maxShare]).nice().range([LABEL_WIDTH, W - 48]);

      svg.selectAll('*').remove();
      svg
        .append('g')
        .attr('class', 'cv-grid')
        .selectAll('line')
        .data(x.ticks(4))
        .join('line')
        .attr('x1', (d) => x(d))
        .attr('x2', (d) => x(d))
        .attr('y1', 0)
        .attr('y2', height - 20);
      svg
        .append('g')
        .attr('class', 'cv-axis-labels')
        .selectAll('text')
        .data(x.ticks(4))
        .join('text')
        .attr('x', (d) => x(d))
        .attr('y', height - 6)
        .attr('text-anchor', 'middle')
        .text((d) => formatShare(d));

      const label = (row: string) => (row === '__other' ? 'Autres' : categoryLabel(dim, row));
      svg
        .append('g')
        .selectAll('text')
        .data(rows)
        .join('text')
        .attr('class', (row) => `cv-row-label${row === '__other' ? '' : ' is-clickable'}`)
        .attr('x', LABEL_WIDTH - 8)
        .attr('y', (row) => (y(row) ?? 0) + rowHeight / 2 - 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .text(label)
        .on('click', (_event: MouseEvent, row) => {
          if (row === '__other') return;
          store.set((s) => {
            const current = s.filters[dim] ?? [];
            return { filters: { ...s.filters, [dim]: current.includes(row) ? current.filter((v) => v !== row) : [...current, row] } };
          });
        });

      const seriesIndex = new Map(series.map((s, i) => [s.id, i]));
      const marks = svg
        .append('g')
        .selectAll('g')
        .data(bars)
        .join('g')
        .attr('transform', (b) => `translate(0, ${(y(b.row) ?? 0) + 4 + (seriesIndex.get(b.series) ?? 0) * (thickness + 2)})`);
      marks
        .append('rect')
        .attr('class', 'cv-bar')
        .attr('x', LABEL_WIDTH)
        .attr('width', (b) => Math.max(b.weight > 0 ? 1.5 : 0, x(b.share) - LABEL_WIDTH))
        .attr('height', thickness)
        .attr('rx', Math.min(4, thickness / 2))
        .attr('fill', (b) => b.color);
      // Value at the bar end for a single series; with several, the tooltip carries it.
      if (series.length === 1) {
        marks
          .append('text')
          .attr('class', 'cv-bar-value')
          .attr('x', (b) => x(b.share) + 4)
          .attr('y', thickness / 2)
          .attr('dominant-baseline', 'middle')
          .text((b) => formatShare(b.share));
      }
      marks
        .append('rect')
        .attr('class', 'cv-hit')
        .attr('x', LABEL_WIDTH)
        .attr('width', W - LABEL_WIDTH)
        .attr('y', -1)
        .attr('height', thickness + 2)
        .on('pointermove', (event: PointerEvent, b) =>
          tooltip.show(event, `${label(b.row)} · ${b.label}`, [
            { text: `${formatShare(b.share)} du total du pays`, strong: true, key: b.color },
            { text: `${formatCount(b.weight)} ${unit}` },
          ]),
        )
        .on('pointerleave', () => tooltip.hide());
    },
  };
}
