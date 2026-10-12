import type { Selection } from 'd3';
import type { YearRange } from '../../core/state';
import { formatRange } from './format';

export interface PeriodControl {
  /** Shows the range on the sliders; hides the control while `range` is null. */
  update(range: YearRange | null): void;
}

/** Two linked sliders (first year, last year) over the covered years (T3). */
export function periodControl(
  parent: Selection<HTMLDivElement, unknown, null, undefined>,
  title: string,
  years: { readonly first: number; readonly last: number },
  onChange: (range: YearRange) => void,
): PeriodControl {
  const box = parent.append('fieldset').attr('class', 'map-period');
  box.append('legend').text(title);
  const output = box.append('output');
  let current: YearRange = { from: years.first, to: years.last };

  const slider = (end: 'from' | 'to', label: string) => {
    const field = box.append('label').attr('class', 'map-slider');
    field.append('span').text(label);
    return field
      .append('input')
      .attr('type', 'range')
      .attr('min', years.first)
      .attr('max', years.last)
      .attr('step', 1)
      .attr('aria-label', `${title} : ${label === 'début' ? 'première' : 'dernière'} année`)
      .on('input', (event: Event) => {
        const year = Number((event.target as HTMLInputElement).value);
        // Moving one end past the other drags it along, so the window never inverts.
        onChange(end === 'from' ? { from: year, to: Math.max(year, current.to) } : { from: Math.min(year, current.from), to: year });
      });
  };
  const from = slider('from', 'début');
  const to = slider('to', 'fin');

  return {
    update(range) {
      box.attr('hidden', range === null ? '' : null);
      if (range === null) return;
      current = range;
      from.property('value', range.from);
      to.property('value', range.to);
      output.text(formatRange(range));
    },
  };
}
