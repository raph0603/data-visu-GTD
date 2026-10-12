import { interpolateBlues } from 'd3';

/**
 * Shared visual vocabulary so that four independently written views read as one application.
 * - Magnitude: one sequential ramp, monotone in lightness (Bertin's "value" variable), starting above 0.25
 *   so the lowest non-zero class stays distinguishable from the "zero" fill.
 * - "Zero incidents" and "no data" are two different things and have two different encodings:
 *   a flat very light neutral vs a hatch pattern (pattern + colour, so it survives colour-vision deficiency).
 * - Categories: Okabe–Ito (designed for colour-vision deficiency), without black and yellow whose
 *   contrast on a white background is poor.
 */

export const ZERO_FILL = '#efeeea';
export const NO_DATA_STROKE = '#8c8c86';
export const NO_DATA_PATTERN_ID = 'nodata-hatch';

export const CATEGORICAL: readonly string[] = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00'];

const RAMP_START = 0.25;

/** t in [0,1] → colour. Values outside the interval are clamped. */
export function sequential(t: number): string {
  const u = Number.isNaN(t) ? 0 : Math.min(1, Math.max(0, t));
  return interpolateBlues(RAMP_START + (1 - RAMP_START) * u);
}

/**
 * Adds the "no data" hatch pattern to an <svg> (idempotent) and returns the `url(#id)` paint value.
 * Pattern geometry is in user space so the hatch does not scale with map zoom transforms.
 */
export function ensureNoDataPattern(svg: SVGSVGElement): string {
  const ns = 'http://www.w3.org/2000/svg';
  if (svg.querySelector(`#${NO_DATA_PATTERN_ID}`) === null) {
    let defs = svg.querySelector('defs');
    if (defs === null) {
      defs = svg.ownerDocument.createElementNS(ns, 'defs');
      svg.prepend(defs);
    }
    const pattern = svg.ownerDocument.createElementNS(ns, 'pattern');
    pattern.setAttribute('id', NO_DATA_PATTERN_ID);
    pattern.setAttribute('width', '6');
    pattern.setAttribute('height', '6');
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    pattern.setAttribute('patternTransform', 'rotate(45)');
    const bg = svg.ownerDocument.createElementNS(ns, 'rect');
    bg.setAttribute('width', '6');
    bg.setAttribute('height', '6');
    bg.setAttribute('fill', '#ffffff');
    const line = svg.ownerDocument.createElementNS(ns, 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('y1', '0');
    line.setAttribute('x2', '0');
    line.setAttribute('y2', '6');
    line.setAttribute('stroke', NO_DATA_STROKE);
    line.setAttribute('stroke-width', '1.5');
    pattern.append(bg, line);
    defs.append(pattern);
  }
  return `url(#${NO_DATA_PATTERN_ID})`;
}

export interface PaletteApi {
  readonly zero: string;
  readonly noDataStroke: string;
  readonly categorical: readonly string[];
  sequential(t: number): string;
  ensureNoDataPattern(svg: SVGSVGElement): string;
}

export const palette: PaletteApi = {
  zero: ZERO_FILL,
  noDataStroke: NO_DATA_STROKE,
  categorical: CATEGORICAL,
  sequential,
  ensureNoDataPattern,
};
