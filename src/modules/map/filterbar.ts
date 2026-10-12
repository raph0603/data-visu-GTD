import { interval, type Timer } from 'd3';
import { categoryLabel } from '../../core/labels';
import type { YearRange } from '../../core/state';
import { formatRange } from './format';
import type { Env, Frame } from './frame';
import { FILTER_DIMS, readFilters, type FilterDim } from './model';
import { multiSelect, type MultiSelect, type Sel } from './ui';

const DIM_LABELS: Readonly<Record<FilterDim, string>> = {
  attackType: "Type d'attaque",
  targetType: 'Cible',
  weaponType: 'Arme',
  group: 'Organisation',
};

const PLAY_STEP_MS = 700;

export interface FilterBar {
  update(frame: Frame, counts: Readonly<Record<FilterDim, ReadonlyMap<string, number>>>): void;
  destroy(): void;
}

/** One row of controls above everything they scope (period, metric, comparison, filters). */
export function createFilterBar(parent: Sel<HTMLElement>, env: Env): FilterBar {
  const { store, dataset } = env;
  const years = dataset.years;
  const bar = parent.append('div').attr('class', 'cv-filters');

  // ------------------------------------------------------------------ period
  const timeRow = bar.append('div').attr('class', 'cv-filter-row');
  const period = periodControl(timeRow, 'Période', years, (range) => store.set({ range }));
  const play = period.box
    .insert('button', ':first-child')
    .attr('type', 'button')
    .attr('class', 'cv-play')
    .attr('aria-label', 'Faire défiler la période année par année')
    .on('click', () => (timer === null ? startPlay() : stopPlay()));

  const metricField = timeRow.append('label').attr('class', 'cv-field');
  metricField.append('span').text('Métrique');
  const metricSelect = metricField.append('select').on('change', (event: Event) => store.set({ metric: (event.target as HTMLSelectElement).value }));
  metricSelect
    .selectAll('option')
    .data(dataset.metrics)
    .join('option')
    .attr('value', (m) => m.id)
    .text((m) => m.label);

  const compareField = timeRow.append('label').attr('class', 'cv-field cv-check');
  const compareBox = compareField
    .append('input')
    .attr('type', 'checkbox')
    .on('change', (event: Event) => {
      const on = (event.target as HTMLInputElement).checked;
      store.set((s) => ({ compare: on ? previousWindow(s.range, years.first) : null }));
    });
  compareField.append('span').text('Comparer à une autre période');
  const compare = periodControl(timeRow, 'Comparaison', years, (range) => store.set({ compare: range }));

  // ------------------------------------------------------------------ categorical filters
  const filterRow = bar.append('div').attr('class', 'cv-filter-row');
  const selects = new Map<FilterDim, MultiSelect>();
  for (const dim of FILTER_DIMS) {
    selects.set(
      dim,
      multiSelect(filterRow, DIM_LABELS[dim], (values) => store.set((s) => ({ filters: { ...s.filters, [dim]: values } }))),
    );
  }
  const suicide = filterRow.append('div').attr('class', 'cv-segmented').attr('role', 'radiogroup').attr('aria-label', 'Attentats-suicides');
  const suicideOptions: { value: string | null; label: string }[] = [
    { value: null, label: 'Tous' },
    { value: '1', label: 'Suicide' },
    { value: '0', label: 'Hors suicide' },
  ];
  const suicideButtons = suicide
    .selectAll('button')
    .data(suicideOptions)
    .join('button')
    .attr('type', 'button')
    .attr('role', 'radio')
    .text((o) => o.label)
    .on('click', (_event: MouseEvent, o) => store.set((s) => ({ filters: { ...s.filters, suicide: o.value === null ? [] : [o.value] } })));
  const reset = filterRow
    .append('button')
    .attr('type', 'button')
    .attr('class', 'cv-reset')
    .text('Réinitialiser les filtres')
    .on('click', () => store.set({ filters: {} }));
  const chips = bar.append('div').attr('class', 'cv-chips').attr('aria-label', 'Filtres actifs');

  // Close the open filter lists on a click outside them.
  const doc = parent.node()?.ownerDocument;
  const onOutside = (event: PointerEvent) => {
    for (const select of selects.values()) {
      if (!select.root.node()?.contains(event.target as Node)) select.close();
    }
  };
  doc?.addEventListener('pointerdown', onOutside);

  // ------------------------------------------------------------------ play
  let timer: Timer | null = null;

  function startPlay(): void {
    const { range } = store.get();
    const length = range.to - range.from;
    // Restart from the beginning when the window already touches the last year.
    if (range.to >= years.last) store.set({ range: { from: years.first, to: years.first + length } });
    timer = interval(() => {
      const current = store.get().range;
      if (current.to >= years.last) {
        stopPlay();
        return;
      }
      store.set({ range: { from: current.from + 1, to: current.to + 1 } });
    }, PLAY_STEP_MS);
    play.classed('is-playing', true).attr('aria-label', 'Arrêter le défilement');
  }

  function stopPlay(): void {
    timer?.stop();
    timer = null;
    play.classed('is-playing', false).attr('aria-label', 'Faire défiler la période année par année');
  }

  return {
    update(frame, counts) {
      const { state } = frame;
      metricSelect.property('value', state.metric);
      period.update(state.range);
      compareBox.property('checked', state.compare !== null);
      compare.update(state.compare);
      const filters = readFilters(state.filters);
      for (const dim of FILTER_DIMS) {
        const options = [...(counts[dim] ?? new Map<string, number>())]
          .map(([value, count]) => ({ value, label: categoryLabel(dim, value), count }))
          .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'));
        selects.get(dim)?.update(options, filters[dim]);
      }
      const current = filters.suicide === null ? null : String(filters.suicide);
      suicideButtons.attr('aria-checked', (o) => String(o.value === current)).classed('is-active', (o) => o.value === current);
      reset.attr('disabled', frame.filtered ? null : '');

      const active: { dim: FilterDim | 'suicide'; value: string }[] = [];
      for (const dim of FILTER_DIMS) for (const value of filters[dim] ?? []) active.push({ dim, value });
      if (current !== null) active.push({ dim: 'suicide', value: current });
      chips
        .selectAll<HTMLButtonElement, { dim: string; value: string }>('button')
        .data(active, (d) => `${d.dim}:${d.value}`)
        .join('button')
        .attr('type', 'button')
        .attr('class', 'cv-chip')
        .attr('aria-label', (d) => `Retirer le filtre ${categoryLabel(d.dim, d.value)}`)
        .text((d) => `${categoryLabel(d.dim, d.value)} ×`)
        .on('click', (_event: MouseEvent, d) =>
          store.set((s) => ({ filters: { ...s.filters, [d.dim]: (s.filters[d.dim] ?? []).filter((v) => v !== d.value) } })),
        );
    },
    destroy() {
      stopPlay();
      doc?.removeEventListener('pointerdown', onOutside);
    },
  };
}

