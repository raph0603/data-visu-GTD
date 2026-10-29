import type { Selection } from 'd3';

export type Sel<E extends Element = HTMLElement> = Selection<E, unknown, null, undefined>;

export interface TooltipLine {
  readonly text: string;
  /** Short line key in a series colour (identity), never coloured text. */
  readonly key?: string | undefined;
  readonly strong?: boolean;
}

/** One floating tooltip for the whole view, positioned in the viewport. */
export class Tooltip {
  private readonly node: Sel<HTMLDivElement>;

  constructor(parent: Sel<HTMLElement>) {
    this.node = parent.append('div').attr('class', 'cv-tooltip').attr('role', 'status').attr('hidden', '');
  }

  show(event: { clientX: number; clientY: number }, title: string, lines: readonly TooltipLine[]): void {
    const node = this.node.attr('hidden', null);
    node.selectAll('*').remove();
    node.append('p').attr('class', 'cv-tooltip-title').text(title);
    for (const line of lines) {
      const p = node.append('p').classed('is-strong', line.strong === true);
      if (line.key !== undefined) p.append('span').attr('class', 'cv-key').style('background', line.key);
      p.append('span').text(line.text);
    }
    const element = node.node();
    if (element === null) return;
    const view = element.ownerDocument.defaultView;
    const width = element.offsetWidth || 240;
    const height = element.offsetHeight || 80;
    const maxX = (view?.innerWidth ?? 1200) - width - 8;
    const maxY = (view?.innerHeight ?? 800) - height - 8;
    const x = event.clientX + 16 > maxX ? event.clientX - width - 16 : event.clientX + 16;
    const y = Math.min(event.clientY + 16, maxY);
    node.style('left', `${Math.max(8, x)}px`).style('top', `${Math.max(8, y)}px`);
  }

  hide(): void {
    this.node.attr('hidden', '');
  }
}
