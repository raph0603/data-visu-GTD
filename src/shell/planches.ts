import { VIEW_LABELS, type ViewId } from '../core/tasks';

/**
 * The site reads as a thematic atlas (D23): each view is a numbered plate that asks
 * one question. The order follows the reading of the questions, not VIEW_IDS. The questions of
 * plates 2 to 4 are to be confirmed with the team that builds them.
 */
export interface Planche {
  readonly id: ViewId;
  readonly n: number;
  readonly question: string;
  /** The question as a full sentence, the plate's title. */
  readonly title: string;
  /** The view's own name, as the team wrote it in core. */
  readonly name: string;
  /** What the plate shows, in one line, for the table of plates. */
  readonly summary: string;
}

export const PLANCHES: readonly Planche[] = [
  {
    id: 'map',
    n: 1,
    question: 'Où ?',
    title: 'Où frappe le terrorisme ?',
    name: VIEW_LABELS.map,
    summary: 'Le globe des attentats, du monde au pays et à l’incident.',
  },
  {
    id: 'atlas',
    n: 2,
    question: 'Quoi ?',
    title: 'Que s’est-il passé, incident par incident ?',
    name: VIEW_LABELS.atlas,
    summary: 'L’intérieur d’un pays, un attentat après l’autre, avec sa fiche.',
  },
  {
    id: 'flow',
    n: 3,
    question: 'Comment ?',
    title: 'Comment les attentats sont-ils commis ?',
    name: VIEW_LABELS.flow,
    summary: 'Types d’attaque, cibles et armes, enchaînés.',
  },
  {
    id: 'leaderboard',
    n: 4,
    question: 'Qui ?',
    title: 'Qui est le plus touché, qui frappe le plus ?',
    name: VIEW_LABELS.leaderboard,
    summary: 'Les pays et les organisations en tête, année après année.',
  },
];

export function plancheOf(id: ViewId): Planche {
  return PLANCHES.find((p) => p.id === id) ?? (PLANCHES[0] as Planche);
}

/**
 * French typography for the text the shell sets, its own and core's: curly apostrophes, and a
 * narrow no-break space before ? ! ; and a no-break space before :, so that the sign never starts a line.
 */
export function fr(text: string): string {
  return text
    .replace(/'/g, '\u2019')
    .replace(/[ \u00a0]*([?!;])(?=\s|$|\u00bb)/g, '\u202f$1')
    .replace(/[ \u00a0]*:(?=\s|$)/g, '\u00a0:');
}
