import type { YearRange } from '../../core/state';
import type { IncidentFiles, IncidentSet } from './incidents';
import { filtersKey, UNKNOWN_GROUP, type Filters } from './model';

/**
 * What the globe says about who strikes and how, once zoomed past the world (D25). The organizations
 * of the countries in focus keep one colour from the territories to the single incidents; the
 * weapon gives the shape of an incident.
 */

/** Okabe–Ito for the six leading organizations, a grey for the others, a light grey for unknown authors. */
export const GROUP_COLORS: readonly string[] = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00'];
export const OTHER_GROUPS = '#8a8983';
export const UNKNOWN_AUTHOR = '#c9c8c1';

export class GroupColors {
  /** The leading organizations, in the order of their colours. */
  names: readonly string[] = [];
  private key = '';
  private version = 0;
  private readonly bySet = new WeakMap<IncidentSet, { version: number; slots: Uint8Array }>();

  /** One colour per slot: the leading organizations, then the others, then unknown authors. */
  get colors(): string[] {
    return [...GROUP_COLORS.slice(0, this.names.length), OTHER_GROUPS, UNKNOWN_AUTHOR];
  }

  get other(): number {
    return this.names.length;
  }

  get unknown(): number {
    return this.names.length + 1;
  }

  colorOf(slot: number): string {
    return this.colors[slot] ?? OTHER_GROUPS;
  }

