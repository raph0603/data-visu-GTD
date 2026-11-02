import { describe, expect, it } from 'vitest';
import { compareIds, nearestTo, neighbour, pileOf, type Spot } from './neighbour';

const spot = (id: string, x: number, y: number): Spot => ({ id, x, y });

describe('compareIds', () => {
  it('orders event ids in time, whatever their length', () => {
    expect(compareIds('197001010001', '197001010002')).toBeLessThan(0);
    expect(compareIds('201701010001', '197001010009')).toBeGreaterThan(0);
    expect(compareIds('9', '10')).toBeLessThan(0);
    expect(compareIds('5', '5')).toBe(0);
  });
});

describe('neighbour, spread out incidents', () => {
  const spots = [spot('a', 100, 100), spot('b', 140, 105), spot('c', 300, 100), spot('d', 105, 40), spot('e', 60, 100), spot('f', 100, 160)];

  it('goes to the nearest incident in the direction of the arrow', () => {
    expect(neighbour(spots, 'a', 'right')?.id).toBe('b');
    expect(neighbour(spots, 'a', 'left')?.id).toBe('e');
    expect(neighbour(spots, 'a', 'up')?.id).toBe('d');
    expect(neighbour(spots, 'a', 'down')?.id).toBe('f');
  });

  it('ignores an incident outside the 90° cone, even a near one', () => {
    // b is 40 px right and 5 px down: inside the right cone, outside the up and down cones.
    expect(neighbour([spot('a', 0, 0), spot('b', 40, 5)], 'a', 'up')).toBeNull();
    expect(neighbour([spot('a', 0, 0), spot('b', 40, 5)], 'a', 'down')).toBeNull();
    // 30 px right and 40 px down: not to the right (off axis > ahead), but below.
    expect(neighbour([spot('a', 0, 0), spot('b', 30, 40)], 'a', 'right')).toBeNull();
    expect(neighbour([spot('a', 0, 0), spot('b', 30, 40)], 'a', 'down')?.id).toBe('b');
  });

  it('keeps the selection when nothing lies that way', () => {
    expect(neighbour(spots, 'c', 'right')).toBeNull();
    expect(neighbour(spots, 'zzz', 'right')).toBeNull();
  });

  it('prefers the nearer of two incidents in the cone, then the straighter one', () => {
    const two = [spot('a', 0, 0), spot('far', 80, 0), spot('near', 30, 25)];
    expect(neighbour(two, 'a', 'right')?.id).toBe('near');
    const tie = [spot('a', 0, 0), spot('x', 30, 0), spot('y', 0, 30), spot('z', -30, 0)];
    expect(neighbour(tie, 'a', 'right')?.id).toBe('x');
  });
});

describe('neighbour, a pile of incidents at one spot', () => {
  const pile = [spot('3', 100.4, 100), spot('1', 100, 100), spot('2', 100, 100.5)];
  const others = [spot('l', 20, 100), spot('r', 200, 100), spot('u', 100, 20), spot('d', 100, 180)];
  const spots = [...pile, ...others];

  it('lists the pile oldest first', () => {
    expect(pileOf(spots, spot('1', 100, 100)).map((s) => s.id)).toEqual(['1', '2', '3']);
  });

  it('walks it forward with right and down, backward with left and up', () => {
    expect(neighbour(spots, '1', 'right')?.id).toBe('2');
    expect(neighbour(spots, '2', 'right')?.id).toBe('3');
    expect(neighbour(spots, '3', 'left')?.id).toBe('2');
    expect(neighbour(spots, '2', 'up')?.id).toBe('1');
    expect(neighbour(spots, '1', 'down')?.id).toBe('2');
  });

  it('reaches every incident of the pile and leaves it past its ends', () => {
    const seen = ['1'];
    for (let step = 0; step < 2; step++) seen.push(neighbour(spots, seen[seen.length - 1] ?? '', 'right')?.id ?? '');
    expect(seen).toEqual(['1', '2', '3']);
    expect(neighbour(spots, '3', 'right')?.id).toBe('r');
    expect(neighbour(spots, '1', 'left')?.id).toBe('l');
    expect(neighbour(spots, '1', 'up')?.id).toBe('u');
    expect(neighbour(spots, '3', 'down')?.id).toBe('d');
  });

  it('leaves at once with leavePile, whatever the position in the pile', () => {
    expect(neighbour(spots, '1', 'right', true)?.id).toBe('r');
    expect(neighbour(spots, '2', 'left', true)?.id).toBe('l');
  });

  it('enters a pile by the end it comes from', () => {
    expect(neighbour(spots, 'l', 'right')?.id).toBe('1');
    expect(neighbour(spots, 'r', 'left')?.id).toBe('3');
    expect(neighbour(spots, 'u', 'down')?.id).toBe('1');
    expect(neighbour(spots, 'd', 'up')?.id).toBe('3');
  });
});

describe('nearestTo', () => {
  it('finds the incident nearest to a point', () => {
    expect(nearestTo([spot('a', 0, 0), spot('b', 50, 50), spot('c', 90, 10)], 80, 20)?.id).toBe('c');
    expect(nearestTo([], 0, 0)).toBeNull();
  });
});
