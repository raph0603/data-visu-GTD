import { formatCount, formatShare } from './format';
import { weightOf, weightUnit, type Env, type Frame } from './frame';
import { isNamedGroup, UNKNOWN_GROUP, type Totals } from './model';
import { toggleCountry } from './selection';
import type { Card } from './ui';

const TOP = 12;
const COUNTRIES_SHOWN = 4;

interface GroupRow {
  readonly g: number;
  readonly name: string;
  readonly totals: Totals;
  readonly weight: number;
  readonly years: readonly [number, number] | undefined;
  /** Countries where the group is active in the window (all countries, not only the selection). */
  readonly countries: readonly { iso3: string; incidents: number }[];
  readonly named: boolean;
}

export interface Groups {
  update(frame: Frame): void;
}

/**
 * Who acts (T7): the organizations of the selection (or the world) over the period, with their
 * activity years and the countries where they also act — the links of the map, as a list.
 * Clicking a group filters every panel on it; clicking a country adds it to the comparison.
 */
export function createGroups(env: Env, card: Card): Groups {
  const { store, model } = env;
  const note = card.body.append('p').attr('class', 'cv-caption');
  const list = card.body.append('ol').attr('class', 'cv-groups');
  const empty = card.body.append('p').attr('class', 'cv-empty').attr('hidden', '').text('Aucune organisation identifiée sur cette période.');

  return {
    update(frame) {
      const unit = weightUnit(frame.metric);
      const countryCount = model.countryCodes.length;
      const activeIn = new Map<number, { iso3: string; incidents: number }[]>();
      for (const [key, totals] of frame.scan.groupCountry) {
        const iso3 = model.countryCodes[key % countryCount] ?? '';
        if (iso3 === '' || totals.incidents === 0) continue;
        const g = Math.floor(key / countryCount);
        const entry = activeIn.get(g) ?? [];
        entry.push({ iso3, incidents: totals.incidents });
        activeIn.set(g, entry);
      }

      const all = [...frame.scan.combined.group].filter(([, t]) => t.incidents > 0);
      const total = frame.scan.combined.total.incidents;
      const unknown = all.find(([g]) => model.dict.group[g] === UNKNOWN_GROUP)?.[1].incidents ?? 0;
      const rows: GroupRow[] = all
        .filter(([g]) => model.dict.group[g] !== UNKNOWN_GROUP)
        .map(([g, totals]) => ({
          g,
          name: model.dict.group[g] ?? '',
          totals,
          weight: weightOf(totals, frame.metric),
          years: frame.scan.groupYears.get(g),
          countries: (activeIn.get(g) ?? []).sort((a, b) => b.incidents - a.incidents),
          named: isNamedGroup(model.dict.group[g] ?? ''),
        }))
        .sort((a, b) => b.weight - a.weight || b.totals.incidents - a.totals.incidents)
        .slice(0, TOP);

      card.caption.text(`Classées par ${unit} sur la période · cliquez sur une organisation pour filtrer`);
      note.text(total > 0 ? `Auteur inconnu pour ${formatShare(unknown / total)} des incidents (${formatCount(unknown)}).` : '');
      const best = rows[0]?.weight ?? 1;
      const groupFilter = new Set(frame.state.filters.group ?? []);

      const items = list
        .selectAll<HTMLLIElement, GroupRow>('li.cv-item')
        .data(rows, (r) => r.name)
        .join((enter) => {
          const li = enter.append('li').attr('class', 'cv-item');
          const head = li.append('button').attr('type', 'button').attr('class', 'cv-group-head');
          head.append('span').attr('class', 'cv-group-name');
          head.append('span').attr('class', 'cv-group-value');
          li.append('span').attr('class', 'cv-meter').append('span');
          li.append('div').attr('class', 'cv-group-meta');
          return li;
        });
      items
        .select('.cv-group-head')
        .classed('is-active', (r) => groupFilter.has(r.name))
        .attr('aria-pressed', (r) => String(groupFilter.has(r.name)))
        .attr('title', (r) => (groupFilter.has(r.name) ? 'Retirer ce filtre' : 'Filtrer sur cette organisation'))
        .on('click', (_event: MouseEvent, r) =>
          store.set((s) => {
            const current = s.filters.group ?? [];
            return { filters: { ...s.filters, group: current.includes(r.name) ? current.filter((v) => v !== r.name) : [...current, r.name] } };
          }),
        );
      items.select('.cv-group-name').text((r) => r.name);
      items.select('.cv-group-value').text((r) => `${formatCount(r.weight)} ${unit}`);
      items.select('.cv-meter span').style('width', (r) => `${(100 * r.weight) / (best || 1)}%`);
      items.select<HTMLDivElement>('.cv-group-meta').each(function (r) {
        const meta = this;
        meta.replaceChildren();
        const doc = meta.ownerDocument;
        const facts = doc.createElement('span');
        const years = r.years === undefined ? '' : r.years[0] === r.years[1] ? `${r.years[0]}` : `${r.years[0]}–${r.years[1]}`;
        facts.textContent = [
          `${formatCount(r.totals.incidents)} incidents`,
          years,
          `${r.countries.length} pays`,
          r.named ? '' : 'étiquette générique',
        ]
          .filter((part) => part !== '')
          .join(' · ');
        meta.append(facts);
        for (const country of r.countries.slice(0, COUNTRIES_SHOWN)) {
          const chip = doc.createElement('button');
          chip.type = 'button';
          chip.className = 'cv-mini-chip';
          const color = frame.colors.get(country.iso3);
          if (color !== undefined) {
            const swatch = doc.createElement('span');
            swatch.className = 'cv-swatch';
            swatch.style.background = color;
            chip.append(swatch);
          }
          chip.append(doc.createTextNode(env.name(country.iso3)));
          chip.title = `${formatCount(country.incidents)} incidents · ${color === undefined ? 'cliquer pour comparer' : 'déjà comparé'}`;
          chip.addEventListener('click', () => {
            if (color === undefined) toggleCountry(store, country.iso3);
          });
          meta.append(chip);
        }
        if (r.countries.length > COUNTRIES_SHOWN) {
          const more = doc.createElement('span');
          more.className = 'cv-caption';
          more.textContent = `+${r.countries.length - COUNTRIES_SHOWN}`;
          meta.append(more);
        }
      });
      items.order();
      empty.attr('hidden', rows.length === 0 ? null : '');
    },
  };
}
