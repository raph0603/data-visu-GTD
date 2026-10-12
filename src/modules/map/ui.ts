import { select, type Selection } from 'd3';

export type Sel<E extends Element = HTMLElement> = Selection<E, unknown, null, undefined>;

export interface Card {
  readonly root: Sel;
  readonly header: Sel;
  readonly caption: Sel<HTMLParagraphElement>;
  readonly body: Sel<HTMLDivElement>;
}

/** A titled panel: header (title, caption, optional tools) and a body. */
export function card<E extends Element>(parent: Sel<E>, className: string, title: string): Card {
  const root = parent.append('section').attr('class', `cv-card ${className}`);
  const header = root.append('header').attr('class', 'cv-card-header');
  const titles = header.append('div');
  titles.append('h3').text(title);
  const caption = titles.append('p').attr('class', 'cv-caption');
  const body = root.append('div').attr('class', 'cv-card-body');
  return { root, header, caption, body };
}

export interface TooltipLine {
  readonly text: string;
  /** Short line key in a series colour (identity), never coloured text. */
  readonly key?: string;
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

export interface MultiSelectOption {
  readonly value: string;
  readonly label: string;
  /** Incidents in the current window, shown beside the label and used for the order. */
  readonly count: number;
}

export interface MultiSelect {
  update(options: readonly MultiSelectOption[], selected: ReadonlySet<string> | null): void;
  close(): void;
  readonly root: Sel<HTMLDivElement>;
}

const MAX_OPTIONS = 150;

/**
 * A filter combobox: a button that opens a searchable list of checkboxes. `onChange` receives the
 * new set of selected values (empty = no filter).
 */
export function multiSelect<E extends Element>(parent: Sel<E>, label: string, onChange: (values: string[]) => void): MultiSelect {
  const root = parent.append('div').attr('class', 'cv-multi');
  const button = root.append('button').attr('type', 'button').attr('class', 'cv-multi-button').attr('aria-expanded', 'false');
  const buttonLabel = button.append('span').text(label);
  const badge = button.append('span').attr('class', 'cv-badge');
  const panel = root.append('div').attr('class', 'cv-multi-panel').attr('hidden', '');
  const search = panel.append('input').attr('type', 'search').attr('placeholder', 'Rechercher…').attr('aria-label', `Rechercher : ${label}`);
  const list = panel.append('div').attr('class', 'cv-multi-list').attr('role', 'group').attr('aria-label', label);
  const footer = panel.append('div').attr('class', 'cv-multi-footer');
  const clear = footer.append('button').attr('type', 'button').text('Tout effacer');
  const more = footer.append('span').attr('class', 'cv-caption');

  let options: readonly MultiSelectOption[] = [];
  let selected = new Set<string>();

  const setOpen = (open: boolean) => {
    panel.attr('hidden', open ? null : '');
    button.attr('aria-expanded', String(open));
    if (open) {
      renderList();
      (search.node() as HTMLInputElement | null)?.focus();
    }
  };

  function renderList(): void {
    const query = String(search.property('value') ?? '').trim().toLowerCase();
    const matching = options.filter((o) => query === '' || o.label.toLowerCase().includes(query) || o.value.toLowerCase().includes(query));
    // Selected values stay on top so they can be unticked even when far down the list.
    const ordered = [...matching.filter((o) => selected.has(o.value)), ...matching.filter((o) => !selected.has(o.value))];
    const shown = ordered.slice(0, MAX_OPTIONS);
    more.text(ordered.length > shown.length ? `${shown.length} sur ${ordered.length} : affinez la recherche` : '');
    const rows = list
      .selectAll<HTMLLabelElement, MultiSelectOption>('label')
      .data(shown, (o) => o.value)
      .join((enter) => {
        const row = enter.append('label').attr('class', 'cv-multi-option');
        row.append('input').attr('type', 'checkbox');
        row.append('span').attr('class', 'cv-multi-label');
        row.append('span').attr('class', 'cv-multi-count');
        return row;
      });
    rows
      .select('input')
      .property('checked', (o) => selected.has(o.value))
      .on('change', (event: Event, o) => {
        const next = new Set(selected);
        if ((event.target as HTMLInputElement).checked) next.add(o.value);
        else next.delete(o.value);
        onChange([...next]);
      });
    rows.select('.cv-multi-label').text((o) => o.label);
    rows.select('.cv-multi-count').text((o) => (o.count > 0 ? o.count.toLocaleString('fr-FR') : '0'));
  }

  button.on('click', () => setOpen(panel.attr('hidden') !== null));
  search.on('input', renderList);
  clear.on('click', () => onChange([]));
  root.on('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      setOpen(false);
      (button.node() as HTMLButtonElement | null)?.focus();
    }
  });

  return {
    root,
    update(next, current) {
      options = next;
      selected = new Set(current ?? []);
      badge.text(selected.size > 0 ? String(selected.size) : '');
      button.classed('is-active', selected.size > 0);
      buttonLabel.text(label);
      if (panel.attr('hidden') === null) renderList();
    },
    close() {
      setOpen(false);
    },
  };
}

/** Removes every child, keeping the element (panels re-render into the same body). */
export function clear(node: Sel<Element>): void {
  node.selectAll('*').remove();
}

export function selectNode<E extends Element>(element: E): Sel<E> {
  return select(element) as unknown as Sel<E>;
}