interface PeriodControl {
  readonly box: Sel<HTMLFieldSetElement>;
  update(range: YearRange | null): void;
}

function periodControl<E extends Element>(parent: Sel<E>, title: string, years: { readonly first: number; readonly last: number }, onChange: (range: YearRange) => void): PeriodControl {
  const box = parent.append('fieldset').attr('class', 'cv-period');
  box.append('legend').text(title);
  const output = box.append('output');
  let current: YearRange = { from: 0, to: 0 };
  const sliders = [
    { end: 'from' as const, label: 'première année' },
    { end: 'to' as const, label: 'dernière année' },
  ].map(({ end, label }) =>
    box
      .append('input')
      .attr('type', 'range')
      .attr('min', years.first)
      .attr('max', years.last)
      .attr('step', 1)
      .attr('aria-label', `${title} : ${label}`)
      .on('input', (event: Event) => {
        const year = Number((event.target as HTMLInputElement).value);
        // Moving one end past the other drags it along, so the window never inverts.
        onChange(end === 'from' ? { from: year, to: Math.max(year, current.to) } : { from: Math.min(year, current.from), to: year });
      }),
  );
  return {
    box,
    update(range) {
      box.attr('hidden', range === null ? '' : null);
      if (range === null) return;
      current = range;
      const [from, to] = sliders;
      from?.property('value', range.from);
      to?.property('value', range.to);
      output.text(formatRange(range));
    },
  };
}

/** The window of the same length just before `range` (clipped to the first year). */
function previousWindow(range: YearRange, first: number): YearRange {
  const length = range.to - range.from + 1;
  if (range.from === first) return { from: first, to: first };
  return { from: Math.max(first, range.from - length), to: range.from - 1 };
}
