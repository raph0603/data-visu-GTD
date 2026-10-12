import { geoArea, geoEqualEarth, geoGraticule10, geoPath, pointer, quadtree, zoom, zoomIdentity, type GeoPath, type GeoProjection, type GeoSphere, type Quadtree, type ZoomBehavior, type ZoomTransform } from 'd3';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import type { CountryAtlas, CountryFeature } from '../../core/geo';
import { categoryLabel } from '../../core/labels';
import { toggleCountry } from './selection';
import { describeChange, formatCount, formatRange, formatShare, formatTick, formatWithUnit } from './format';
import { valueOver, type Env, type Frame } from './frame';
import { incidentCategory, type IncidentFiles, type IncidentSet } from './incidents';
import { isNamedGroup, knownShareOf, type Totals } from './model';
import type { Card, Sel } from './ui';

export const WIDTH = 960;
export const HEIGHT = 500;
const SPHERE: GeoSphere = { type: 'Sphere' };
const LINKS_PER_COUNTRY = 10;

interface Anchor {
  readonly point: [number, number];
  readonly bounds: [[number, number], [number, number]];
}

interface Link {
  readonly from: string;
  readonly to: string;
  readonly weight: number;
  readonly groups: readonly { name: string; incidents: number }[];
}

interface Dot {
  readonly set: IncidentSet;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly color: string;
}

export interface WorldMap {
  update(frame: Frame): void;
  highlight(hovered: string | null): void;
  /** Centers the map on one incident (from the incident sheet). */
  locate(set: IncidentSet, index: number): void;
  destroy(): void;
}

/** Projection shared with the incident files (points are projected once, in these coordinates). */
export function createProjection(): GeoProjection {
  return geoEqualEarth().fitExtent(
    [
      [8, 8],
      [WIDTH - 8, HEIGHT - 8],
    ],
    SPHERE,
  );
}

/** The largest polygon of a country: its label point and zoom bounds ignore overseas parts. */
function anchorOf(feature: CountryFeature, path: GeoPath): Anchor {
  const geometry = feature.geometry;
  let main: Feature<Polygon | MultiPolygon> = feature;
  if (geometry.type === 'MultiPolygon') {
    let best = -1;
    for (const coordinates of geometry.coordinates) {
      const part: Feature<Polygon> = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } };
      const area = geoArea(part);
      if (area > best) {
        best = area;
        main = part;
      }
    }
  }
  return { point: path.centroid(main), bounds: path.bounds(main) };
}

