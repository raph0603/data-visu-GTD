import { geoCentroid, geoDistance, geoGraticule10, geoOrthographic, geoPath } from 'd3';
import type { CountryYearFile } from '../core/contracts';
import type { DataApi } from '../core/data';
import { loadCountryAtlas, type CountryFeature } from '../core/geo';
import { countryName } from '../core/labels';
import type { DatasetMeta } from '../core/meta';
import type { PaletteApi } from '../core/palette';
import type { ViewId } from '../core/tasks';
import { fr, PLANCHES } from './planches';

const SVG_NS = 'http://www.w3.org/2000/svg';
const whole = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export interface CoverOptions {
  readonly meta: DatasetMeta;
  readonly data: DataApi;
  readonly palette: PaletteApi;
  /** Plates whose module is still a stand-in. */
  readonly preparing: ReadonlySet<ViewId>;
  readonly open: (view: ViewId) => void;
}

/**
 * The cover of the atlas: plate 1 as a map that says something (incidents by country over the
 * whole base, on the hemisphere where most of them happened), beside the headline, the figures
 * in the text and the table of plates. It reads the same files as the views.
 */
export function renderCover(host: HTMLElement, options: CoverOptions): () => void {
  const { meta, data, palette, preparing, open } = options;
  const doc = host.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    if (cls !== undefined) node.className = cls;
    if (text !== undefined) node.textContent = fr(text);
    return node;
  };
  const text = (value: string) => doc.createTextNode(fr(value));
  let alive = true;
  const years = meta.years.last - meta.years.first + 1;
  const { gaps } = meta.years;
  const missing = gaps.length === 0 ? '' : gaps.length === 1 ? ` (l’année ${gaps[0]} manque dans la base)` : ` (les années ${gaps.join(', ')} manquent dans la base)`;

  const root = el('div', 'cover');

  // ------------------------------------------------------------------ headline
  const intro = el('section', 'cover-intro');
  const headline = el('h1', 'cover-h1', `${whole.format(meta.rows.total)} attentats en ${years} ans`);
  headline.tabIndex = -1;
  const lede = el('p', 'lede');
  const known = el('span');
  // One sentence: the table of plates below says the rest.
  lede.append(text(`Recensés par la ${meta.dataset.title} de ${meta.years.first} à ${meta.years.last}${missing}`), known, text('.'));
  const primary = el('button', 'button-primary');
  primary.type = 'button';
  primary.innerHTML =
    '<span>Ouvrir la planche 1</span><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';
  primary.addEventListener('click', () => open('map'));
  intro.append(headline, lede, primary);

  // ------------------------------------------------------------------ plate 1
  const plate = el('figure', 'plate');
  const plateTitle = el('h2', 'plate-title');
  plateTitle.append(el('span', 'plate-n', '1'), el('span', 'plate-q', 'Où frappe le terrorisme ?'));
  const mapButton = el('button', 'plate-map');
  mapButton.type = 'button';
  mapButton.setAttribute('aria-label', 'Ouvrir la planche 1, carte par pays');
  const description = el('p', 'visually-hidden', 'Globe des attentats par pays : chargement.');
  description.id = 'cover-map-description';
  mapButton.setAttribute('aria-describedby', description.id);
  mapButton.addEventListener('click', () => open('map'));
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 600 600');
  svg.setAttribute('aria-hidden', 'true');
  mapButton.append(svg);
  const legend = el('div', 'cartouche');
  legend.setAttribute('aria-hidden', 'true');
  const caption = el('figcaption', 'plate-caption');
  caption.append(plateTitle, el('p', 'plate-source', `Source : ${meta.dataset.title}`));
  plate.append(caption, mapButton, legend, description);

  // ------------------------------------------------------------------ table of plates
  const toc = el('nav', 'toc');
  toc.setAttribute('aria-labelledby', 'toc-title');
  const tocTitle = el('h2', 'toc-title', 'Table des planches');
  tocTitle.id = 'toc-title';
  const list = el('ol', 'toc-list');
  for (const p of PLANCHES) {
    const item = el('li');
    const row = el('button', 'toc-row');
    row.type = 'button';
    row.classList.toggle('is-preparing', preparing.has(p.id));
    row.append(el('span', 'toc-n', String(p.n)));
    // Two lines a row: the question with the view's name, then what the plate shows.
    const line = el('span', 'toc-line');
    line.append(el('span', 'toc-q', p.question), el('span', 'toc-name', p.name));
    if (preparing.has(p.id)) line.append(el('span', 'toc-state', 'en préparation'));
    const body = el('span', 'toc-text');
    body.append(line, el('span', 'toc-summary', p.summary));
    row.append(body);
    row.addEventListener('click', () => open(p.id));
    item.append(row);
    list.append(item);
  }
  toc.append(tocTitle, list);
  const caveat = el(
    'p',
    'caveat',
    'Lire avec prudence : la méthode de collecte change en 1998 puis en 2012 ; une hausse qui suit ces dates tient en partie à la méthode.',
  );
  root.append(intro, plate, toc, caveat);
  host.append(root);

  // ------------------------------------------------------------------ the map and the figures
  Promise.all([loadCountryAtlas(), data.countryYear()])
    .then(([atlas, countries]) => {
      if (!alive) return;
      const ranked = drawPlate(svg, legend, atlas.countries, countries, palette);
      description.textContent = fr(`Globe des attentats par pays, ${countries.years.first}–${countries.years.last}, centré sur le Moyen-Orient. En tête : ${ranked
        .slice(0, 4)
        .map(([iso3, v]) => `${countryName(iso3)} (${whole.format(v)})`)
        .join(', ')}.`);
      const deaths = Object.values(countries.entities).reduce((sum, e) => sum + total(e.killed.sum), total(countries.notRepresentable.killed.sum));
      const touched = Object.values(countries.entities).filter((e) => total(e.incidents) > 0).length;
      known.replaceChildren(text(', ils ont fait '), el('strong', undefined, `au moins ${whole.format(deaths)} morts`), text(` dans ${touched} pays et territoires`));
    })
    .catch(() => {
      if (!alive) return;
      description.textContent = fr('Carte indisponible : les données n’ont pas pu être chargées.');
      legend.textContent = description.textContent;
      legend.removeAttribute('aria-hidden');
    });

  return () => {
    alive = false;
    root.remove();
  };
}

