import { describeChange, formatCount, formatRange, formatShare, formatValue } from './format';
import type { Env, Frame } from './frame';
import { isNamedGroup, knownShareOf, metricOf } from './model';
import type { Sel } from './ui';

export interface Kpis {
  update(frame: Frame): void;
}

/**
 * The headline figures of the current scope (selected countries, or the world), with the change
 * against the comparison period. A tile is also a button: it switches the metric of every panel.
 */
export function createKpis(parent: Sel, env: Env): Kpis {
  const { store, dataset, model } = env;
  const root = parent.append('section').attr('class', 'cv-kpis').attr('aria-label', 'Chiffres clés');
  const scope = root.append('p').attr('class', 'cv-scope');
  const tiles = root.append('div').attr('class', 'cv-kpi-row');

  return {
    update(frame) {
      const { state, totals, compareTotals } = frame;
      const names = frame.selected.map((iso3) => env.name(iso3));
      scope.selectAll('*').remove();
      scope.append('strong').text(names.length === 0 ? 'Monde entier' : names.join(', '));
      scope.append('span').text(` · ${formatRange(state.range)}${frame.filtered ? ' · filtres actifs' : ''}`);

      const groups = [...frame.scan.combined.group].filter(([g, t]) => t.incidents > 0 && isNamedGroup(model.dict.group[g] ?? '')).length;
      const items = [
        ...dataset.metrics.map((metric) => {
          const now = metricOf(totals, metric, frame.covered);
          const before = compareTotals === null || state.compare === null ? null : metricOf(compareTotals, metric, model.coveredYears(state.compare) > 0);
          const share = knownShareOf(totals, metric);
          return {
            id: metric.id,
            label: metric.label,
            value: formatValue(now, metric),
            change: before === null ? null : describeChange(now, before),
            note: metric.kind === 'count' || Number.isNaN(share) || share >= 0.995 ? '' : `connu pour ${formatShare(share)} des incidents`,
            selectable: true,
          };
        }),
        { id: 'groups', label: 'Organisations nommées', value: formatCount(groups), change: null, note: 'actives sur la période', selectable: false },
      ];

      const tile = tiles
        .selectAll<HTMLButtonElement, (typeof items)[number]>('.cv-kpi')
        .data(items, (d) => d.id)
        .join((enter) => {
          const t = enter.append('button').attr('type', 'button').attr('class', 'cv-kpi');
          t.append('span').attr('class', 'cv-kpi-label');
          t.append('span').attr('class', 'cv-kpi-value');
          t.append('span').attr('class', 'cv-kpi-delta');
          t.append('span').attr('class', 'cv-kpi-note');
          return t;
        });
      tile
        .classed('is-active', (d) => d.id === state.metric)
        .attr('disabled', (d) => (d.selectable ? null : ''))
        .attr('aria-pressed', (d) => (d.selectable ? String(d.id === state.metric) : null))
        .on('click', (_event: MouseEvent, d) => {
          if (d.selectable) store.set({ metric: d.id });
        });
      tile.select('.cv-kpi-label').text((d) => d.label);
      tile.select('.cv-kpi-value').text((d) => d.value);
      // More terrorism is worse: a rise reads as a deterioration (arrow + word, never colour alone).
      tile
        .select('.cv-kpi-delta')
        .attr('class', (d) => `cv-kpi-delta ${d.change === null ? '' : d.change.kind === 'up' ? 'is-worse' : d.change.kind === 'down' ? 'is-better' : ''}`)
        .text((d) => {
          if (d.change === null || state.compare === null) return '';
          const arrow = d.change.kind === 'up' ? '↑ ' : d.change.kind === 'down' ? '↓ ' : '';
          return `${arrow}${d.change.text} vs ${formatRange(state.compare)}`;
        });
      tile.select('.cv-kpi-note').text((d) => d.note);
    },
  };
}
