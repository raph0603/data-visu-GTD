import { describeChange, formatValue } from './format';
import { valueOver, type Env, type Frame } from './frame';
import { metricOf } from './model';
import { clearCountries, MAX_SELECTION, toggleCountry } from './selection';
import type { Card } from './ui';

export interface ComparePanel {
  update(frame: Frame): void;
  highlight(hovered: string | null): void;
}

/**
 * The compared countries: legend chips (colour = identity), a search to add one, and the table of
 * their figures, which is also the accessible twin of the map.
 */
export function createComparePanel(env: Env, card: Card): ComparePanel {
  const { store, dataset, model } = env;

  const picker = card.body.append('div').attr('class', 'cv-picker');
  const listId = `cv-countries-${Math.random().toString(36).slice(2, 8)}`;
  const input = picker
    .append('input')
    .attr('type', 'search')
    .attr('list', listId)
    .attr('placeholder', 'Ajouter un pays…')
    .attr('aria-label', 'Ajouter un pays à la comparaison');
  const options = picker.append('datalist').attr('id', listId);
  const byName = new Map(env.drawable.map((iso3) => [env.name(iso3).toLowerCase(), iso3]));
  options
    .selectAll('option')
    .data([...env.drawable].sort((a, b) => env.name(a).localeCompare(env.name(b), 'fr')))
    .join('option')
    .attr('value', (iso3) => env.name(iso3));
  input.on('change', (event: Event) => {
    const field = event.target as HTMLInputElement;
    const iso3 = byName.get(field.value.trim().toLowerCase());
    if (iso3 !== undefined && !store.get().pinned.some((r) => r.dim === 'country' && r.id === iso3)) toggleCountry(store, iso3);
    field.value = '';
  });
  const clearButton = picker
    .append('button')
    .attr('type', 'button')
    .attr('class', 'cv-link-button')
    .text('Tout retirer')
    .on('click', () => clearCountries(store));

  const chips = card.body.append('div').attr('class', 'cv-country-chips');
  const empty = card.body
    .append('p')
    .attr('class', 'cv-empty')
    .text(`Aucun pays sélectionné : les graphiques montrent le monde entier. Cliquez sur la carte ou cherchez un pays (${MAX_SELECTION} au plus).`);
  const table = card.body.append('table').attr('class', 'cv-table');
  const head = table.append('thead').append('tr');
  const body = table.append('tbody');

  return {
    update(frame) {
      const { state } = frame;
      card.caption.text(frame.selected.length === 0 ? '' : `${frame.selected.length} pays sur ${MAX_SELECTION} · cliquez sur un nom pour le retirer`);
      empty.attr('hidden', frame.selected.length === 0 ? null : '');
      table.attr('hidden', frame.selected.length === 0 ? '' : null);
      clearButton.attr('hidden', frame.selected.length === 0 ? '' : null);
      input.attr('disabled', frame.selected.length >= MAX_SELECTION ? '' : null);

      chips
        .selectAll<HTMLButtonElement, string>('button')
        .data(frame.selected, (iso3) => iso3)
        .join((enter) => {
          const b = enter.append('button').attr('type', 'button').attr('class', 'cv-country-chip');
          b.append('span').attr('class', 'cv-swatch');
          b.append('span').attr('class', 'cv-chip-name');
          b.append('span').attr('class', 'cv-chip-x').attr('aria-hidden', 'true').text('×');
          return b;
        })
        .attr('aria-label', (iso3) => `Retirer ${env.name(iso3)} de la comparaison`)
        .on('click', (_event: MouseEvent, iso3) => toggleCountry(store, iso3))
        .on('pointerenter', (_event: PointerEvent, iso3) => store.set({ hover: { dim: 'country', id: iso3 } }))
        .on('pointerleave', () => store.set({ hover: null }))
        .call((b) => b.select('.cv-swatch').style('background', (iso3) => frame.colors.get(iso3) ?? '#555'))
        .call((b) => b.select('.cv-chip-name').text((iso3) => env.name(iso3)));

      const metrics = dataset.metrics;
      const columns = ['Pays', ...metrics.map((m) => m.label), `Rang (${frame.metric.label.toLowerCase()})`, ...(state.compare === null ? [] : ['Évolution'])];
      head
        .selectAll('th')
        .data(columns)
        .join('th')
        .attr('scope', 'col')
        .text((c) => c);

      const rows = body
        .selectAll<HTMLTableRowElement, string>('tr')
        .data(frame.selected, (iso3) => iso3)
        .join('tr')
        .on('pointerenter', (_event: PointerEvent, iso3) => store.set({ hover: { dim: 'country', id: iso3 } }))
        .on('pointerleave', () => store.set({ hover: null }));
      rows.each(function (iso3) {
        const row = this;
        row.replaceChildren();
        const c = model.countryOf(iso3);
        const totals = model.totals(frame.table, c < 0 ? [] : [c], state.range);
        const nameCell = row.ownerDocument.createElement('th');
        nameCell.scope = 'row';
        const swatch = row.ownerDocument.createElement('span');
        swatch.className = 'cv-swatch';
        swatch.style.background = frame.colors.get(iso3) ?? '#555';
        const name = row.ownerDocument.createElement('span');
        name.textContent = env.name(iso3);
        const region = row.ownerDocument.createElement('small');
        region.textContent = env.region(iso3);
        nameCell.append(swatch, name, region);
        row.append(nameCell);
        for (const metric of metrics) {
          const td = row.ownerDocument.createElement('td');
          td.textContent = formatValue(metricOf(totals, metric, frame.covered), metric);
          td.classList.toggle('is-current', metric.id === frame.metric.id);
          row.append(td);
        }
        const rank = row.ownerDocument.createElement('td');
        const r = frame.ranking.rank.get(iso3);
        rank.textContent = r === undefined ? '—' : `${r}e / ${frame.ranking.ordered.length}`;
        row.append(rank);
        if (state.compare !== null && c >= 0) {
          const change = describeChange(frame.values.get(iso3) ?? Number.NaN, valueOver(env, frame, [c], state.compare));
          const td = row.ownerDocument.createElement('td');
          td.textContent = `${change.kind === 'up' ? '↑ ' : change.kind === 'down' ? '↓ ' : ''}${change.text}`;
          td.className = change.kind === 'up' ? 'is-worse' : change.kind === 'down' ? 'is-better' : '';
          row.append(td);
        }
      });
    },
    highlight(hovered) {
      body.selectAll<HTMLTableRowElement, string>('tr').classed('is-hover', (iso3) => iso3 === hovered);
      chips.selectAll<HTMLButtonElement, string>('button').classed('is-hover', (iso3) => iso3 === hovered);
    },
  };
}
