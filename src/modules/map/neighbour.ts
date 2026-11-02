export type Direction = 'left' | 'right' | 'up' | 'down';

/** An incident on screen, in pixels of the view. */
export interface Spot {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/** Incidents closer than this cannot be told apart with the pointer: they form a pile. */
export const PILE_PX = 2;

/**
 * Event ids start with the date (YYYYMMDD) and end with a serial number, all of one length, so the
 * order of the ids is the order of the incidents in time.
 */
export function compareIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/** The incidents at the same place as `at` (itself included), oldest first. */
export function pileOf(spots: readonly Spot[], at: Spot): Spot[] {
  return spots.filter((s) => Math.hypot(s.x - at.x, s.y - at.y) <= PILE_PX).sort((a, b) => compareIds(a.id, b.id));
}

/**
 * The incident to move to when an arrow key is pressed, or null when nothing lies that way.
 *
 * Spread out incidents: the nearest one in the quarter of the view that the arrow points to (a 90°
 * cone, so a neighbour straight to the right wins over one far above). A pile of incidents at one
 * spot cannot be told apart by direction: its members are walked in time order, right and down
 * going forward, left and up backward, and the arrow leaves the pile once its end is reached. With
 * `leavePile` it leaves at once, whatever the position in the pile. Entering a pile, the arrow
 * lands on the end it comes from: the oldest incident going right or down, the newest going left or up.
 */
export function neighbour(spots: readonly Spot[], from: string, direction: Direction, leavePile = false): Spot | null {
  const current = spots.find((s) => s.id === from);
  if (current === undefined) return null;
  const forward = direction === 'right' || direction === 'down';
  const pile = pileOf(spots, current);
  if (!leavePile && pile.length > 1) {
    const next = pile[pile.findIndex((s) => s.id === from) + (forward ? 1 : -1)];
    if (next !== undefined) return next;
  }
  const inPile = new Set(pile.map((s) => s.id));
  let best: Spot | null = null;
  let bestDistance = Infinity;
  let bestOff = Infinity;
  for (const s of spots) {
    if (inPile.has(s.id)) continue;
    const dx = s.x - current.x;
    const dy = s.y - current.y;
    const ahead = direction === 'right' ? dx : direction === 'left' ? -dx : direction === 'down' ? dy : -dy;
    const off = Math.abs(direction === 'left' || direction === 'right' ? dy : dx);
    if (ahead <= 0 || off > ahead) continue;
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance || (distance === bestDistance && (off < bestOff || (off === bestOff && best !== null && compareIds(s.id, best.id) < 0)))) {
      best = s;
      bestDistance = distance;
      bestOff = off;
    }
  }
  if (best === null) return null;
  const arrival = pileOf(spots, best);
  return (forward ? arrival[0] : arrival[arrival.length - 1]) ?? best;
}

/** The incident nearest to a point of the view, where the keyboard starts when none is open. */
export function nearestTo(spots: readonly Spot[], x: number, y: number): Spot | null {
  let best: Spot | null = null;
  let bestDistance = Infinity;
  for (const s of spots) {
    const distance = Math.hypot(s.x - x, s.y - y);
    if (distance < bestDistance) {
      best = s;
      bestDistance = distance;
    }
  }
  return best;
}