function total(values: readonly (number | null)[]): number {
  return values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
}

/**
 * A static choropleth on the hemisphere centred on the Middle East, where most incidents happened.
 * Returns the countries ranked by incidents.
 */
function drawPlate(
  svg: SVGSVGElement,
  legend: HTMLElement,
  features: readonly CountryFeature[],
  countries: CountryYearFile,
  palette: PaletteApi,
): [string, number][] {
  const doc = svg.ownerDocument;
  const centre: [number, number] = [44, 24];
  const projection = geoOrthographic().rotate([-centre[0], -centre[1]]).scale(288).translate([300, 300]).clipAngle(90);
  const path = geoPath(projection);
  const value = new Map(Object.entries(countries.entities).map(([iso3, e]) => [iso3, total(e.incidents)]));
  const max = Math.max(1, ...value.values());
  const t = (v: number) => Math.log10(v) / Math.log10(max);
  const hatch = palette.ensureNoDataPattern(svg);
  const add = (tag: string, attrs: Record<string, string>, parent: Element = svg) => {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.append(node);
    return node;
  };
  add('path', { d: path({ type: 'Sphere' }) ?? '', class: 'sphere' });
  add('path', { d: path(geoGraticule10()) ?? '', class: 'graticule' });
  const land = add('g', { class: 'land' });
  for (const feature of features) {
    const d = path(feature);
    if (d === null || d === '') continue;
    const v = value.get(feature.properties.iso3);
    add('path', { d, fill: v === undefined ? hatch : v === 0 ? palette.zero : palette.sequential(t(v)) }, land);
  }
  add('path', { d: path({ type: 'Sphere' }) ?? '', class: 'limb' });

  // The most affected countries on the visible side carry their name and count. Each label sits at
  // a corner or a side of its point; a small search keeps the best-ranked countries labelled
  // first, then as many others as fit without overlap. On a narrow screen the map is drawn small,
  // so the labels grow in map units to stay about 12 px on screen.
  const k = Math.min(1.8, Math.max(1, (600 / Math.max(1, svg.clientWidth || 600)) * 0.85));
  const ranked = [...value].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  type Box = { x0: number; y0: number; x1: number; y1: number };
  type Spot = Box & { tx: number; anchor: 'start' | 'end' };
  const overlaps = (a: Box, b: Box) => !(a.x1 + 2 < b.x0 || a.x0 > b.x1 + 2 || a.y1 + 2 < b.y0 || a.y0 > b.y1 + 2);
  const candidates: { iso3: string; v: number; x: number; y: number; name: string; dot: Box; spots: Spot[] }[] = [];
  for (const [iso3, v] of ranked) {
    if (candidates.length === 7) break;
    const feature = features.find((f) => f.properties.iso3 === iso3);
    if (feature === undefined) continue;
    const c = geoCentroid(feature) as [number, number];
    if (geoDistance(c, centre) > 1.25) continue;
    const p = projection(c);
    if (p === null) continue;
    const [x, y] = p;
    const name = countryName(iso3, countries.entities[iso3]?.label ?? iso3);
    const w = Math.max(name.length * 8, 44) * k;
    const h = 30 * k;
    const spots = (
      [
        [x + 7 * k, y - h - 2, 'start'],
        [x + 7 * k, y + 4, 'start'],
        [x - 7 * k - w, y - h - 2, 'end'],
        [x - 7 * k - w, y + 4, 'end'],
        [x + 9 * k, y - h / 2, 'start'],
        [x - 9 * k - w, y - h / 2, 'end'],
      ] as const
    )
      .map(([x0, y0, anchor]): Spot => ({ x0, y0, x1: x0 + w, y1: y0 + h, anchor, tx: anchor === 'start' ? x0 : x0 + w }))
      .filter((b) => b.x0 >= 4 && b.x1 <= 596);
    candidates.push({ iso3, v, x, y, name, dot: { x0: x - 3, y0: y - 3, x1: x + 3, y1: y + 3 }, spots });
  }
  const weight = (i: number) => 2 ** (candidates.length - i);
  let best: (Spot | null)[] = [];
  let bestScore = -1;
  const chosen: (Spot | null)[] = [];
  const search = (i: number, score: number): void => {
    if (i === candidates.length) {
      if (score > bestScore) [bestScore, best] = [score, [...chosen]];
      return;
    }
    let rest = 0;
    for (let j = i; j < candidates.length; j++) rest += weight(j);
    if (score + rest <= bestScore) return;
    const cand = candidates[i] as (typeof candidates)[number];
    const labelsSoFar = chosen.filter((s): s is Spot => s !== null);
    const boxes: Box[] = [...labelsSoFar, ...candidates.slice(0, i).map((c) => c.dot)];
    // A point already under a label stays unlabelled.
    const covered = labelsSoFar.some((s) => overlaps(s, cand.dot));
    for (const spot of covered ? [] : cand.spots) {
      if (boxes.some((b) => overlaps(b, spot))) continue;
      chosen.push(spot);
      search(i + 1, score + weight(i));
      chosen.pop();
    }
    chosen.push(null);
    search(i + 1, score);
    chosen.pop();
  };
  search(0, 0);
  const labels = add('g', { class: 'plate-labels' });
  candidates.forEach((cand, i) => {
    const spot = best[i];
    if (spot === undefined || spot === null) return;
    add('circle', { cx: String(cand.x), cy: String(cand.y), r: String(2.5 * k) }, labels);
    const label = add('text', { x: String(spot.tx), y: String(spot.y0 + 12 * k), 'text-anchor': spot.anchor, style: `font-size:${14 * k}px` }, labels);
    add('tspan', {}, label).textContent = cand.name;
    add('tspan', { x: String(spot.tx), dy: String(15 * k), class: 'plate-figure', style: `font-size:${12.5 * k}px` }, label).textContent = whole.format(cand.v);
  });

  // Cartouche: what the colour means, read on a log scale.
  legend.replaceChildren();
  const title = doc.createElement('p');
  title.className = 'cartouche-title';
  title.textContent = `Attentats par pays, ${countries.years.first}–${countries.years.last}`;
  const ramp = doc.createElement('div');
  ramp.className = 'cartouche-ramp';
  ramp.style.background = `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1].map((s) => palette.sequential(s)).join(', ')})`;
  const ticks = doc.createElement('div');
  ticks.className = 'cartouche-ticks';
  for (const v of [1, 10, 100, 1000, 10000]) {
    if (v > max) continue;
    const tick = doc.createElement('span');
    tick.style.left = `${t(v) * 100}%`;
    tick.textContent = whole.format(v);
    ticks.append(tick);
  }
  const scale = doc.createElement('p');
  scale.className = 'cartouche-note';
  scale.textContent = fr(`Échelle logarithmique ; maximum : ${whole.format(max)}.`);
  const keys = doc.createElement('p');
  keys.className = 'cartouche-keys';
  keys.innerHTML = `<span><i class="swatch" style="background:${palette.zero}"></i>aucun attentat</span><span><i class="swatch swatch-nodata"></i>pas de donnée</span>`;
  legend.append(title, ramp, ticks, scale, keys);
  return ranked;
}