  /** Ranks the organizations of these countries over the window; the first six get a colour. */
  update(files: IncidentFiles, iso3s: readonly string[], filters: Filters, range: YearRange): void {
    const loaded = iso3s.filter((iso3) => files.get(iso3) !== undefined);
    const key = `${loaded.join(',')}|${range.from}-${range.to}|${filtersKey(filters)}`;
    if (key === this.key) return;
    const counts = new Map<string, number>();
    for (const iso3 of loaded) {
      const set = files.get(iso3);
      if (set === undefined) continue;
      const { group } = set.file.columns;
      const names = set.file.dictionaries.group;
      for (const i of files.visible(iso3, filters, range)) {
        const name = names[group[i] ?? 0] ?? UNKNOWN_GROUP;
        if (name !== UNKNOWN_GROUP) counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    this.names = [...counts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, GROUP_COLORS.length)
      .map(([name]) => name);
    this.key = key;
    this.version++;
  }

  /** Colour slot of one incident. */
  slotOf(set: IncidentSet, i: number): number {
    let entry = this.bySet.get(set);
    if (entry === undefined || entry.version !== this.version) {
      const slots = Uint8Array.from(set.file.dictionaries.group, (name) => {
        if (name === UNKNOWN_GROUP) return this.unknown;
        const at = this.names.indexOf(name);
        return at >= 0 ? at : this.other;
      });
      entry = { version: this.version, slots };
      this.bySet.set(set, entry);
    }
    return entry.slots[set.file.columns.group[i] ?? 0] ?? this.other;
  }
}

// ------------------------------------------------------------------ weapons as shapes
export type Glyph = 'circle' | 'triangle' | 'diamond' | 'square' | 'cross';

/** The four main weapons (95 % of the known ones) each get a shape; the rest share a cross. */
export const WEAPON_GLYPHS: readonly (readonly [string, Glyph])[] = [
  ['Firearms', 'circle'],
  ['Explosives', 'triangle'],
  ['Incendiary', 'diamond'],
  ['Melee', 'square'],
];

const glyphByWeapon = new Map<string, Glyph>(WEAPON_GLYPHS);

export function glyphOf(weapon: string): Glyph {
  return glyphByWeapon.get(weapon) ?? 'cross';
}

/** Traces a glyph of about the area of a circle of radius r (fill or stroke it after). */
export function traceGlyph(context: CanvasRenderingContext2D, glyph: Glyph, x: number, y: number, r: number): void {
  context.beginPath();
  switch (glyph) {
    case 'circle':
      context.arc(x, y, r, 0, Math.PI * 2);
      break;
    case 'triangle': {
      const s = r * 1.35;
      context.moveTo(x, y - s);
      context.lineTo(x + s * 0.87, y + s * 0.5);
      context.lineTo(x - s * 0.87, y + s * 0.5);
      context.closePath();
      break;
    }
    case 'diamond': {
      const s = r * 1.25;
      context.moveTo(x, y - s);
      context.lineTo(x + s, y);
      context.lineTo(x, y + s);
      context.lineTo(x - s, y);
      context.closePath();
      break;
    }
    case 'square': {
      const s = r * 0.89;
      context.rect(x - s, y - s, 2 * s, 2 * s);
      break;
    }
    case 'cross': {
      const s = r * 1.1;
      const t = Math.max(1, s * 0.38);
      context.moveTo(x - t, y - s);
      context.lineTo(x + t, y - s);
      context.lineTo(x + t, y - t);
      context.lineTo(x + s, y - t);
      context.lineTo(x + s, y + t);
      context.lineTo(x + t, y + t);
      context.lineTo(x + t, y + s);
      context.lineTo(x - t, y + s);
      context.lineTo(x - t, y + t);
      context.lineTo(x - s, y + t);
      context.lineTo(x - s, y - t);
      context.lineTo(x - t, y - t);
      context.closePath();
      break;
    }
  }
}

/** A glyph as inline SVG, for the legend. */
export function glyphSvg(glyph: Glyph, color: string): string {
  const shapes: Record<Glyph, string> = {
    circle: '<circle cx="8" cy="8" r="5.5"/>',
    triangle: '<path d="M8 1.5 15 13.5H1z"/>',
    diamond: '<path d="M8 1 15 8 8 15 1 8z"/>',
    square: '<rect x="3" y="3" width="10" height="10"/>',
    cross: '<path d="M6 1.5h4v4.5h4.5v4H10v4.5H6V10H1.5V6H6z"/>',
  };
  return `<svg class="cv-glyph" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="${color}">${shapes[glyph]}</svg>`;
}

// ------------------------------------------------------------------ bubbles: who, in each country
export interface Bubble {
  readonly iso3: string;
  readonly name: string;
  readonly slot: number;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly incidents: number;
  readonly killed: number;
  readonly killedKnown: number;
  readonly suicide: number;
  /** Incidents per weapon label. */
  readonly weapons: ReadonlyMap<string, number>;
}

interface Tally {
  iso3: string;
  name: string;
  slot: number;
  sx: number;
  sy: number;
  incidents: number;
  killed: number;
  killedKnown: number;
  suicide: number;
  weapons: Map<string, number>;
}

const BUBBLE_MIN = 5;
const BUBBLE_MAX = 36;

/**
 * The leading organizations of each country in focus, as bubbles at the centre of their incidents
 * on screen: area for the number of incidents in view, colour for the organization.
 */
export function bubblesOf(
  n: number,
  xs: Float64Array,
  ys: Float64Array,
  sets: readonly (IncidentSet | undefined)[],
  index: Uint32Array,
  colors: GroupColors,
  keep: (iso3: string) => boolean,
  perCountry: number,
): Bubble[] {
  const tallies = new Map<string, Tally>();
  for (let m = 0; m < n; m++) {
    const set = sets[m];
    if (set === undefined || !keep(set.iso3)) continue;
    const i = index[m] ?? 0;
    const c = set.file.columns;
    const name = set.file.dictionaries.group[c.group[i] ?? 0] ?? UNKNOWN_GROUP;
    if (name === UNKNOWN_GROUP) continue;
    const key = `${set.iso3}\u0001${name}`;
    let tally = tallies.get(key);
    if (tally === undefined) {
      tally = { iso3: set.iso3, name, slot: colors.slotOf(set, i), sx: 0, sy: 0, incidents: 0, killed: 0, killedKnown: 0, suicide: 0, weapons: new Map() };
      tallies.set(key, tally);
    }
    tally.sx += xs[m] ?? 0;
    tally.sy += ys[m] ?? 0;
    tally.incidents++;
    const killed = c.killed[i];
    if (killed != null) {
      tally.killed += killed;
      tally.killedKnown++;
    }
    if (c.suicide[i] === 1) tally.suicide++;
    const weapon = set.file.dictionaries.weaponType[c.weaponType[i] ?? 0] ?? 'Unknown';
    tally.weapons.set(weapon, (tally.weapons.get(weapon) ?? 0) + 1);
  }
  const byCountry = new Map<string, Tally[]>();
  for (const tally of tallies.values()) {
    if (tally.incidents < 3) continue;
    const list = byCountry.get(tally.iso3) ?? [];
    list.push(tally);
    byCountry.set(tally.iso3, list);
  }
  const kept = [...byCountry.values()].flatMap((list) => list.sort((a, b) => b.incidents - a.incidents).slice(0, perCountry));
  const max = Math.max(1, ...kept.map((t) => t.incidents));
  return kept
    .map((t) => ({
      iso3: t.iso3,
      name: t.name,
      slot: t.slot,
      x: t.sx / t.incidents,
      y: t.sy / t.incidents,
      r: BUBBLE_MIN + (BUBBLE_MAX - BUBBLE_MIN) * Math.sqrt(t.incidents / max),
      incidents: t.incidents,
      killed: t.killed,
      killedKnown: t.killedKnown,
      suicide: t.suicide,
      weapons: t.weapons,
    }))
    .sort((a, b) => b.r - a.r);
}
