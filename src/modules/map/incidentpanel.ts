import type { IncidentSummary, TopEventsFile } from '../../core/contracts';
import { categoryLabel } from '../../core/labels';
import { formatCount, formatRange } from './format';
import type { Env, Frame } from './frame';
import { incidentCategory, type IncidentFiles, type IncidentSet } from './incidents';
import { MAX_SELECTION, toggleCountry } from './selection';
import type { Card } from './ui';

const TOP = 10;

interface Entry {
  readonly eventId: string;
  readonly iso3: string;
  readonly year: number;
  readonly month: number | null;
  readonly day: number | null;
  readonly city: string | null;
  readonly killed: number | null;
  readonly wounded: number | null;
  readonly attackType: string;
  readonly group: string;
}

export interface IncidentPanel {
  update(frame: Frame): void;
}

/**
 * The deadliest incidents of the selection under the filters (T10), and the sheet of one incident
 * with its GTD summary, loaded only when opened. Without a selection, the world's deadliest
 * incidents of the period come from top_events.json.
 */
export function createIncidentPanel(env: Env, card: Card, files: IncidentFiles, locate: (set: IncidentSet, index: number) => void): IncidentPanel {
  const { store, data } = env;
  const sheet = card.body.append('article').attr('class', 'cv-sheet').attr('hidden', '');
  const note = card.body.append('p').attr('class', 'cv-caption');
  const list = card.body.append('ol').attr('class', 'cv-incidents');
  const empty = card.body.append('p').attr('class', 'cv-empty').attr('hidden', '');
  let topEvents: TopEventsFile | null = null;
  let topEventsError = false;
  let frame: Frame | null = null;
  let summaryToken = 0;

  function entriesOfSelection(f: Frame): Entry[] {
    const entries: Entry[] = [];
    for (const iso3 of f.selected) {
      const set = files.get(iso3);
      if (set === undefined) continue;
      const c = set.file.columns;
      for (const i of files.visible(iso3, f.filters, f.state.range)) {
        entries.push({
          eventId: c.eventId[i] ?? '',
          iso3,
          year: c.year[i] ?? 0,
          month: c.month[i] ?? null,
          day: c.day[i] ?? null,
          city: c.city[i] ?? null,
          killed: c.killed[i] ?? null,
          wounded: c.wounded[i] ?? null,
          attackType: incidentCategory(set, 'attackType', i),
          group: incidentCategory(set, 'group', i),
        });
      }
    }
    return entries;
  }

  function entriesOfWorld(f: Frame, events: TopEventsFile): Entry[] {
    const attack = f.filters.attackType;
    const group = f.filters.group;
    const entries: Entry[] = [];
    for (const [iso3, list] of Object.entries(events.countries)) {
      for (const e of list as IncidentSummary[]) {
        if (e.year < f.state.range.from || e.year > f.state.range.to) continue;
        if (attack !== null && !attack.has(e.attackType)) continue;
        if (group !== null && !group.has(e.group)) continue;
        entries.push({ ...e, iso3 });
      }
    }
    return entries;
  }

  function render(): void {
    if (frame === null) return;
    const f = frame;
    const world = f.selected.length === 0;
    let entries: Entry[] = [];
    if (world) {
      if (topEvents === null && !topEventsError) {
        void data
          .topEvents()
          .then((file) => {
            topEvents = file;
            render();
          })
          .catch(() => {
            topEventsError = true;
            render();
          });
      }
      entries = topEvents === null ? [] : entriesOfWorld(f, topEvents);
      const partial = f.filters.targetType !== null || f.filters.weaponType !== null || f.filters.suicide !== null;
      note.text(
        topEventsError
          ? 'Liste indisponible.'
          : partial
            ? 'Sans pays sélectionné, seuls la période, le type d’attaque et l’organisation filtrent cette liste.'
            : 'Monde entier ; sélectionnez des pays pour voir tous leurs incidents filtrés.',
      );
    } else {
      const missing = f.selected.filter((iso3) => files.get(iso3) === undefined && files.error(iso3) === undefined);
      if (missing.length > 0) {
        note.text('Chargement des incidents…');
        void files.ensure(missing).then(render);
      } else {
        note.text('Incidents géolocalisés des pays sélectionnés, avec les filtres.');
      }
      entries = entriesOfSelection(f);
    }
    entries.sort((a, b) => (b.killed ?? -1) - (a.killed ?? -1) || (b.wounded ?? -1) - (a.wounded ?? -1) || (a.eventId < b.eventId ? -1 : 1));
    const top = entries.slice(0, TOP);
    card.caption.text(`Les plus meurtriers, ${formatRange(f.state.range)} · cliquez pour la fiche`);

    const items = list
      .selectAll<HTMLLIElement, Entry>('li.cv-item')
      .data(top, (e) => e.eventId)
      .join((enter) => {
        const li = enter.append('li').attr('class', 'cv-item');
        const b = li.append('button').attr('type', 'button');
        b.append('span').attr('class', 'cv-incident-killed');
        b.append('span').attr('class', 'cv-incident-title');
        b.append('span').attr('class', 'cv-incident-meta');
        return li;
      });
    items
      .select('button')
      .classed('is-active', (e) => e.eventId === f.state.incident)
      .on('click', (_event: MouseEvent, e) => open(e));
    items.select('.cv-incident-killed').text((e) => (e.killed === null ? '?' : formatCount(e.killed)));
    items.select('.cv-incident-title').text((e) => `${dateOf(e)} · ${[e.city, env.name(e.iso3)].filter((v) => v != null && v !== '').join(', ')}`);
    items.select('.cv-incident-meta').text((e) => `${categoryLabel('attackType', e.attackType)} · ${categoryLabel('group', e.group)}`);
    // The order of the list follows the ranking, not the order of arrival of the entries.
    items.order();
    empty.attr('hidden', top.length === 0 && !(world && topEvents === null) ? null : '').text('Aucun incident avec ces filtres sur cette période.');
    renderSheet(f);
  }

  function open(e: Entry): void {
    const selected = frame?.selected ?? [];
    if (!selected.includes(e.iso3)) {
      if (selected.length >= MAX_SELECTION) {
        note.text(`Pour ouvrir cette fiche, retirez un pays (${MAX_SELECTION} au plus).`);
        return;
      }
      toggleCountry(store, e.iso3);
    }
    store.set({ incident: e.eventId });
  }

  function renderSheet(f: Frame): void {
    const id = f.state.incident;
    const found = id === null ? undefined : files.find(id);
    sheet.attr('hidden', found === undefined ? '' : null);
    sheet.selectAll('*').remove();
    if (id === null || found === undefined) return;
    const { set, index: i } = found;
    const c = set.file.columns;
    const header = sheet.append('header');
    header.append('h4').text(`${dateOf({ year: c.year[i] ?? 0, month: c.month[i] ?? null, day: c.day[i] ?? null })} · ${[c.city[i], env.name(set.iso3)].filter((v) => v != null && v !== '').join(', ')}`);
    const close = header.append('button').attr('type', 'button').attr('class', 'cv-link-button').text('Fermer');
    close.on('click', () => store.set({ incident: null }));
    const facts = sheet.append('dl');
    const fact = (label: string, value: string) => {
      facts.append('dt').text(label);
      facts.append('dd').text(value);
    };
    fact('Morts', c.killed[i] == null ? 'inconnu' : formatCount(c.killed[i] ?? 0));
    fact('Blessés', c.wounded[i] == null ? 'inconnu' : formatCount(c.wounded[i] ?? 0));
    fact('Attaque', categoryLabel('attackType', incidentCategory(set, 'attackType', i)));
    fact('Cible', categoryLabel('targetType', incidentCategory(set, 'targetType', i)));
    fact('Arme', categoryLabel('weaponType', incidentCategory(set, 'weaponType', i)));
    fact('Organisation', categoryLabel('group', incidentCategory(set, 'group', i)));
    fact('Attentat-suicide', c.suicide[i] === 1 ? 'oui' : 'non');
    const summary = sheet.append('p').attr('class', 'cv-summary').text('Chargement du résumé…');
    sheet.append('p').attr('class', 'cv-caption').text(`Résumé de la GTD (en anglais) · identifiant ${id}`);
    sheet
      .append('button')
      .attr('type', 'button')
      .attr('class', 'cv-tool')
      .text('Localiser sur la carte')
      .on('click', () => locate(set, i));
    const token = ++summaryToken;
    data
      .summaries(set.iso3)
      .then((file) => {
        if (token === summaryToken) summary.text(file.summaries[id] ?? 'Pas de résumé pour cet incident.');
      })
      .catch(() => {
        if (token === summaryToken) summary.text('Résumé indisponible.');
      });
  }

  return {
    update(next) {
      frame = next;
      render();
    },
  };
}

function dateOf(e: { year: number; month: number | null; day: number | null }): string {
  if (e.month === null) return String(e.year);
  const month = new Date(Date.UTC(2000, e.month - 1, 1)).toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' });
  return e.day === null ? `${month} ${e.year}` : `${e.day} ${month} ${e.year}`;
}