export function createWorldMap(env: Env, card: Card, atlas: CountryAtlas, projection: GeoProjection, files: IncidentFiles, onIncident: (eventId: string) => void): WorldMap {
  const { store, palette, model, tooltip } = env;
  const path = geoPath(projection);

  // ------------------------------------------------------------------ header tools
  const tools = card.header.append('div').attr('class', 'cv-tools');
  const pointsToggle = toolToggle(tools, 'Incidents', 'Afficher les incidents des pays sélectionnés', 'map.points');
  const linksToggle = toolToggle(tools, 'Liens', 'Relier les pays par leurs organisations communes', 'map.links');
  tools
    .append('button')
    .attr('type', 'button')
    .attr('class', 'cv-tool')
    .text('Vue monde')
    .on('click', () => resetZoom());

  function toolToggle(parent: Sel<HTMLDivElement>, label: string, title: string, key: string): Sel<HTMLInputElement> {
    const wrap = parent.append('label').attr('class', 'cv-tool cv-tool-check').attr('title', title);
    const input = wrap
      .append('input')
      .attr('type', 'checkbox')
      .on('change', (event: Event) => {
        const on = (event.target as HTMLInputElement).checked;
        store.set((s) => ({ ext: { ...s.ext, [key]: on ? '1' : '0' } }));
      });
    wrap.append('span').text(label);
    return input;
  }

  // ------------------------------------------------------------------ drawing surface
  const stage = card.body.append('div').attr('class', 'cv-map-stage');
  const svg = stage
    .append('svg')
    .attr('viewBox', `0 0 ${WIDTH} ${HEIGHT}`)
    .attr('role', 'img')
    .attr('aria-label', 'Carte du monde des incidents par pays');
  const noData = palette.ensureNoDataPattern(svg.node() as SVGSVGElement);
  const layer = svg.append('g');
  layer.append('path').datum(SPHERE).attr('class', 'cv-sphere').attr('d', path);
  layer.append('path').datum(geoGraticule10()).attr('class', 'cv-graticule').attr('d', path);
  layer
    .append('g')
    .selectAll('path')
    .data(atlas.uncoded)
    .join('path')
    .attr('class', 'cv-uncoded')
    .attr('d', path)
    .attr('fill', noData)
    .on('pointermove', (event: PointerEvent, d) =>
      tooltip.show(event, d.properties.name || 'Territoire', [{ text: 'Sans code ISO : ses incidents sont comptés avec un autre pays ou parmi les non représentables.' }]),
    )
    .on('pointerleave', () => tooltip.hide());
  const countries = layer
    .append('g')
    .selectAll<SVGPathElement, CountryFeature>('path')
    .data(atlas.countries)
    .join('path')
    .attr('class', 'cv-country')
    .attr('d', path);
  const linkLayer = layer.append('g').attr('class', 'cv-links');
  const outlineLayer = layer.append('g').attr('class', 'cv-outlines');
  const labelLayer = layer.append('g').attr('class', 'cv-map-labels');
  const canvas = stage.append('canvas').attr('class', 'cv-points').attr('aria-hidden', 'true');
  const status = stage.append('p').attr('class', 'cv-map-status');
  const legend = card.body.append('div').attr('class', 'cv-legend');

  const anchors = new Map(atlas.countries.map((f) => [f.properties.iso3, anchorOf(f, path)]));

  // ------------------------------------------------------------------ zoom
  let transform: ZoomTransform = zoomIdentity;
  const zoomer: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>()
    .scaleExtent([1, 12])
    .translateExtent([
      [0, 0],
      [WIDTH, HEIGHT],
    ])
    .on('zoom', (event: { transform: ZoomTransform }) => {
      transform = event.transform;
      layer.attr('transform', transform.toString());
      labelLayer.selectAll<SVGTextElement, string>('text').attr('font-size', 11 / transform.k).attr('stroke-width', 3 / transform.k);
      drawPoints();
    });
  svg.call(zoomer).on('dblclick.zoom', null);

  function zoomTo(bounds: [[number, number], [number, number]]): void {
    const [[x0, y0], [x1, y1]] = bounds;
    const k = Math.min(8, 0.85 / Math.max((x1 - x0) / WIDTH, (y1 - y0) / HEIGHT));
    const t = zoomIdentity
      .translate(WIDTH / 2, HEIGHT / 2)
      .scale(k)
      .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    svg.transition().duration(750).call(zoomer.transform, t);
  }

  function resetZoom(): void {
    svg.transition().duration(600).call(zoomer.transform, zoomIdentity);
  }

  // ------------------------------------------------------------------ points (canvas)
  let dots: Dot[] = [];
  let index: Quadtree<Dot> | null = null;
  let maxRadius = 0;
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => drawPoints());
  const stageNode = stage.node();
  if (resize !== null && stageNode !== null) resize.observe(stageNode);

  function radius(killed: number | null): number {
    return killed === null || killed <= 0 ? 1.6 : Math.min(16, 1.6 + 1.15 * Math.sqrt(killed));
  }

  function drawPoints(): void {
    const element = canvas.node();
    const context = element?.getContext?.('2d') ?? null;
    const svgNode = svg.node();
    if (element === null || element === undefined || context === null || svgNode === null) return;
    const width = svgNode.clientWidth;
    const height = svgNode.clientHeight;
    const ratio = element.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) {
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      element.style.width = `${width}px`;
      element.style.height = `${height}px`;
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, element.width, element.height);
    if (dots.length === 0) return;
    const s = (width / WIDTH) * ratio;
    context.setTransform(s * transform.k, 0, 0, s * transform.k, s * transform.x, s * transform.y);
    const pixel = 1 / ((width / WIDTH) * transform.k);
    context.lineWidth = 0.8 * pixel;
    context.strokeStyle = 'rgba(255,255,255,0.9)';
    for (const dot of dots) {
      context.beginPath();
      context.arc(dot.x, dot.y, dot.r * pixel, 0, Math.PI * 2);
      context.fillStyle = dot.color;
      context.globalAlpha = 0.62;
      context.fill();
      context.globalAlpha = 1;
      context.stroke();
    }
  }

  function nearestDot(event: PointerEvent): Dot | null {
    if (index === null) return null;
    const svgNode = svg.node();
    if (svgNode === null) return null;
    const [mx, my] = pointer(event, svgNode);
    const [x, y] = transform.invert([mx, my]);
    const pixel = 1 / ((svgNode.clientWidth / WIDTH) * transform.k);
    const found = index.find(x, y, (maxRadius + 4) * pixel);
    if (found === undefined) return null;
    const distance = Math.hypot(found.x - x, found.y - y);
    return distance <= Math.max(found.r, 5) * pixel ? found : null;
  }

  // ------------------------------------------------------------------ interaction
  let frame: Frame | null = null;
  let hoveredDot: Dot | null = null;

  svg.on('pointermove', (event: PointerEvent) => {
    const dot = nearestDot(event);
    hoveredDot = dot;
    svg.classed('is-over-dot', dot !== null);
    if (dot !== null) {
      tooltip.show(event, ...incidentTooltip(dot));
      return;
    }
    const target = event.target as Element | null;
    const datum = target?.classList.contains('cv-country') ? (target as unknown as { __data__?: CountryFeature }).__data__ : undefined;
    if (datum !== undefined) {
      const iso3 = datum.properties.iso3;
      if (store.get().hover?.id !== iso3) store.set({ hover: { dim: 'country', id: iso3 } });
      tooltip.show(event, ...countryTooltip(iso3));
    } else if (!target?.classList.contains('cv-link-hit') && !target?.classList.contains('cv-uncoded')) {
      tooltip.hide();
      if (store.get().hover !== null) store.set({ hover: null });
    }
  });
  svg.on('pointerleave', () => {
    tooltip.hide();
    hoveredDot = null;
    if (store.get().hover !== null) store.set({ hover: null });
  });
  svg.on('click', (event: MouseEvent) => {
    if (event.defaultPrevented) return; // end of a drag
    if (hoveredDot !== null) {
      onIncident(hoveredDot.set.file.columns.eventId[hoveredDot.index] ?? '');
      return;
    }
    const target = event.target as Element | null;
    const datum = target?.classList.contains('cv-country') ? (target as unknown as { __data__?: CountryFeature }).__data__ : undefined;
    if (datum === undefined) return;
    if (!toggleCountry(store, datum.properties.iso3)) {
      status.text('Six pays au plus : retirez-en un pour en ajouter un autre.').classed('is-visible', true);
      window.setTimeout(() => status.classed('is-visible', false), 2600);
    }
  });

  function countryTooltip(iso3: string): [string, { text: string; strong?: boolean; key?: string }[]] {
    if (frame === null) return [env.name(iso3), []];
    const f = frame;
    const c = model.countryOf(iso3);
    const totals: Totals = model.totals(f.table, c < 0 ? [] : [c], f.state.range);
    const value = f.values.get(iso3) ?? Number.NaN;
    const lines: { text: string; strong?: boolean; key?: string }[] = [];
    const rank = f.ranking.rank.get(iso3);
    lines.push({ text: `${formatWithUnit(value, f.metric)}${rank !== undefined ? ` · ${rank}e sur ${f.ranking.ordered.length}` : ''}`, strong: true });
    if (f.metric.kind !== 'count' && totals.incidents > 0) {
      lines.push({ text: `${formatCount(totals.incidents)} incidents · valeur connue pour ${formatShare(knownShareOf(totals, f.metric))}` });
    } else if (totals.incidents === 0 && f.covered) {
      lines.push({ text: f.filtered ? 'Aucun incident avec ces filtres' : 'Aucun incident enregistré' });
    }
    if (f.state.compare !== null && c >= 0) {
      const before = valueOver(env, f, [c], f.state.compare);
      lines.push({ text: `${formatRange(f.state.compare)} : ${formatWithUnit(before, f.metric)} (${describeChange(value, before).text})` });
    }
    const region = env.region(iso3);
    lines.push({ text: f.colors.has(iso3) ? 'Cliquer pour retirer de la comparaison' : 'Cliquer pour comparer ce pays' });
    return [region === '' ? env.name(iso3) : `${env.name(iso3)} · ${region}`, lines];
  }

  function incidentTooltip(dot: Dot): [string, { text: string; strong?: boolean; key?: string }[]] {
    const { set, index: i } = dot;
    const c = set.file.columns;
    const killed = c.killed[i];
    const wounded = c.wounded[i];
    const date = [c.day[i], c.month[i]].every((v) => v != null) ? `${c.day[i]}/${c.month[i]}/${c.year[i]}` : c.month[i] != null ? `${c.month[i]}/${c.year[i]}` : String(c.year[i]);
    const place = [c.city[i], env.name(set.iso3)].filter((v) => v != null && v !== '').join(', ');
    return [
      `${date} · ${place}`,
      [
        { text: `${killed == null ? 'morts inconnus' : `${formatCount(killed)} mort${killed > 1 ? 's' : ''}`} · ${wounded == null ? 'blessés inconnus' : `${formatCount(wounded)} blessé${wounded > 1 ? 's' : ''}`}`, strong: true, key: dot.color },
        { text: `${categoryLabel('attackType', incidentCategory(set, 'attackType', i))} → ${categoryLabel('targetType', incidentCategory(set, 'targetType', i))}` },
        { text: `${categoryLabel('weaponType', incidentCategory(set, 'weaponType', i))}${c.suicide[i] === 1 ? ' · attentat-suicide' : ''}` },
        { text: categoryLabel('group', incidentCategory(set, 'group', i)) },
        { text: 'Cliquer pour ouvrir la fiche' },
      ],
    ];
  }

  // ------------------------------------------------------------------ update
  let previousSelection = '';

  function update(next: Frame): void {
    frame = next;
    const f = next;
    const ext = f.state.ext;
    const showPoints = ext['map.points'] !== '0';
    const showLinks = ext['map.links'] !== '0';
    pointsToggle.property('checked', showPoints);
    linksToggle.property('checked', showLinks);

    // Choropleth: log scale, a few countries are orders of magnitude above the rest.
    const max = Math.max(0, ...f.ranking.ordered.map((iso3) => f.values.get(iso3) ?? 0));
    const t = (v: number) => (max > 0 ? Math.log1p(v) / Math.log1p(max) : 0);
    const any = f.selected.length > 0;
    countries
      .attr('fill', (d) => {
        const iso3 = d.properties.iso3;
        if (showPoints && f.colors.has(iso3)) return '#f3f2ee';
        const v = f.values.get(iso3) ?? Number.NaN;
        if (Number.isNaN(v)) {
          const c = model.countryOf(iso3);
          return c >= 0 && model.totals(f.table, [c], f.state.range).incidents === 0 && f.covered ? palette.zero : noData;
        }
        return v === 0 ? palette.zero : palette.sequential(t(v));
      })
      .classed('is-muted', (d) => any && !f.colors.has(d.properties.iso3));

    // Selection outlines (surface halo + identity colour) and direct labels.
    const selected = f.selected.filter((iso3) => atlas.featureFor(iso3) !== undefined);
    const outlines = outlineLayer
      .selectAll<SVGGElement, string>('g')
      .data(selected, (iso3) => iso3)
      .join((enter) => {
        const g = enter.append('g');
        g.append('path').attr('class', 'cv-outline-halo');
        g.append('path').attr('class', 'cv-outline');
        return g;
      });
    outlines.selectAll<SVGPathElement, string>('path').attr('d', function () {
      const iso3 = (this.parentNode as unknown as { __data__: string }).__data__;
      return path(atlas.featureFor(iso3) ?? SPHERE) ?? '';
    });
    outlines.select('.cv-outline').attr('stroke', (iso3) => f.colors.get(iso3) ?? '#333');
    labelLayer
      .selectAll<SVGTextElement, string>('text')
      .data(selected, (iso3) => iso3)
      .join('text')
      .attr('x', (iso3) => anchors.get(iso3)?.point[0] ?? 0)
      .attr('y', (iso3) => anchors.get(iso3)?.point[1] ?? 0)
      .attr('font-size', 11 / transform.k)
      .attr('stroke-width', 3 / transform.k)
      .text((iso3) => env.name(iso3));

    // Zoom on the selection when it changes (not on every filter change).
    const key = selected.join(',');
    if (key !== previousSelection) {
      const added = selected.filter((iso3) => !previousSelection.split(',').includes(iso3));
      previousSelection = key;
      if (added.length > 0) {
        const boxes = selected.map((iso3) => anchors.get(iso3)?.bounds).filter((b): b is Anchor['bounds'] => b !== undefined);
        if (boxes.length > 0) {
          zoomTo([
            [Math.min(...boxes.map((b) => b[0][0])), Math.min(...boxes.map((b) => b[0][1]))],
            [Math.max(...boxes.map((b) => b[1][0])), Math.max(...boxes.map((b) => b[1][1]))],
          ]);
        }
      } else if (selected.length === 0) {
        resetZoom();
      }
    }

    drawLinks(showLinks ? computeLinks(f) : [], f);
    updatePoints(showPoints, f);
    drawLegend(max, f, showPoints, showLinks);
  }

  function computeLinks(f: Frame): Link[] {
    const countryCount = model.countryCodes.length;
    const links: Link[] = [];
    for (const from of f.selected) {
      const c = model.countryOf(from);
      if (c < 0) continue;
      const groups = new Set<number>();
      for (const [g] of f.scan.perCountry.get(c)?.group ?? []) {
        if (isNamedGroup(model.dict.group[g] ?? '')) groups.add(g);
      }
      const byCountry = new Map<number, { weight: number; groups: { name: string; incidents: number }[] }>();
      for (const [key, totals] of f.scan.groupCountry) {
        const g = Math.floor(key / countryCount);
        const other = key % countryCount;
        if (other === c || !groups.has(g)) continue;
        const code = model.countryCodes[other] ?? '';
        if (code === '' || !anchors.has(code)) continue;
        const entry = byCountry.get(other) ?? { weight: 0, groups: [] };
        entry.weight += totals.incidents;
        entry.groups.push({ name: model.dict.group[g] ?? '', incidents: totals.incidents });
        byCountry.set(other, entry);
      }
      [...byCountry]
        .sort((a, b) => b[1].weight - a[1].weight)
        .slice(0, LINKS_PER_COUNTRY)
        .forEach(([other, entry]) => {
          links.push({ from, to: model.countryCodes[other] ?? '', weight: entry.weight, groups: entry.groups.sort((a, b) => b.incidents - a.incidents) });
        });
    }
    return links;
  }

  function drawLinks(links: readonly Link[], f: Frame): void {
    const maxWeight = Math.max(1, ...links.map((l) => l.weight));
    const width = (w: number) => 1 + 5 * Math.sqrt(w / maxWeight);
    const arc = (l: Link) => {
      const a = anchors.get(l.from)?.point ?? [0, 0];
      const b = anchors.get(l.to)?.point ?? [0, 0];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const bend = 0.22;
      const cx = (a[0] + b[0]) / 2 - dy * bend;
      const cy = (a[1] + b[1]) / 2 + dx * bend;
      return `M${a[0]},${a[1]} Q${cx},${cy} ${b[0]},${b[1]}`;
    };
    const items = linkLayer
      .selectAll<SVGGElement, Link>('g')
      .data(links, (l) => `${l.from}>${l.to}`)
      .join((enter) => {
        const g = enter.append('g');
        g.append('path').attr('class', 'cv-link');
        g.append('circle').attr('class', 'cv-link-end');
        g.append('path').attr('class', 'cv-link-hit');
        return g;
      });
    items.select('.cv-link').attr('d', arc).attr('stroke', (l) => f.colors.get(l.from) ?? '#555').attr('stroke-width', (l) => width(l.weight));
    items
      .select('.cv-link-end')
      .attr('cx', (l) => anchors.get(l.to)?.point[0] ?? 0)
      .attr('cy', (l) => anchors.get(l.to)?.point[1] ?? 0)
      .attr('r', (l) => 1.5 + width(l.weight) / 2)
      .attr('fill', (l) => f.colors.get(l.from) ?? '#555');
    items
      .select('.cv-link-hit')
      .attr('d', arc)
      .on('pointermove', (event: PointerEvent, l) => {
        const lines = l.groups.slice(0, 5).map((g) => ({ text: `${g.name} : ${formatCount(g.incidents)} incident${g.incidents > 1 ? 's' : ''}` }));
        if (l.groups.length > 5) lines.push({ text: `et ${l.groups.length - 5} autre(s) organisation(s)` });
        lines.push({ text: f.colors.has(l.to) ? '' : `Cliquer pour ajouter ${env.name(l.to)} à la comparaison` });
        tooltip.show(event, `Organisations actives en ${env.name(l.from)} et en ${env.name(l.to)}`, [
          { text: `${formatCount(l.weight)} incidents de ces organisations en ${env.name(l.to)}`, strong: true, key: f.colors.get(l.from) },
          ...lines.filter((line) => line.text !== ''),
        ]);
      })
      .on('pointerleave', () => tooltip.hide())
      .on('click', (event: MouseEvent, l) => {
        event.stopPropagation();
        if (!f.colors.has(l.to)) toggleCountry(store, l.to);
      });
  }

  let pointsToken = 0;

  function updatePoints(show: boolean, f: Frame): void {
    const token = ++pointsToken;
    const missing = show ? f.selected.filter((iso3) => files.get(iso3) === undefined && files.error(iso3) === undefined) : [];
    // Another panel may have loaded the files first: the message only lasts while something is missing.
    status.classed('is-visible', missing.length > 0);
    if (missing.length > 0) {
      status.text('Chargement des incidents…');
      void files.ensure(missing).then(() => {
        if (token !== pointsToken || frame === null) return;
        status.classed('is-visible', false);
        updatePoints(show, frame);
      });
    }
    const next: Dot[] = [];
    if (show) {
      for (const iso3 of f.selected) {
        const set = files.get(iso3);
        if (set === undefined) continue;
        const color = f.colors.get(iso3) ?? '#555';
        const killed = set.file.columns.killed;
        for (const i of files.visible(iso3, f.filters, f.state.range)) {
          next.push({ set, index: i, x: set.x[i] ?? 0, y: set.y[i] ?? 0, r: radius(killed[i] ?? null), color });
        }
      }
    }
    next.sort((a, b) => a.r - b.r);
    dots = next;
    maxRadius = Math.max(0, ...next.map((d) => d.r));
    index = next.length > 0 ? quadtree<Dot>().x((d) => d.x).y((d) => d.y).addAll(next) : null;
    drawPoints();
  }

  function drawLegend(max: number, f: Frame, showPoints: boolean, showLinks: boolean): void {
    legend.selectAll('*').remove();
    const scale = legend.append('div').attr('class', 'cv-legend-item');
    scale.append('span').attr('class', 'cv-legend-title').text(`${f.metric.label} sur la période`);
    const ramp = scale.append('div').attr('class', 'cv-ramp');
    ramp.style('background', `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1].map((s) => palette.sequential(s)).join(', ')})`);
    const ticks = scale.append('div').attr('class', 'cv-ramp-ticks');
    for (const v of logTicks(max)) {
      ticks
        .append('span')
        .style('left', `${(Math.log1p(v) / Math.log1p(max || 1)) * 100}%`)
        .text(formatTick(v));
    }
    const swatches = legend.append('div').attr('class', 'cv-legend-item cv-legend-swatches');
    swatches.append('span').attr('class', 'cv-swatch').style('background', palette.zero);
    swatches.append('span').text(f.metric.kind === 'mean' ? '0 ou aucun incident' : 'zéro');
    swatches.append('span').attr('class', 'cv-swatch cv-swatch-nodata');
    swatches.append('span').text('pas de donnée');
    if (showPoints && f.selected.length > 0) {
      const sizes = legend.append('div').attr('class', 'cv-legend-item cv-legend-sizes');
      sizes.append('span').attr('class', 'cv-legend-title').text('Incident (taille = morts)');
      for (const killed of [0, 10, 100]) {
        const r = radius(killed);
        sizes.append('span').attr('class', 'cv-dot').style('width', `${2 * r}px`).style('height', `${2 * r}px`);
        sizes.append('span').text(killed === 0 ? '0 ou inconnu' : String(killed));
      }
    }
    if (showLinks && f.selected.length > 0) {
      legend
        .append('p')
        .attr('class', 'cv-caption')
        .text('Liens : organisations nommées actives dans les deux pays (étiquettes génériques comme « Gunmen » exclues) ; épaisseur = incidents de ces organisations dans le pays d’arrivée.');
    }
    if (f.selected.length === 0) {
      legend.append('p').attr('class', 'cv-caption').text('Cliquez sur des pays (6 au plus) pour les comparer et voir leurs incidents.');
    }
  }

  function highlight(hovered: string | null): void {
    countries.classed('is-hover', (d) => d.properties.iso3 === hovered);
    countries.filter((d) => d.properties.iso3 === hovered).raise();
  }

  function locate(set: IncidentSet, i: number): void {
    const x = set.x[i] ?? 0;
    const y = set.y[i] ?? 0;
    const k = Math.max(transform.k, 6);
    svg
      .transition()
      .duration(700)
      .call(zoomer.transform, zoomIdentity.translate(WIDTH / 2, HEIGHT / 2).scale(k).translate(-x, -y));
  }

  return {
    update,
    highlight,
    locate,
    destroy() {
      resize?.disconnect();
      svg.interrupt();
      svg.on('.zoom', null);
    },
  };
}

/** 1, 10, 100… then the maximum; a power of ten too close to the maximum is dropped. */
function logTicks(max: number): number[] {
  if (!(max > 0)) return [];
  const position = (v: number) => Math.log1p(v) / Math.log1p(max);
  const ticks: number[] = [];
  for (let p = 1; p < max; p *= 10) ticks.push(p);
  while (ticks.length > 0 && position(max) - position(ticks[ticks.length - 1] ?? 0) < 0.16) ticks.pop();
  ticks.push(max >= 10 ? Math.round(max) : Math.round(max * 10) / 10);
  return ticks;
}
