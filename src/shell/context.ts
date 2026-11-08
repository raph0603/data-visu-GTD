import type { CubeFile } from '../core/contracts';
import { categoryLabel, countryName } from '../core/labels';
import type { ModuleContext } from '../core/module';
import { rangeLength, type AppState } from '../core/state';
import { el } from './dom';
import { pinnedCountries } from './series';
import { formatYears } from './timeline';

/** The most countries explored at once, as in the map's selection. */
const MAX_COUNTRIES = 4;
/** Chips shown in the bar; the others fold into « +N », which opens the filters. */
const VISIBLE_CHIPS = 3;
const CATEGORY_DIMS = [
  { id: 'attackType', label: 'Type d’attaque' },
  { id: 'targetType', label: 'Cible' },
  { id: 'weaponType', label: 'Arme' },
] as const;

export interface ContextBar {
  destroy(): void;
}

export interface ContextActions {
  /** Puts the keyboard on the period of the time zone. */
  readonly onPeriod: () => void;
}

/**
 * The context bar shared by every plate, under the masthead: what the reader is looking at, in one
 * line (the period, the metric, the countries, the filters), with one button to clear it. It reads
 * and writes the shared state only, so the plates answer it without a line of their own.
 */
export function createContextBar(parent: HTMLElement, ctx: ModuleContext, actions: ContextActions): ContextBar {
  const { store, dataset: meta, data } = ctx;
  const { first, last } = meta.years;
  const doc = parent.ownerDocument;
  const win = doc.defaultView;

  const bar = el(doc, 'section', 'context');
  bar.setAttribute('aria-label', 'Contexte de l’exploration');
  parent.append(bar);

  // ------------------------------------------------------------------ period (read-only: the time zone sets it)
  const period = el(doc, 'button', 'ctx-period');
  period.type = 'button';
  period.title = 'Modifier la période : frise en bas de page';
  period.addEventListener('click', actions.onPeriod);

  // ------------------------------------------------------------------ metric
  const metricBox = el(doc, 'div', 'ctx-segmented');
  metricBox.setAttribute('role', 'radiogroup');
  metricBox.setAttribute('aria-label', 'Mesure');
  const metricButtons = meta.metrics.map((metric) => {
    const button = el(doc, 'button', undefined, metric.label);
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.addEventListener('click', () => store.set({ metric: metric.id }));
    metricBox.append(button);
    return { id: metric.id, button };
  });

  // ------------------------------------------------------------------ countries
  const countries = el(doc, 'div', 'ctx-group ctx-countries');
  const countryChips = el(doc, 'span', 'ctx-chips');
  const countryInput = el(doc, 'input', 'ctx-input');
  countryInput.type = 'search';
  countryInput.placeholder = 'Ajouter un pays';
  countryInput.autocomplete = 'off';
  countryInput.setAttribute('aria-label', 'Ajouter un pays à l’exploration');
  const countryList = el(doc, 'datalist');
  countryList.id = 'ctx-country-names';
  countryInput.setAttribute('list', countryList.id);
  countries.append(countryChips, countryInput, countryList);
  const countryByName = new Map<string, string>();

  function setCountries(iso3s: readonly string[]): void {
    const last3 = iso3s[iso3s.length - 1];
    store.set((s) => ({
      pinned: [...s.pinned.filter((r) => r.dim !== 'country'), ...iso3s.map((id) => ({ dim: 'country', id }))],
      focus: last3 === undefined ? (s.focus?.dim === 'country' ? null : s.focus) : { dim: 'country', id: last3 },
      incident: iso3s.length === 0 ? null : s.incident,
    }));
  }
  countryInput.addEventListener('change', () => {
    const iso3 = countryByName.get(countryInput.value.trim().toLocaleLowerCase('fr'));
    if (iso3 === undefined) return;
    countryInput.value = '';
    const now = pinnedCountries(store.get());
    if (!now.includes(iso3) && now.length < MAX_COUNTRIES) setCountries([...now, iso3]);
  });

  // ------------------------------------------------------------------ filters
  const filters = el(doc, 'div', 'ctx-group ctx-filters');
  const filterButton = el(doc, 'button', 'ctx-button');
  filterButton.type = 'button';
  filterButton.setAttribute('aria-haspopup', 'dialog');
  filterButton.setAttribute('aria-expanded', 'false');
  const filterChips = el(doc, 'span', 'ctx-chips');
  const pop = el(doc, 'div', 'ctx-pop');
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Filtres');
  pop.hidden = true;
  filters.append(filterButton, filterChips);

  let popOpen = false;
  function setPop(next: boolean): void {
    popOpen = next;
    pop.hidden = !next;
    filterButton.setAttribute('aria-expanded', String(next));
    filterButton.classList.toggle('is-open', next);
    if (next) pop.querySelector<HTMLElement>('input, button')?.focus();
    else filterButton.focus();
  }
  filterButton.addEventListener('click', () => setPop(!popOpen));
  pop.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation(); // Échap closes the filters, not the selection
    setPop(false);
  });
  const onOutside = (event: PointerEvent) => {
    const target = event.target as Node;
    if (popOpen && !pop.contains(target) && !filterButton.contains(target) && !filterChips.contains(target)) setPop(false);
  };
  doc.addEventListener('pointerdown', onOutside);

  function toggleFilter(dim: string, value: string): void {
    store.set((s) => {
      const current = s.filters[dim] ?? [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { filters: { ...s.filters, [dim]: next } };
    });
  }

  // The lists of the popover come from the cube: loaded once, then the popover is built.
  const checks: { dim: string; value: string; input: HTMLInputElement }[] = [];
  const suicideButtons: { value: string | null; button: HTMLButtonElement }[] = [];
  let built = false;
  function buildPop(cube: CubeFile): void {
    if (built) return;
    built = true;
    const head = el(doc, 'div', 'ctx-pop-head');
    head.append(el(doc, 'strong', undefined, 'Filtres'));
    const close = el(doc, 'button', 'ctx-icon', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer les filtres');
    close.addEventListener('click', () => setPop(false));
    head.append(close);
    pop.append(head);

    // Organization: the most active first.
    const incidentsByGroup = new Map<string, number>();
    cube.columns.group.forEach((g, i) => {
      const name = cube.dictionaries.group[g] ?? '';
      incidentsByGroup.set(name, (incidentsByGroup.get(name) ?? 0) + (cube.columns.incidents[i] ?? 0));
    });
    const groupBox = el(doc, 'div', 'ctx-field');
    const groupLabel = el(doc, 'label', undefined, 'Organisation');
    groupLabel.htmlFor = 'ctx-group-input';
    const groupInput = el(doc, 'input', 'ctx-input');
    groupInput.id = 'ctx-group-input';
    groupInput.type = 'search';
    groupInput.autocomplete = 'off';
    groupInput.placeholder = 'Rechercher une organisation…';
    const groupNames = el(doc, 'datalist');
    groupNames.id = 'ctx-group-names';
    groupInput.setAttribute('list', groupNames.id);
    const known = new Map<string, string>();
    [...incidentsByGroup]
      .filter(([name]) => name !== 'Unknown' && name !== '')
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, n]) => {
        known.set(name.toLocaleLowerCase('fr'), name);
        const option = el(doc, 'option');
        option.value = name;
        option.label = `${n.toLocaleString('fr-FR')} incidents`;
        groupNames.append(option);
      });
    groupInput.addEventListener('change', () => {
      const name = known.get(groupInput.value.trim().toLocaleLowerCase('fr'));
      if (name === undefined) return;
      groupInput.value = '';
      if (!(store.get().filters.group ?? []).includes(name)) toggleFilter('group', name);
    });
    groupBox.append(groupLabel, groupInput, groupNames);
    pop.append(groupBox);

    for (const dim of CATEGORY_DIMS) {
      const details = el(doc, 'details', 'ctx-details');
      details.append(el(doc, 'summary', undefined, dim.label));
      const list = el(doc, 'div', 'ctx-checks');
      for (const value of cube.dictionaries[dim.id]) {
        const row = el(doc, 'label', 'ctx-check');
        const input = el(doc, 'input');
        input.type = 'checkbox';
        input.addEventListener('change', () => toggleFilter(dim.id, value));
        row.append(input, el(doc, 'span', undefined, categoryLabel(dim.id, value)));
        list.append(row);
        checks.push({ dim: dim.id, value, input });
      }
      details.append(list);
      pop.append(details);
    }

    // Suicide attacks are deadlier on average (Pape 2005, Mroszczyk 2019): a filter to test it (T8).
    const suicideBox = el(doc, 'div', 'ctx-field');
    suicideBox.append(el(doc, 'span', 'ctx-field-label', 'Attentats-suicides'));
    const group = el(doc, 'div', 'ctx-segmented ctx-segmented-small');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'Attentats-suicides');
    for (const option of [
      { value: null, label: 'Tous' },
      { value: '1', label: 'Suicide' },
      { value: '0', label: 'Hors suicide' },
    ]) {
      const button = el(doc, 'button', undefined, option.label);
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.addEventListener('click', () => store.set((s) => ({ filters: { ...s.filters, suicide: option.value === null ? [] : [option.value] } })));
      group.append(button);
      suicideButtons.push({ value: option.value, button });
    }
    suicideBox.append(group);
    pop.append(suicideBox);

    // The countries come from the same file.
    for (const iso3 of cube.dictionaries.country) {
      if (iso3 === '') continue;
      const name = countryName(iso3);
      countryByName.set(name.toLocaleLowerCase('fr'), iso3);
      const option = el(doc, 'option');
      option.value = name;
      countryList.append(option);
    }
    draw();
  }

  // ------------------------------------------------------------------ end: clear, share
  const end = el(doc, 'div', 'ctx-end');
  const clear = el(doc, 'button', 'ctx-button', 'Tout effacer');
  clear.type = 'button';
  clear.title = 'Retirer les pays, les filtres et la comparaison, et revenir à toute la période';
  clear.addEventListener('click', () => {
    stopPopFocus();
    store.set((s) => ({
      range: { from: first, to: last },
      compare: null,
      pinned: s.pinned.filter((r) => r.dim !== 'country'),
      focus: s.focus?.dim === 'country' ? null : s.focus,
      incident: null,
      filters: {},
    }));
  });
  function stopPopFocus(): void {
    if (popOpen) setPop(false);
  }
  const share = el(doc, 'button', 'ctx-button', 'Partager');
  share.type = 'button';
  share.title = 'Copier le lien de cette vue (période, pays, filtres)';
  const announce = el(doc, 'span', 'visually-hidden');
  announce.setAttribute('role', 'status');
  let shareTimer: number | null = null;
  share.addEventListener('click', () => {
    void (async () => {
      let copied = false;
      try {
        await win?.navigator.clipboard.writeText(win.location.href);
        copied = true;
      } catch {
        copied = false;
      }
      share.textContent = copied ? 'Lien copié' : 'Copiez l’adresse de la page';
      announce.textContent = copied ? 'Lien de la vue copié dans le presse-papiers' : 'Copie impossible : copiez l’adresse de la page';
      if (shareTimer !== null) win?.clearTimeout(shareTimer);
      shareTimer = win?.setTimeout(() => {
        shareTimer = null;
        share.textContent = 'Partager';
      }, 2200) ?? null;
    })();
  });
  end.append(clear, share, announce);

  bar.append(period, metricBox, countries, filters, end, pop);

  // ------------------------------------------------------------------ drawing
  function chipsOf(state: AppState): { text: string; label: string; remove: () => void }[] {
    const out: { text: string; label: string; remove: () => void }[] = [];
    for (const [dim, values] of Object.entries(state.filters)) {
      for (const value of values) {
        const text = dim === 'suicide' ? (value === '1' ? 'Attentats-suicides' : 'Hors suicide') : dim === 'country' ? countryName(value) : categoryLabel(dim, value);
        out.push({
          text,
          label: `Retirer le filtre ${text}`,
          remove: () => store.set((s) => ({ filters: { ...s.filters, [dim]: (s.filters[dim] ?? []).filter((v) => v !== value) } })),
        });
      }
    }
    return out;
  }

  function chip(text: string, label: string, remove: () => void): HTMLButtonElement {
    const node = el(doc, 'button', 'ctx-chip', text);
    node.type = 'button';
    node.setAttribute('aria-label', label);
    node.title = 'Retirer';
    node.append(el(doc, 'span', 'ctx-x', '×'));
    node.addEventListener('click', remove);
    return node;
  }

  function draw(): void {
    const state = store.get();
    period.textContent = `Période · ${formatYears(state.range)}`;
    for (const { id, button } of metricButtons) {
      button.setAttribute('aria-checked', String(id === state.metric));
      button.classList.toggle('is-active', id === state.metric);
    }

    const explored = pinnedCountries(state);
    countryChips.replaceChildren(
      ...explored.map((iso3) =>
        chip(countryName(iso3), `Retirer le pays ${countryName(iso3)}`, () => setCountries(pinnedCountries(store.get()).filter((id) => id !== iso3))),
      ),
    );
    const full = explored.length >= MAX_COUNTRIES;
    countryInput.disabled = full;
    countryInput.placeholder = explored.length === 0 ? 'Ajouter un pays' : full ? `${MAX_COUNTRIES} pays au plus` : 'Ajouter';

    const chips = chipsOf(state);
    filterButton.textContent = chips.length > 0 ? `Filtres · ${chips.length}` : 'Filtres';
    filterButton.classList.toggle('is-active', chips.length > 0);
    filterChips.replaceChildren(...chips.slice(0, VISIBLE_CHIPS).map((c) => chip(c.text, c.label, c.remove)));
    if (chips.length > VISIBLE_CHIPS) {
      const more = el(doc, 'button', 'ctx-chip ctx-more', `+${chips.length - VISIBLE_CHIPS}`);
      more.type = 'button';
      more.title = 'Voir tous les filtres';
      more.addEventListener('click', () => setPop(true));
      filterChips.append(more);
    }

    for (const { dim, value, input } of checks) input.checked = (state.filters[dim] ?? []).includes(value);
    const suicide = state.filters.suicide?.[0] ?? null;
    for (const { value, button } of suicideButtons) {
      button.setAttribute('aria-checked', String(value === suicide));
      button.classList.toggle('is-active', value === suicide);
    }

    const dirty =
      chips.length > 0 || explored.length > 0 || state.incident !== null || state.compare !== null || state.range.from !== first || state.range.to !== last || rangeLength(state.range) !== last - first + 1;
    clear.hidden = !dirty;
  }

  draw();
  void data.cube().then(buildPop);
  const offs = [
    store.subscribe((s) => s.range, draw),
    store.subscribe((s) => s.metric, draw),
    store.subscribe((s) => s.pinned, draw),
    store.subscribe((s) => s.filters, draw),
    store.subscribe((s) => s.compare, draw),
    store.subscribe((s) => s.incident, draw),
  ];

  return {
    destroy() {
      offs.forEach((off) => off());
      doc.removeEventListener('pointerdown', onOutside);
      if (shareTimer !== null) win?.clearTimeout(shareTimer);
      bar.remove();
    },
  };
}
