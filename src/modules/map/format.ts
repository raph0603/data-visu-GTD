import type { MetricDef } from '../../core/meta';
import type { YearRange } from '../../core/state';

const whole = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0 });

/** A metric value as displayed; NaN is never written as a number. */
export function formatValue(value: number, metric: MetricDef): string {
  if (Number.isNaN(value)) return 'pas de donnée';
  return metric.kind === 'mean' ? oneDecimal.format(value) : whole.format(value);
}

/** "12 345 morts", "2,4 morts par incident". */
export function formatWithUnit(value: number, metric: MetricDef): string {
  return Number.isNaN(value) ? 'pas de donnée' : `${formatValue(value, metric)} ${metric.unit}`;
}

/** A number of incidents, whatever the selected metric. */
export function formatCount(value: number): string {
  return whole.format(value);
}

/** Legend ticks: powers of ten and the maximum (one decimal below 10, for means). */
export function formatTick(value: number): string {
  return value < 10 && !Number.isInteger(value) ? oneDecimal.format(value) : whole.format(value);
}

export function formatShare(share: number): string {
  return percent.format(share);
}

export function formatRange(range: YearRange): string {
  return range.from === range.to ? String(range.from) : `${range.from}–${range.to}`;
}

/** French ordinal: "1er", "2e", "15e". */
export function ordinal(n: number): string {
  return n === 1 ? '1er' : `${n}e`;
}

/** "3 incidents", "1 mort": a count with its unit, singular for 0 and 1 as in French. */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatCount(n)} ${Math.abs(n) < 2 ? singular : pluralForm}`;
}

export type Change =
  | { readonly kind: 'none'; readonly text: string }
  | { readonly kind: 'up' | 'down' | 'same'; readonly text: string };

/** Change of the main period `now` against the comparison period `before` (T9). */
export function describeChange(now: number, before: number): Change {
  if (Number.isNaN(now) || Number.isNaN(before)) return { kind: 'none', text: 'comparaison impossible : pas de donnée' };
  if (now === before) return { kind: 'same', text: 'stable' };
  if (before === 0) return { kind: 'up', text: 'apparition (0 avant)' };
  const ratio = (now - before) / before;
  const text = `${ratio > 0 ? '+' : '−'}${percent.format(Math.abs(ratio))}`;
  return { kind: ratio > 0 ? 'up' : 'down', text };
}
