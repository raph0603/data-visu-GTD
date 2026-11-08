/**
 * Sets the leaderboard out in its plate's box (D31): a toolbar, a one-line summary, the ranking
 * filling the rest, and the playback under it. The page was a filter column, a heading, three
 * figures, a settings card, a toolbar and the chart far below.
 *
 * The view builds its DOM as it always did and every control keeps its node, its id and its
 * listeners; this only moves the nodes into their new places. What the shell now holds (the period,
 * the countries and the organization, attack, target and weapon filters, the suicide flag) stays in
 * place, folded away, so that the view reads and writes it as before.
 */
export function arrangeLayout(app: HTMLElement, signal: AbortSignal): void {
  const doc = app.ownerDocument;
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    if (cls !== undefined) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const one = <T extends HTMLElement>(selector: string): T | null => app.querySelector<T>(selector);
  const wrapperOf = (id: string): HTMLElement | null => one(`#${id}`)?.closest<HTMLElement>('.control-field, .checkbox-field') ?? null;
  const take = (nodes: readonly (HTMLElement | null)[], into: HTMLElement): void => {
    for (const node of nodes) if (node !== null) into.append(node);
  };

  const legacy = make('div', 'lb-legacy');
  legacy.hidden = true;
  for (const child of [...app.children]) legacy.append(child);
  // Still in the view while the controls are taken out of it, so that they can be found.
  app.append(legacy);

  // ------------------------------------------------------------------ toolbar
  const bar = make('header', 'lb-bar');
  bar.setAttribute('aria-label', 'Réglages du classement');
  const fields = make('div', 'lb-group');
  take([wrapperOf('dimension'), wrapperOf('metric'), wrapperOf('limit'), wrapperOf('calculation')], fields);
  const panels = make('div', 'lb-group lb-end');

  const popovers: HTMLElement[] = [];
  const panel = (label: string, body: readonly (HTMLElement | null)[], wide = false, note?: string): void => {
    const wrap = make('div', 'lb-popwrap');
    const button = make('button', 'lb-btn', label);
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    const pop = make('div', wide ? 'lb-pop lb-pop-wide' : 'lb-pop');
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', label);
    pop.hidden = true;
    if (note !== undefined) pop.append(make('p', 'lb-pop-note', note));
    take(body, pop);
    wrap.append(button, pop);
    panels.append(wrap);
    popovers.push(wrap);
  };
  const details = (selector: string): HTMLElement | null => {
    const node = one<HTMLDetailsElement>(selector);
    if (node !== null) node.open = true;
    return node;
  };
  panel(
    'Filtres',
    [
      wrapperOf('filter-region'),
      wrapperOf('filter-province'),
      wrapperOf('filter-weaponSubtype'),
      wrapperOf('filter-targetSubtype'),
      wrapperOf('filter-success'),
      wrapperOf('filter-doubt'),
      wrapperOf('known-deaths'),
      wrapperOf('known-injuries'),
      one('.filter-footer button'),
    ],
    false,
    'La période, les pays, les organisations, les types d’attaque, de cible et d’arme se règlent dans la barre du haut et la frise.',
  );
  panel('Options', [wrapperOf('minimum-attacks'), wrapperOf('aggregation'), wrapperOf('exclude-unknown')]);
  panel('Regrouper', [details('.category-groups-panel')], true);
  panel('Repères', [one('.source-notes')], true);
  panel('Données', [details('.preview-section')], true);
  bar.append(fields, panels);

  // ------------------------------------------------------------------ summary, ranking, playback
  const summary = make('section', 'lb-summary');
  summary.setAttribute('aria-label', 'Période et sélection');
  take([one('.kpis'), one('.selection-summary')], summary);

  const stage = make('section', 'lb-stage');
  stage.setAttribute('aria-label', 'Classement');
  const container = one('.leaderboard-container');
  container?.classList.add('is-fit');
  take([one('.leaderboard-visualization')], stage);

  const transport = make('section', 'lb-transport');
  transport.setAttribute('aria-label', 'Lecture');
  take([one('.animation-toolbar')], transport);

  legacy.before(bar, summary, stage, transport);
  app.classList.add('is-arranged');

  // ------------------------------------------------------------------ panels: one at a time, Échap or a click elsewhere closes
  const set = (wrap: HTMLElement, open: boolean) => {
    const button = wrap.querySelector<HTMLButtonElement>('.lb-btn');
    const pop = wrap.querySelector<HTMLElement>('.lb-pop');
    if (!button || !pop) return;
    pop.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.classList.toggle('is-open', open);
  };
  const closeAll = (except?: HTMLElement) => {
    for (const wrap of popovers) if (wrap !== except) set(wrap, false);
  };
  for (const wrap of popovers) {
    wrap.querySelector('.lb-btn')?.addEventListener(
      'click',
      () => {
        const wasClosed = wrap.querySelector<HTMLElement>('.lb-pop')?.hasAttribute('hidden') ?? true;
        closeAll(wrap);
        set(wrap, wasClosed);
      },
      { signal },
    );
  }
  doc.addEventListener('pointerdown', (event) => {
    if (!popovers.some((wrap) => wrap.contains(event.target as Node))) closeAll();
  }, { signal });
  app.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAll();
  }, { signal });
}
