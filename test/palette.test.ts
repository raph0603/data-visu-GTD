// @vitest-environment jsdom
import { hcl, lab } from 'd3';
import { describe, expect, it } from 'vitest';
import { ATTACK_TYPE_COLORS, CATEGORICAL, IDENTITY, NO_DATA_PATTERN_ID, ZERO_FILL, ensureNoDataPattern, sequential } from '../src/core/palette';

const lightness = (css: string): number => lab(css).l;

describe('palette', () => {
  it('is monotone in lightness from low to high magnitude (Bertin "value")', () => {
    let previous = Infinity;
    for (let i = 0; i <= 100; i++) {
      const l = lightness(sequential(i / 100));
      expect(l).toBeLessThanOrEqual(previous + 1e-9);
      previous = l;
    }
  });

  it('keeps the lowest non-zero class visibly darker than the zero fill', () => {
    expect(lightness(ZERO_FILL) - lightness(sequential(0))).toBeGreaterThanOrEqual(8);
  });

  it('clamps out-of-range and NaN inputs', () => {
    expect(sequential(-3)).toBe(sequential(0));
    expect(sequential(7)).toBe(sequential(1));
    expect(sequential(Number.NaN)).toBe(sequential(0));
  });

  it('offers distinct categorical colours', () => {
    expect(new Set(CATEGORICAL).size).toBe(CATEGORICAL.length);
  });

  it('keeps blue out of the identity colours, which share the screen with the blue magnitude ramp', () => {
    for (const color of IDENTITY) {
      const { h } = hcl(color);
      expect(h < 200 || h > 280).toBe(true);
    }
    expect(IDENTITY.every((c) => CATEGORICAL.includes(c))).toBe(true);
    expect(Object.values(ATTACK_TYPE_COLORS).every((c) => CATEGORICAL.includes(c))).toBe(true);
  });

  it('adds the no-data hatch pattern once', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const paint = ensureNoDataPattern(svg);
    ensureNoDataPattern(svg);
    expect(paint).toBe(`url(#${NO_DATA_PATTERN_ID})`);
    expect(svg.querySelectorAll(`#${NO_DATA_PATTERN_ID}`)).toHaveLength(1);
  });
});
