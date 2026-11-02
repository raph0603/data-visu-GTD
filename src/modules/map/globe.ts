import { geoArea, geoCentroid, geoContains, geoDistance, geoGraticule10, geoPath, interpolateRgb, quadtree, timer, type GeoPath, type GeoProjection, type GeoSphere, type Quadtree, type Timer } from 'd3';
import type { Feature, FeatureCollection, LineString, MultiPolygon, Polygon } from 'geojson';
import { mesh } from 'topojson-client';
import type { CountryAtlas } from '../../core/geo';
import { categoryLabel } from '../../core/labels';
import { baseRadius, clampCamera, easeOut, fitCamera, flight, frontProjection, kmPerPixel, MAX_K, onFrontSide, PointProjector, projectionFor, rotateBy, viewRadius, zoomAround, type Camera, type Flight, type Viewport } from './camera';
import { formatCount, formatRange, formatRate, formatShare, formatWithUnit, ordinal, plural } from './format';
import { weightUnit, type Env, type Frame } from './frame';
import { ClassField, HeatField, heatGradient } from './heat';
import { icon, iconLabel } from './icons';
import { cellsOf, deadliestFirst, incidentCategory, incidentDate, type Cells, type IncidentFiles, type IncidentSet } from './incidents';
import { emptyTotals, filtersKey, isNamedGroup, knownShareOf, metricOf } from './model';
import { compareIds, nearestTo, neighbour, PILE_PX, type Direction, type Spot } from './neighbour';
import { bubblesOf, glyphOf, glyphSvg, GroupColors, traceGlyph, WEAPON_GLYPHS, type Bubble } from './organizations';
import { MIN_POPULATION_FOR_RATE } from './population';
import { clearCountries, MAX_SELECTION, selectedCountries as selectedOf, toggleCountry, type Level } from './selection';
import type { Sel, TooltipLine } from './ui';

const SPHERE: GeoSphere = { type: 'Sphere' };
const GRATICULE = geoGraticule10();
/** Flat sea and an ink edge, as on the atlas cover (D23): no lighting, no shadow. */
const OCEAN = '#f3f5f7';
const LIMB = '#1d1d1b';
const BORDER = 'rgba(255, 255, 255, 0.9)';
/** Land of the selected countries: lit, so that the semantic zoom shows where they are. */
const EXPLORED_LAND = '#fbfbf9';
/** Land under the heat: neutral, so the only colour on the globe is the density. */
const LAND = '#e8e7e2';
const INK = '#1d1d1b';
const ARROWS: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
const OTHER = '#8a8983';
/** The shell's typeface (D23), with the system one while it loads. */
const FONT = '"Libre Franklin Variable", system-ui, -apple-system, "Segoe UI", sans-serif';

/** Degrees per second of the idle rotation. */
const SPIN_SPEED = 3;
const COLOR_TWEEN_MS = 320;
const FADE_MS = 200;
/** Blur radius of the heat on screen (px), and the step of its grid. */
const HEAT_RADIUS = 15;
const HEAT_CELL = 3;
/** Above this many incidents in view, points melt into the heat (when its blobs stay large). */
const POINTS_MAX = 1500;
const LINKS_SHOWN = 8;
/** Rates (often below 1 per million) spread over four decades of a log scale under the maximum. */
const RATE_DECADES = 4;
const CITY_LABELS = 7;
/** Share of the view the selected countries fill when framed. */
const SELECTION_MARGIN = 0.8;
/**
 * Semantic zoom (D25). Under this many km per pixel, the heat gives way to the territories of the
 * organizations (sooner when countries are selected, so that selecting one is enough).
 */
const REGION_KPP = 7;
const REGION_KPP_SELECTED = 12;
/** Blur radius and grid step of the territories: finer than the heat, at a finer scale. */
const TERRITORY_RADIUS = 14;
const TERRITORY_CELL = 3;

/** A drawn shape and its bounding circle on the sphere, to skip what cannot be on screen. */
interface Shape {
  readonly iso3: string | null;
  readonly feature: Feature<Polygon | MultiPolygon>;
  readonly centre: [number, number];
  readonly radius: number;
}

/** One border line of the mesh, with its bounding circle like a shape. */
interface Border {
  readonly line: LineString;
  readonly centre: [number, number];
  readonly radius: number;
}

interface Layer {
  readonly shapes: readonly Shape[];
  /** The border mesh split into lines, so that a zoomed view only projects the borders in view. */
  readonly borders: readonly Border[];
  /** Shapes outside the border mesh (small countries added to the simplified layer): stroked one by one. */
  readonly outlined: readonly Shape[];
}

interface Place {
  readonly shape: Shape;
  /** Largest polygon: framing and labels ignore overseas parts. */
  readonly main: Feature<Polygon>;
  readonly anchor: [number, number];
}

interface Link {
  readonly to: string;
  readonly weight: number;
  readonly groups: readonly string[];
}

type Fill = string | null;
type Mode = 'none' | 'heat' | 'groups' | 'points';

/** Incidents drawn one by one (points mode), projected at each frame. */
interface Placed {
  n: number;
  xs: Float64Array;
  ys: Float64Array;
  rs: Float64Array;
  sets: IncidentSet[];
  index: Uint32Array;
}

/** What the panel points at: a country or an organization (shared hover), or one incident. */
export type Highlight = { readonly dim: string; readonly id: string } | null;

export interface Globe {
  update(frame: Frame): void;
  /** Country or organization hovered elsewhere (panel, other views): outlined on the globe. */
  highlight(ref: Highlight): void;
  /** Incident hovered in the panel: ringed where it is. */
  previewIncident(eventId: string | null): void;
  destroy(): void;
}

export interface GlobeAtlases {
  readonly detail: CountryAtlas;
  /** Simplified geometry drawn while the globe moves; null when it could not be loaded. */
  readonly coarse: CountryAtlas | null;
}

export function createGlobe(parent: Sel<HTMLDivElement>, env: Env, atlases: GlobeAtlases, files: IncidentFiles): Globe {
  const { store, palette, model, tooltip } = env;
  const doc = parent.node()?.ownerDocument ?? document;
  const win = doc.defaultView;
  const reducedMotion = win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  // ------------------------------------------------------------------ DOM
  const canvas = parent
    .append('canvas')
    .attr('class', 'cv-globe-canvas')
    .attr('tabindex', '0')
    .attr('role', 'img')
    .attr('aria-describedby', 'cv-globe-keys');
  parent
    .append('p')
    .attr('id', 'cv-globe-keys')
    .attr('class', 'cv-sr-only')
    .text('Flèches : passer à l’attentat voisin dans la direction, Maj et flèche pour sortir d’une pile d’attentats au même endroit. Plus et moins : zoomer. Entrée : sélectionner le pays au centre. Échap : fermer la fiche ou vider la sélection.');
  const hint = parent.append('p').attr('class', 'cv-hint');
  const status = parent.append('p').attr('class', 'cv-globe-status').attr('role', 'status');
  // One row of controls along the top edge, so the cards keep the height of the view.
  const toolbar = parent.append('div').attr('class', 'cv-toolbar');
  const clearButton = toolbar
    .append('button')
    .attr('type', 'button')
    .attr('class', 'cv-clear-button')
    .attr('hidden', '')
    .on('click', () => clearCountries(store));
  toolbar
    .append('button')
    .attr('type', 'button')
    .attr('class', 'cv-world-button')
    .attr('title', 'Revenir au globe entier')
    .html(iconLabel('globe', 'Monde'))
    .on('click', () => flyTo(worldCamera()));
  const controls = toolbar.append('div').attr('class', 'cv-zoom').attr('role', 'group').attr('aria-label', 'Zoom');
  const legend = parent.append('div').attr('class', 'cv-legend');

  // + and − are universal: icon alone, with a label for screen readers. « Monde » gets its word (D22).
  const button = (html: string, title: string, onClick: () => void) =>
    controls.append('button').attr('type', 'button').attr('aria-label', title).attr('title', title).html(html).on('click', onClick);
  button(icon('plus'), 'Zoomer (+)', () => zoomBy(1.6));
  button(icon('minus'), 'Dézoomer (−)', () => zoomBy(1 / 1.6));

  // ------------------------------------------------------------------ geometry
  const detail = buildLayer(atlases.detail);
  const coarse = atlases.coarse === null ? null : hybridLayer(atlases.coarse, detail);
  const places = new Map<string, Place>();
  for (const shape of detail.shapes) {
    if (shape.iso3 === null) continue;
    const main = largestPolygon(shape.feature);
    places.set(shape.iso3, { shape, main, anchor: geoCentroid(main) as [number, number] });
  }
  // Smallest shapes first, so that an enclave (Lesotho) wins over the country around it.
  const pickable = detail.shapes.filter((s) => s.iso3 !== null).sort((a, b) => a.radius - b.radius);
  const heat = new HeatField(doc, HEAT_CELL, HEAT_RADIUS);
  const territories = new ClassField(doc, TERRITORY_CELL, TERRITORY_RADIUS);
  const groupColors = new GroupColors();

  // ------------------------------------------------------------------ state
  let viewport: Viewport = { width: 0, height: 0 };
  let dpr = 1;
  let camera: Camera = { lambda: 20, phi: 18, k: 1 };
  let frame: Frame | null = null;
  let targetKey: string | null = null;
  let active: { flight: Flight; start: number } | null = null;
  let loop: Timer | null = null;
  let lastTick = 0;
  let dirty = false;
  let moving = false;
  let dragging = false;
  let wheeling: number | null = null;
  let spinStopped = reducedMotion;
  /** The camera is on the framing of the selection, not moved by the reader since. */
  let framed = false;
  let pointerInside = false;
  let hovered: string | null = null;
  let external: string | null = null;
  let externalGroup: string | null = null;
  let previewed: string | null = null;
  /** Cross-fade of the incident layer when the period or a filter changes (D22). */
  const fadeCanvas = doc.createElement('canvas');
  let fadeStart = -Infinity;
  let fadeCamera = '';
  let incidentKey = '';
  let mode: Mode = 'none';

  let targetFills = new Map<string, Fill>();
  let fromFills = new Map<string, Fill>();
  let tweenStart = -Infinity;

  let placed: Placed = { n: 0, xs: new Float64Array(0), ys: new Float64Array(0), rs: new Float64Array(0), sets: [], index: new Uint32Array(0) };
  /** Position cells of the incident layer that fall in view, projected at each frame (hexagon mode). */
  let inView = { n: 0, total: 0, xs: new Float64Array(0), ys: new Float64Array(0), idx: new Uint32Array(0) };
  let cells: Cells | null = null;
  let lastSelection: readonly string[] = [];
  let lastClick: { iso3: string; at: number } | null = null;
  let flash: number | null = null;
  let points: Quadtree<number> | null = null;
  let heatMax = 0;
  let bubbles: Bubble[] = [];
  let linkIndex: { byCountry: Map<number, Map<number, number>>; byGroup: Map<number, Map<number, number>> } | null = null;
  let legendKey = '';
  let legendOpen = false;
  const hinted = new Set<Level>();

  const now = () => win?.performance?.now() ?? Date.now();

  // ------------------------------------------------------------------ sizing
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
  const parentNode = parent.node();
  if (resize !== null && parentNode !== null) resize.observe(parentNode);

  function measure(): void {
    const element = canvas.node();
    const box = parentNode?.getBoundingClientRect();
    if (element == null || box === undefined || box.width === 0 || box.height === 0) return;
    const first = viewport.width === 0;
    viewport = { width: box.width, height: box.height };
    dpr = win?.devicePixelRatio ?? 1;
    element.width = Math.round(box.width * dpr);
    element.height = Math.round(box.height * dpr);
    element.style.width = `${box.width}px`;
    element.style.height = `${box.height}px`;
    if (first) camera = { ...camera, k: worldZoom() };
    // The first size decides the framing of a deep link (#f=country:IRQ): no flight to it.
    if (first && frame !== null) {
      targetKey = null;
      syncCamera(frame, true);
    } else if (framed && frame !== null && frame.selected.length > 0 && frame.state.incident === null) {
      // The view changed size (the panel folded) under a framing nobody moved since: frame again.
      const target = selectionCamera(frame.selected);
      if (target !== null) {
        active = null;
        camera = target;
      }
    }
    requestDraw();
  }

  // ------------------------------------------------------------------ animation loop
  function requestDraw(): void {
    dirty = true;
    if (loop === null) {
      lastTick = now();
      loop = timer(tick);
    }
  }

  function spinning(): boolean {
    return !spinStopped && !pointerInside && frame?.selected.length === 0 && active === null && !dragging;
  }

  function tick(): void {
    const t = now();
    const dt = Math.min(0.1, (t - lastTick) / 1000);
    lastTick = t;
    let animating = false;
    if (active !== null) {
      const u = Math.min(1, (t - active.start) / active.flight.duration);
      camera = active.flight.at(easeOut(u));
      if (u >= 1) active = null;
      else animating = true;
      dirty = true;
    }
    if (spinning()) {
      camera = clampCamera({ ...camera, lambda: camera.lambda + SPIN_SPEED * dt });
      animating = true;
      dirty = true;
    }
    if (t - tweenStart < COLOR_TWEEN_MS || t - fadeStart < FADE_MS) {
      animating = true;
      dirty = true;
    }
    const wasMoving = moving;
    moving = active !== null || spinning() || dragging || wheeling !== null;
    // When the motion stops, one more frame swaps the simplified geometry for the detailed one.
    if (dirty || (wasMoving && !moving)) {
      dirty = false;
      draw();
    }
    if (!animating && !dragging && wheeling === null && loop !== null) {
      loop.stop();
      loop = null;
    }
  }

  function flyTo(target: Camera, immediate = reducedMotion): void {
    if (immediate || viewport.width === 0) {
      active = null;
      camera = target;
    } else {
      active = { flight: flight(camera, target), start: now() };
    }
    requestDraw();
  }

  function worldCamera(): Camera {
    return { lambda: camera.lambda, phi: Math.abs(camera.phi) > 35 ? 18 : camera.phi, k: worldZoom() };
  }

  /**
   * The whole globe fills the width of the view rather than its height: in a wide view the poles,
   * where almost nothing happened, are cut, and the inhabited latitudes get the room.
   */
  function worldZoom(): number {
    return Math.min(1.5, Math.max(1, (viewport.width * 0.47) / baseRadius(viewport)));
  }

  /**
   * Camera framing some countries: all of them when they fit in one view (pairwise less than about
   * 100° apart), else the last one.
   */
  function selectionCamera(iso3s: readonly string[]): Camera | null {
    const mains = iso3s.map((iso3) => places.get(iso3)).filter((p): p is Place => p !== undefined);
    const last = mains[mains.length - 1];
    if (last === undefined || viewport.width === 0) return null;
    const together = mains.every((a) => mains.every((b) => geoDistance(a.anchor, b.anchor) < 1.7));
    const object: FeatureCollection<Polygon> | Feature<Polygon> = together && mains.length > 1 ? { type: 'FeatureCollection', features: mains.map((p) => p.main) } : last.main;
    return fitCamera(object, viewport, SELECTION_MARGIN);
  }

  /**
   * Semantic zoom: every change of the selection frames the selected countries, close enough for the
   * organizations to show; emptying it returns to the whole globe. An opened incident is flown to.
   */
  function syncCamera(f: Frame, immediate: boolean): void {
    const key = `${f.selected.join(',')}|${f.state.incident ?? ''}`;
    if (key === targetKey || viewport.width === 0) return;
    let target: Camera | null = null;
    if (f.state.incident !== null) {
      const found = files.find(f.state.incident);
      if (found === undefined) return; // its file is still loading: next update retries
      const c = found.set.file.columns;
      const base = selectionCamera([found.set.iso3]);
      target = clampCamera({ lambda: c.longitude[found.index] ?? 0, phi: c.latitude[found.index] ?? 0, k: Math.min(MAX_K, Math.max(camera.k, (base?.k ?? 8) * 6, 40)) });
    } else {
      const changed = f.selected.length !== lastSelection.length || f.selected.some((iso3) => !lastSelection.includes(iso3));
      if (changed) target = f.selected.length > 0 ? selectionCamera(f.selected) : immediate ? null : worldCamera();
    }
    targetKey = key;
    lastSelection = f.selected;
    if (target === null) return;
    spinStopped = true;
    framed = f.selected.length > 0 && f.state.incident === null;
    flyTo(target, immediate);
  }

  // ------------------------------------------------------------------ fills
  function computeFills(f: Frame): Map<string, Fill> {
    const fills = new Map<string, Fill>();
    for (const iso3 of env.drawable) fills.set(iso3, f.colors.has(iso3) ? EXPLORED_LAND : LAND);
    return fills;
  }

  function fillAt(iso3: string, u: number): Fill {
    const to = targetFills.get(iso3) ?? null;
    if (u >= 1) return to;
    const from = fromFills.get(iso3) ?? null;
    return from === null || to === null || from === to ? to : interpolateRgb(from, to)(u);
  }

  // ------------------------------------------------------------------ drawing
  /**
   * Two layers: the base (ocean, countries, borders, explored countries, incidents, labels) is kept
   * in an offscreen canvas while the camera and the data stay the same; the hover layer (outline,
   * links) is drawn over it, so hovering never redraws two hundred countries.
   */
  const baseCanvas = doc.createElement('canvas');
  let baseKey = '';
  let baseVersion = 0;
  // Canvas text does not wait for web fonts: once the shell's typeface is in, the labels are redrawn
  // with it rather than left in the system face of the first paint (D23).
  void doc.fonts
    ?.load(`600 12px ${FONT}`)
    .then(() => {
      if (canvas.node()?.isConnected !== true) return;
      baseVersion++;
      requestDraw();
    })
    .catch(() => undefined);

  function draw(): void {
    const element = canvas.node();
    const context = element?.getContext?.('2d') ?? null;
    if (element == null || context === null || viewport.width === 0 || frame === null) return;
    const f = frame;
    const layer = layerFor();
    const tweening = now() - tweenStart < COLOR_TWEEN_MS;
    const key = `${camera.lambda}|${camera.phi}|${camera.k}|${element.width}x${element.height}|${baseVersion}|${layer === detail ? 'detail' : 'coarse'}`;
    if (tweening || key !== baseKey) {
      if (baseCanvas.width !== element.width || baseCanvas.height !== element.height) {
        baseCanvas.width = element.width;
        baseCanvas.height = element.height;
      }
      const base = baseCanvas.getContext?.('2d') ?? null;
      if (base === null) return;
      renderBase(base, f, layer);
      baseKey = tweening ? '' : key;
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, element.width, element.height);
    context.drawImage(baseCanvas, 0, 0);
    // The previous incidents fade out over the new ones; a camera move ends the fade at once.
    const fade = (now() - fadeStart) / FADE_MS;
    if (fade < 1 && fadeCamera === cameraKey(element)) {
      context.globalAlpha = 1 - easeOut(fade);
      context.drawImage(fadeCanvas, 0, 0);
      context.globalAlpha = 1;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    updateLegend(f);
    if (externalGroup !== null) drawGroupCountries(context, f, externalGroup);
    if (previewed !== null) drawPreview(context, previewed);

    const highlighted = hovered ?? external;
    if (highlighted !== null) {
      const projection = projectionFor(camera, viewport);
      const path = geoPath(projection, context);
      if (f.selected.length === 0) drawLinks(context, path, projection, [camera.lambda, camera.phi], f, highlighted);
      const place = places.get(highlighted);
      if (place !== undefined && !f.colors.has(highlighted)) {
        context.beginPath();
        path(place.shape.feature);
        context.strokeStyle = INK;
        context.lineWidth = 1.5;
        context.stroke();
      }
    }
  }

  function cameraKey(element: HTMLCanvasElement): string {
    return `${camera.lambda}|${camera.phi}|${camera.k}|${element.width}x${element.height}`;
  }

  /** Countries where an organization hovered in the panel acts, over the window. */
  function drawGroupCountries(context: CanvasRenderingContext2D, f: Frame, name: string): void {
    const g = model.indexOf('group', name);
    if (g < 0) return;
    const path = geoPath(projectionFor(camera, viewport), context);
    const countryCount = model.countryCodes.length;
    context.beginPath();
    for (let c = 0; c < countryCount; c++) {
      if ((f.scan.groupCountry.get(g * countryCount + c)?.incidents ?? 0) === 0) continue;
      const place = places.get(model.countryCodes[c] ?? '');
      if (place !== undefined) path(place.shape.feature);
    }
    context.fillStyle = 'rgba(29, 29, 27, 0.12)';
    context.fill();
    context.strokeStyle = INK;
    context.lineWidth = 1.5;
    context.stroke();
  }

  /** A ring around an incident hovered in the panel, at whatever zoom. */
  function drawPreview(context: CanvasRenderingContext2D, eventId: string): void {
    const found = files.find(eventId);
    if (found === undefined) return;
    const { set, index: i } = found;
    const out: [number, number] = [0, 0];
    if (!new PointProjector(camera, viewport).project(set.cosLat[i] ?? 0, set.sinLat[i] ?? 0, set.cosLon[i] ?? 0, set.sinLon[i] ?? 0, out)) return;
    context.beginPath();
    context.arc(out[0], out[1], 9, 0, Math.PI * 2);
    context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    context.lineWidth = 5;
    context.stroke();
    context.strokeStyle = INK;
    context.lineWidth = 2;
    context.stroke();
  }

  /** The simplified geometry at a low zoom or while moving across a region, the detailed one otherwise. */
  function layerFor(): Layer {
    if (coarse === null) return detail;
    return camera.k < 1.6 || (moving && camera.k < 4) ? coarse : detail;
  }

  function renderBase(context: CanvasRenderingContext2D, f: Frame, layer: Layer): void {
    const { width, height } = viewport;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    const projection = projectionFor(camera, viewport);
    const path = geoPath(projection, context);
    const fast = geoPath(frontProjection(camera, viewport), context);
    const trace = (shape: Shape) => (onFrontSide(camera, shape.centre, shape.radius) ? fast : path)(shape.feature);
    const centre: [number, number] = [camera.lambda, camera.phi];
    const reach = viewRadius(camera, viewport) + 0.03;

    context.beginPath();
    path(SPHERE);
    context.fillStyle = OCEAN;
    context.fill();

    if (camera.k < 10) {
      context.beginPath();
      path(GRATICULE);
      context.strokeStyle = 'rgba(60, 90, 120, 0.09)';
      context.lineWidth = 0.6;
      context.stroke();
    }

    const u = easeOut(Math.min(1, (now() - tweenStart) / COLOR_TWEEN_MS));
    // One fill per colour rather than per country: the colours are quantized (computeFills), so a
    // frame fills a few dozen paths instead of two hundred.
    const byFill = new Map<string, Shape[]>();
    for (const shape of layer.shapes) {
      if (geoDistance(centre, shape.centre) - shape.radius > reach) continue;
      const key = (shape.iso3 === null ? null : fillAt(shape.iso3, u)) ?? '';
      const group = byFill.get(key);
      if (group === undefined) byFill.set(key, [shape]);
      else group.push(shape);
    }
    for (const [fill, shapes] of byFill) {
      context.beginPath();
      for (const shape of shapes) trace(shape);
      context.fillStyle = fill === '' ? LAND : fill;
      context.fill();
    }
    context.beginPath();
    for (const border of layer.borders) {
      if (geoDistance(centre, border.centre) - border.radius > reach) continue;
      (onFrontSide(camera, border.centre, border.radius) ? fast : path)(border.line);
    }
    for (const shape of layer.outlined) if (geoDistance(centre, shape.centre) - shape.radius <= reach) trace(shape);
    context.strokeStyle = BORDER;
    context.lineWidth = camera.k > 4 ? 1 : 0.6;
    context.stroke();

    // Explored countries: identity outline on a light halo, so it holds over any fill.
    for (const iso3 of f.selected) {
      const place = places.get(iso3);
      if (place === undefined) continue;
      context.beginPath();
      path(place.shape.feature);
      context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      context.lineWidth = 4.5;
      context.stroke();
      // Ink, not the identity colour: on the globe, colour now names the organizations.
      context.strokeStyle = INK;
      context.lineWidth = 2;
      context.stroke();
    }

    // Cells near the limb would spill over the ink edge: the incident layer is clipped to the sphere.
    context.save();
    context.beginPath();
    path(SPHERE);
    context.clip();
    drawIncidents(context, f, centre, reach);
    context.restore();

    drawLabels(context);

    context.beginPath();
    path(SPHERE);
    context.strokeStyle = LIMB;
    context.lineWidth = 1;
    context.stroke();
  }

  function drawLinks(context: CanvasRenderingContext2D, path: GeoPath, projection: GeoProjection, centre: [number, number], f: Frame, iso3: string): void {
    const from = places.get(iso3);
    const links = linksOf(f, iso3);
    if (from === undefined || links.length === 0) return;
    const max = Math.max(1, ...links.map((l) => l.weight));
    context.lineCap = 'round';
    for (const link of links) {
      const to = places.get(link.to);
      if (to === undefined) continue;
      const line: LineString = { type: 'LineString', coordinates: [from.anchor, to.anchor] };
      context.beginPath();
      path(line);
      context.strokeStyle = 'rgba(29, 29, 27, 0.55)';
      context.lineWidth = 1 + 2.6 * Math.sqrt(link.weight / max);
      context.stroke();
      if (geoDistance(centre, to.anchor) < Math.PI / 2) {
        const p = projection(to.anchor);
        if (p !== null) {
          context.beginPath();
          context.arc(p[0], p[1], 2.6, 0, Math.PI * 2);
          context.fillStyle = INK;
          context.fill();
        }
      }
    }
    context.lineCap = 'butt';
  }

  function drawIncidents(context: CanvasRenderingContext2D, f: Frame, centre: [number, number], reach: number): void {
    points = null;
    placed.n = 0;
    inView.n = 0;
    bubbles = [];
    const from = env.drawable;
    heat.clear();
    territories.clear();
    cells = cellsOf(files, from, f.filters, f.state.range);
    if (cells.n === 0) {
      mode = 'none';
      return;
    }
    projectCells(cells);
    // Three readings along the zoom (D25), with some hysteresis so that a zoom hovering around a
    // threshold does not flicker: where (heat), who (territories and bubbles), how (one glyph each).
    const kpp = kmPerPixel(camera, viewport);
    const blobKm = HEAT_RADIUS * kpp;
    const dense = mode === 'points' ? inView.total > POINTS_MAX && blobKm > 6 : inView.total > POINTS_MAX * 0.8 && blobKm > 4;
    const regionKpp = f.selected.length > 0 ? REGION_KPP_SELECTED : REGION_KPP;
    const close = mode === 'groups' || mode === 'points' ? kpp < regionKpp * 1.1 : kpp < regionKpp;
    mode = !dense ? 'points' : close ? 'groups' : 'heat';
    if (mode === 'heat') {
      drawHeat(context, f, cells);
      return;
    }
    projectPoints(f, from, centre, reach);
    // The organizations are ranked in the selected countries, or else in the countries in view.
    groupColors.update(files, f.selected.length > 0 ? f.selected : countriesInView(), f.filters, f.state.range);
    if (mode === 'groups') {
      drawTerritories(context, f, 1);
      drawBubbles(context, f);
    } else {
      drawTerritories(context, f, 0.35);
      drawPoints(context, f);
    }
  }

  /** Countries of the projected incidents, most incidents in view first (at most eight). */
  function countriesInView(): string[] {
    const counts = new Map<string, number>();
    for (let m = 0; m < placed.n; m++) {
      const iso3 = placed.sets[m]?.iso3;
      if (iso3 !== undefined) counts.set(iso3, (counts.get(iso3) ?? 0) + 1);
    }
    return [...counts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([iso3]) => iso3);
  }

  /** Weight of one projected incident on the territories: 1, its deaths or its wounded. */
  function incidentWeight(f: Frame): (m: number) => number {
    const metric = f.metric;
    const sum = metric.kind === 'count' ? null : metric.kind === 'mean' ? metric.of : metric.id;
    // With a selection, the territories are those of the selected countries: the rest of the view recedes.
    const only = f.selected.length > 0 ? new Set(f.selected) : null;
    return (m) => {
      const set = placed.sets[m];
      if (only !== null && (set === undefined || !only.has(set.iso3))) return 0;
      if (sum === null) return 1;
      const value = set === undefined ? null : (sum === 'killed' ? set.file.columns.killed : set.file.columns.wounded)[placed.index[m] ?? 0];
      return value ?? 0;
    };
  }

  /** Who holds the ground: each place takes the colour of its leading organization. */
  function drawTerritories(context: CanvasRenderingContext2D, f: Frame, alpha: number): void {
    const classOf = (m: number): number => {
      const set = placed.sets[m];
      return set === undefined ? groupColors.other : groupColors.slotOf(set, placed.index[m] ?? 0);
    };
    context.globalAlpha = alpha;
    territories.draw(context, placed.xs, placed.ys, placed.n, incidentWeight(f), classOf, groupColors.colors, viewport.width, viewport.height);
    context.globalAlpha = 1;
  }

  /**
   * Over the territories, the leading organizations of each country in focus as bubbles: area for
   * their incidents in view, a black arc for their share of suicide attacks.
   */
  function drawBubbles(context: CanvasRenderingContext2D, f: Frame): void {
    const focus = f.selected.length > 0 ? new Set(f.selected) : new Set(countriesInView().slice(0, 6));
    bubbles = bubblesOf(placed.n, placed.xs, placed.ys, placed.sets, placed.index, groupColors, (iso3) => focus.has(iso3), focus.size === 1 ? 5 : 3);
    for (const b of bubbles) {
      context.beginPath();
      context.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      context.globalAlpha = 0.9;
      context.fillStyle = groupColors.colorOf(b.slot);
      context.fill();
      context.globalAlpha = 1;
      context.strokeStyle = '#ffffff';
      context.lineWidth = 2;
      context.stroke();
      const share = b.suicide / b.incidents;
      if (share > 0) {
        context.beginPath();
        context.arc(b.x, b.y, b.r + 3.5, 0, Math.PI * 2);
        context.strokeStyle = 'rgba(29, 29, 27, 0.16)';
        context.lineWidth = 3;
        context.stroke();
        context.beginPath();
        context.arc(b.x, b.y, b.r + 3.5, -Math.PI / 2, -Math.PI / 2 + Math.max(0.12, share * Math.PI * 2));
        context.strokeStyle = INK;
        context.stroke();
      }
    }
  }

  function projectCells(c: Cells): void {
    if (inView.xs.length < c.n) inView = { n: 0, total: 0, xs: new Float64Array(c.n), ys: new Float64Array(c.n), idx: new Uint32Array(c.n) };
    const projector = new PointProjector(camera, viewport);
    const out: [number, number] = [0, 0];
    let m = 0;
    let total = 0;
    for (let i = 0; i < c.n; i++) {
      if (!projector.project(c.cosLat[i] ?? 0, c.sinLat[i] ?? 0, c.cosLon[i] ?? 0, c.sinLon[i] ?? 0, out)) continue;
      if (out[0] < -HEAT_RADIUS || out[1] < -HEAT_RADIUS || out[0] > viewport.width + HEAT_RADIUS || out[1] > viewport.height + HEAT_RADIUS) continue;
      inView.xs[m] = out[0];
      inView.ys[m] = out[1];
      inView.idx[m] = i;
      total += c.incidents[i] ?? 0;
      m++;
    }
    inView.n = m;
    inView.total = total;
  }

  /** The incidents themselves, for the countries that reach the view, deadliest first in each country. */
  function projectPoints(f: Frame, from: readonly string[], centre: [number, number], reach: number): void {
    const projector = new PointProjector(camera, viewport);
    const out: [number, number] = [0, 0];
    const margin = 24;
    let m = 0;
    for (const iso3 of from) {
      const set = files.get(iso3);
      const place = places.get(iso3);
      if (set === undefined || (place !== undefined && geoDistance(centre, place.shape.centre) - place.shape.radius > reach)) continue;
      const killed = set.file.columns.killed;
      const order = deadliestFirst(files, iso3, f.filters, f.state.range);
      if (placed.xs.length < m + order.length) {
        const size = Math.max(2 * placed.xs.length, m + order.length);
        const grow = <T extends Float64Array | Uint32Array>(a: T, make: (n: number) => T): T => {
          const b = make(size);
          b.set(a.subarray(0, m));
          return b;
        };
        placed = {
          n: m,
          xs: grow(placed.xs, (n) => new Float64Array(n)),
          ys: grow(placed.ys, (n) => new Float64Array(n)),
          rs: grow(placed.rs, (n) => new Float64Array(n)),
          sets: placed.sets,
          index: grow(placed.index, (n) => new Uint32Array(n)),
        };
      }
      for (const i of order) {
        if (!projector.project(set.cosLat[i] ?? 0, set.sinLat[i] ?? 0, set.cosLon[i] ?? 0, set.sinLon[i] ?? 0, out)) continue;
        if (out[0] < -margin || out[1] < -margin || out[0] > viewport.width + margin || out[1] > viewport.height + margin) continue;
        placed.xs[m] = out[0];
        placed.ys[m] = out[1];
        placed.rs[m] = pointRadius(killed[i] ?? null);
        placed.sets[m] = set;
        placed.index[m] = i;
        m++;
      }
    }
    placed.n = m;
  }

  /** The density of the metric's weight (incidents, deaths or wounded), blurred into heat. */
  function drawHeat(context: CanvasRenderingContext2D, f: Frame, c: Cells): void {
    const metric = f.metric;
    const sum = metric.kind === 'count' ? null : metric.kind === 'mean' ? metric.of : metric.id;
    const values = sum === null ? c.incidents : sum === 'killed' ? c.killedSum : c.woundedSum;
    heat.draw(context, inView.xs, inView.ys, (m) => values[inView.idx[m] ?? 0] ?? 0, inView.n, viewport.width, viewport.height);
    heatMax = heat.max;
  }

  /** Colours of the five most frequent attack types (validated order); the others share a grey. */
  const attackColors = new Map<string, string>(Object.entries(palette.attackTypes));
  const attackBySet = new WeakMap<IncidentSet, readonly string[]>();

  function attackColorOf(set: IncidentSet, i: number): string {
    let colors = attackBySet.get(set);
    if (colors === undefined) attackBySet.set(set, (colors = set.file.dictionaries.attackType.map((type) => attackColors.get(type) ?? palette.other)));
    return colors[set.file.columns.attackType[i] ?? 0] ?? palette.other;
  }

  /**
   * One glyph per incident: colour for its organization (as on the territories) or its attack type,
   * shape for its weapon, size for its deaths, a black ring for a suicide attack.
   */
  function drawPoints(context: CanvasRenderingContext2D, f: Frame): void {
    const open = f.state.incident;
    const byAttack = f.state.ext['map.color'] === 'attack';
    let ring: [number, number, number] | null = null;
    for (let n = 0; n < placed.n; n++) {
      const set = placed.sets[n];
      if (set === undefined) continue;
      const i = placed.index[n] ?? 0;
      const x = placed.xs[n] ?? 0;
      const y = placed.ys[n] ?? 0;
      const r = placed.rs[n] ?? 2;
      const c = set.file.columns;
      traceGlyph(context, glyphOf(set.file.dictionaries.weaponType[c.weaponType[i] ?? 0] ?? 'Unknown'), x, y, r);
      context.globalAlpha = 0.85;
      context.fillStyle = byAttack ? attackColorOf(set, i) : groupColors.colorOf(groupColors.slotOf(set, i));
      context.fill();
      context.globalAlpha = 1;
      if (c.suicide[i] === 1) {
        context.strokeStyle = INK;
        context.lineWidth = 1.8;
      } else {
        context.strokeStyle = 'rgba(255, 255, 255, 0.92)';
        context.lineWidth = 0.8;
      }
      context.stroke();
      if (open !== null && c.eventId[i] === open) ring = [x, y, r];
    }
    if (ring !== null && open !== null) drawSelection(context, ring[0], ring[1], ring[2], open);
  }

  /**
   * The open incident: four corner marks, like a viewfinder. A ring would read as the black ring of
   * a suicide attack; the marks are used for nothing else. Under a pile, its rank among the
   * incidents at that spot (oldest first) is written above.
   */
  function drawSelection(context: CanvasRenderingContext2D, x: number, y: number, r: number, open: string): void {
    const d = r + 7;
    const arm = Math.min(9, Math.max(5, d * 0.7));
    context.beginPath();
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        context.moveTo(x + sx * d, y + sy * (d - arm));
        context.lineTo(x + sx * d, y + sy * d);
        context.lineTo(x + sx * (d - arm), y + sy * d);
      }
    }
    context.lineCap = 'square';
    context.lineJoin = 'miter';
    context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    context.lineWidth = 5;
    context.stroke();
    context.strokeStyle = INK;
    context.lineWidth = 2;
    context.stroke();
    context.lineCap = 'butt';
    let size = 0;
    let rank = 0;
    for (let n = 0; n < placed.n; n++) {
      if (Math.hypot((placed.xs[n] ?? 0) - x, (placed.ys[n] ?? 0) - y) > PILE_PX) continue;
      size++;
      const id = placed.sets[n]?.file.columns.eventId[placed.index[n] ?? 0];
      if (id !== undefined && compareIds(id, open) < 0) rank++;
    }
    if (size < 2) return;
    context.font = `700 11.5px ${FONT}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.lineWidth = 3.5;
    context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    context.strokeText(`${rank + 1}/${size}`, x, y - d - 9);
    context.fillStyle = INK;
    context.fillText(`${rank + 1}/${size}`, x, y - d - 9);
  }

  function drawLabels(context: CanvasRenderingContext2D): void {
    // Organizations and selected countries first, then the cities, which are the landmarks.
    const taken: [number, number, number, number][] = [];
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    const label = (text: string, x: number, y: number, weight: number, size: number, color: string): void => {
      context.font = `${weight} ${size}px ${FONT}`;
      const w = context.measureText(text).width + 8;
      const h = size + 4;
      const box: [number, number, number, number] = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
      if (taken.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return;
      taken.push(box);
      context.lineWidth = 3.5;
      context.strokeStyle = 'rgba(255, 255, 255, 0.92)';
      context.strokeText(text, x, y);
      context.fillStyle = color;
      context.fillText(text, x, y);
    };
    for (const b of bubbles) {
      if (b.r >= 9) label(shortName(b.name), b.x, b.y + b.r + 11, 600, 11.5, INK);
    }
    if (mode !== 'heat') {
      const projection = projectionFor(camera, viewport);
      const centre: [number, number] = [camera.lambda, camera.phi];
      for (const iso3 of frame?.selected ?? []) {
        const place = places.get(iso3);
        if (place === undefined || geoDistance(centre, place.anchor) > Math.PI / 2 - 0.1) continue;
        const p = projection(place.anchor);
        if (p != null) label(env.name(iso3).toUpperCase(), p[0], p[1] - 30, 700, 13, INK);
      }
    }
    // There is no base map under the incidents: the most affected cities in view are the landmarks,
    // placed on their busiest position (a name shared by two countries is not averaged).
    const c = cells;
    if (c === null || inView.n === 0) return;
    const cities = new Map<string, { x: number; y: number; n: number; best: number }>();
    for (let m = 0; m < inView.n; m++) {
      const i = inView.idx[m] ?? 0;
      const city = c.city[i];
      if (city == null || city === '' || city === 'Unknown') continue;
      const weight = c.incidents[i] ?? 0;
      const entry = cities.get(city);
      if (entry === undefined) cities.set(city, { x: inView.xs[m] ?? 0, y: inView.ys[m] ?? 0, n: weight, best: weight });
      else {
        entry.n += weight;
        if (weight > entry.best) {
          entry.best = weight;
          entry.x = inView.xs[m] ?? 0;
          entry.y = inView.ys[m] ?? 0;
        }
      }
    }
    const top = [...cities].filter(([, city]) => city.n >= 3).sort((a, b) => b[1].n - a[1].n).slice(0, CITY_LABELS);
    for (const [city, entry] of top) label(city, entry.x, entry.y - 13, 500, 12, '#3b3a37');
  }

  // ------------------------------------------------------------------ legend and hints
  function updateLegend(f: Frame): void {
    const km = Math.round(2 * HEAT_RADIUS * kmPerPixel(camera, viewport));
    const byAttack = f.state.ext['map.color'] === 'attack';
    const key = `${mode}|${f.metric.id}|${byAttack}|${formatRange(f.state.range)}|${mode === 'heat' ? `${Math.round(heatMax)}|${km}` : groupColors.names.join(',')}|${f.withoutCoordinates.world}`;
    if (key === legendKey) return;
    legendKey = key;
    legend.selectAll('*').remove();
    // The keys stay in view; how to read them folds away, so the legend covers little of the map.
    let more: Sel<HTMLDetailsElement> | null = null;
    const note = (text: string): void => {
      if (more === null) {
        more = legend.append('details').attr('class', 'cv-legend-more').property('open', legendOpen);
        more.on('toggle', (event: Event) => (legendOpen = (event.currentTarget as HTMLDetailsElement).open));
        more.append('summary').text('Comment lire');
      }
      more.append('p').attr('class', 'cv-legend-note').text(text);
    };
    const unplaced = () => {
      const n = f.withoutCoordinates.world;
      if (n > 0 && mode !== 'none') note(`${plural(n, 'incident')} sans coordonnées sur la période : comptés dans les chiffres, absents de la carte.`);
    };
    const keyGrid = () => legend.append('div').attr('class', 'cv-legend-groups');
    const keyItem = (grid: Sel<HTMLDivElement>, mark: string, text: string): void => {
      const row = grid.append('span').attr('class', 'cv-legend-group').attr('title', text);
      row.append('span').attr('class', 'cv-legend-glyph').html(mark);
      row.append('span').attr('class', 'cv-legend-group-name').text(text);
    };
    const groupKeys = () => {
      const keys = legend.append('div').attr('class', 'cv-legend-groups');
      const colors = groupColors.colors;
      groupColors.names.forEach((name, slot) => {
        const row = keys.append('span').attr('class', 'cv-legend-group').attr('title', categoryLabel('group', name));
        row.append('span').attr('class', 'cv-swatch').style('background', colors[slot] ?? OTHER);
        row.append('span').attr('class', 'cv-legend-group-name').text(shortName(name));
      });
      for (const [slot, text] of [
        [groupColors.other, 'autres organisations'],
        [groupColors.unknown, 'auteur inconnu'],
      ] as const) {
        const row = keys.append('span').attr('class', 'cv-legend-group');
        row.append('span').attr('class', 'cv-swatch').style('background', colors[slot] ?? OTHER);
        row.append('span').attr('class', 'cv-legend-group-name').text(text);
      }
    };
    if (mode === 'groups') {
      legend.append('p').attr('class', 'cv-legend-title').text(`Qui frappe ? · ${formatRange(f.state.range)}`);
      groupKeys();
      legend.append('p').attr('class', 'cv-legend-line').text('Bulle : incidents du groupe · arc noir : part de suicides');
      note(`Teinte : organisation la plus active du lieu ; opacité : densité des ${weightUnit(f.metric)}. Bulle : ses incidents dans le pays, à leur centre ; arc noir : part d’attentats-suicides.`);
      note('Survolez une bulle pour le détail, cliquez-la pour ne garder que cette organisation. Zoomez pour voir chaque attentat.');
      unplaced();
      return;
    }
    if (mode === 'points') {
      legend.append('p').attr('class', 'cv-legend-title').text('Un symbole par attentat');
      const switcher = legend.append('div').attr('class', 'cv-legend-switch').attr('role', 'radiogroup').attr('aria-label', 'Couleur des symboles');
      switcher.append('span').text('Couleur :');
      for (const option of [
        { id: 'group', label: 'organisation' },
        { id: 'attack', label: 'type d’attaque' },
      ]) {
        const on = (option.id === 'attack') === byAttack;
        switcher
          .append('button')
          .attr('type', 'button')
          .attr('role', 'radio')
          .attr('aria-checked', String(on))
          .classed('is-active', on)
          .text(option.label)
          .on('click', () => store.set((s) => ({ ext: { ...s.ext, 'map.color': option.id } })));
      }
      if (byAttack) {
        const keys = legend.append('div').attr('class', 'cv-legend-row');
        for (const [type, color] of attackColors) {
          keys.append('span').attr('class', 'cv-swatch').style('background', color);
          keys.append('span').text(categoryLabel('attackType', type));
        }
        keys.append('span').attr('class', 'cv-swatch').style('background', palette.other);
        keys.append('span').text('autres et inconnu');
      } else {
        groupKeys();
      }
      legend.append('p').attr('class', 'cv-legend-label').text('Forme : l’arme');
      const shapes = keyGrid();
      for (const [weapon, glyph] of WEAPON_GLYPHS) keyItem(shapes, glyphSvg(glyph, '#5f5e5a'), categoryLabel('weaponType', weapon));
      keyItem(shapes, glyphSvg('cross', '#5f5e5a'), 'autre arme');
      keyItem(shapes, '<span class="cv-dot is-suicide"></span>', 'attentat-suicide');
      legend.append('p').attr('class', 'cv-legend-line').text('Taille : les morts');
      note('Taille : 0 ou inconnu, 10 morts, 100 morts et plus pour les plus grands symboles. Cliquez un symbole pour la fiche de l’attentat.');
      unplaced();
      return;
    }
    if (mode !== 'heat') return;
    const unit = weightUnit(f.metric);
    legend.append('p').attr('class', 'cv-legend-title').text(`Densité des ${unit} · ${formatRange(f.state.range)}`);
    const ramp = legend.append('div').attr('class', 'cv-ramp');
    ramp.append('div').attr('class', 'cv-ramp-bar').style('background', heatGradient());
    const ticks = ramp.append('div').attr('class', 'cv-ramp-ticks');
    ticks.append('span').style('left', '0%').text('faible');
    ticks.append('span').style('left', '100%').text('forte');
    if (heatMax > 0) {
      note(`Le point le plus chaud en vue concentre environ ${formatCount(Math.max(1, Math.round(heatMax)))} ${unit} dans un rayon d’environ ${Math.max(1, Math.round(km / 2))} km. Échelle logarithmique, relative à la vue.`);
    }
    legend.append('p').attr('class', 'cv-legend-line').text('Zoomez ou cliquez un pays : qui y frappe');
    unplaced();
  }

  function updateHint(f: Frame): void {
    const text =
      f.level === 'incident'
        ? 'Échap : fermer la fiche'
        : f.level === 'country'
          ? `Molette : zoomer jusqu’à chaque attentat · clic : ajouter ou retirer un pays (${MAX_SELECTION} au plus)`
          : 'Glissez pour tourner · molette pour zoomer · cliquez des pays pour les explorer et les comparer';
    hint.text(text).classed('is-hidden', hinted.has(f.level));
  }

  function markInteracted(): void {
    spinStopped = true;
    if (frame !== null) {
      hinted.add(frame.level);
      hint.classed('is-hidden', true);
    }
  }

  // ------------------------------------------------------------------ hit testing
  function countryAt(x: number, y: number): string | null {
    const radius = baseRadius(viewport) * camera.k;
    if (Math.hypot(x - viewport.width / 2, y - viewport.height / 2) > radius) return null;
    const geo = projectionFor(camera, viewport, false).invert?.([x, y]) ?? null;
    if (geo === null || !Number.isFinite(geo[0]) || !Number.isFinite(geo[1])) return null;
    for (const shape of pickable) {
      if (geoDistance(geo, shape.centre) > shape.radius + 1e-3) continue;
      if (geoContains(shape.feature, geo)) return shape.iso3;
    }
    return null;
  }

  function pointAt(x: number, y: number): number | null {
    if (mode !== 'points' || placed.n === 0) return null;
    if (points === null) {
      points = quadtree<number>()
        .x((n) => placed.xs[n] ?? 0)
        .y((n) => placed.ys[n] ?? 0)
        .addAll(Array.from({ length: placed.n }, (_, n) => n));
    }
    const found = points.find(x, y, 22);
    if (found === undefined) return null;
    const r = placed.rs[found] ?? 2;
    return Math.hypot((placed.xs[found] ?? 0) - x, (placed.ys[found] ?? 0) - y) <= Math.max(r + 2, 6) ? found : null;
  }

  function onHeat(x: number, y: number): boolean {
    return mode === 'heat' && heat.at(x, y) > 0.02;
  }

  function bubbleAt(x: number, y: number): Bubble | null {
    if (mode !== 'groups') return null;
    // Smallest last in the list: the one on top wins.
    for (let b = bubbles.length - 1; b >= 0; b--) {
      const bubble = bubbles[b];
      if (bubble !== undefined && Math.hypot(bubble.x - x, bubble.y - y) <= bubble.r + 4) return bubble;
    }
    return null;
  }

  function showBubbleTooltip(event: PointerEvent, f: Frame, b: Bubble): void {
    const weapons = [...b.weapons]
      .filter(([w]) => w !== 'Unknown')
      .sort((a, c) => c[1] - a[1])
      .slice(0, 3)
      .map(([w, count]) => `${categoryLabel('weaponType', w)} ${formatShare(count / b.incidents)}`);
    const chosen = (f.state.filters.group ?? []).includes(b.name);
    tooltip.show(event, `${categoryLabel('group', b.name)} · ${env.name(b.iso3)}`, [
      { text: `${plural(b.incidents, 'incident')} en vue · ${b.killedKnown > 0 ? plural(b.killed, 'mort') : 'morts inconnus'}`, strong: true, key: groupColors.colorOf(b.slot) },
      { text: b.suicide > 0 ? `Attentats-suicides : ${formatCount(b.suicide)} (${formatShare(b.suicide / b.incidents)})` : 'Aucun attentat-suicide' },
      { text: weapons.length > 0 ? `Armes : ${weapons.join(', ')}` : 'Armes inconnues' },
      { text: chosen ? 'Clic : retirer ce filtre' : 'Clic : ne montrer que cette organisation' },
    ]);
  }

  /** What the territories hold around the pointer: the incidents within one blur radius, by organization. */
  function showTerritoryTooltip(event: PointerEvent, f: Frame, x: number, y: number, under: string | null): boolean {
    if (mode !== 'groups' || !territories.covers(x, y)) return false;
    const r2 = TERRITORY_RADIUS * TERRITORY_RADIUS * 2.25;
    const byGroup = new Map<string, number>();
    let total = 0;
    let killed = 0;
    for (let m = 0; m < placed.n; m++) {
      const dx = (placed.xs[m] ?? 0) - x;
      const dy = (placed.ys[m] ?? 0) - y;
      if (dx * dx + dy * dy > r2) continue;
      const set = placed.sets[m];
      if (set === undefined) continue;
      const i = placed.index[m] ?? 0;
      const name = set.file.dictionaries.group[set.file.columns.group[i] ?? 0] ?? 'Unknown';
      byGroup.set(name, (byGroup.get(name) ?? 0) + 1);
      total++;
      killed += set.file.columns.killed[i] ?? 0;
    }
    if (total === 0) return false;
    const km = Math.round(3 * TERRITORY_RADIUS * kmPerPixel(camera, viewport));
    const lines: TooltipLine[] = [{ text: `${plural(total, 'incident')} · ${plural(killed, 'mort')}`, strong: true }];
    for (const [name, count] of [...byGroup].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
      lines.push({ text: `${name === 'Unknown' ? 'Auteur inconnu' : categoryLabel('group', name)} : ${formatShare(count / total)}` });
    }
    if (under !== null) lines.push({ text: `Clic : ${f.colors.has(under) ? 'retirer' : 'sélectionner'} ${env.name(under)}` });
    tooltip.show(event, `Zone d’environ ${km} km · ${formatRange(f.state.range)}`, lines);
    return true;
  }

  // ------------------------------------------------------------------ links (world level)
  function linksOf(f: Frame, iso3: string): Link[] {
    const c = model.countryOf(iso3);
    if (c < 0) return [];
    if (linkIndex === null) {
      const countryCount = model.countryCodes.length;
      const byCountry = new Map<number, Map<number, number>>();
      const byGroup = new Map<number, Map<number, number>>();
      for (const [key, totals] of f.scan.groupCountry) {
        const g = Math.floor(key / countryCount);
        const country = key % countryCount;
        if (totals.incidents === 0 || !isNamedGroup(model.dict.group[g] ?? '')) continue;
        if (!byCountry.has(country)) byCountry.set(country, new Map());
        byCountry.get(country)?.set(g, totals.incidents);
        if (!byGroup.has(g)) byGroup.set(g, new Map());
        byGroup.get(g)?.set(country, totals.incidents);
      }
      linkIndex = { byCountry, byGroup };
    }
    const weights = new Map<number, { weight: number; groups: string[] }>();
    for (const [g] of linkIndex.byCountry.get(c) ?? []) {
      for (const [other, incidents] of linkIndex.byGroup.get(g) ?? []) {
        const code = model.countryCodes[other] ?? '';
        if (other === c || code === '' || !places.has(code)) continue;
        const entry = weights.get(other) ?? { weight: 0, groups: [] };
        entry.weight += incidents;
        entry.groups.push(model.dict.group[g] ?? '');
        weights.set(other, entry);
      }
    }
    return [...weights]
      .sort((a, b) => b[1].weight - a[1].weight)
      .slice(0, LINKS_SHOWN)
      .map(([other, entry]) => ({ to: model.countryCodes[other] ?? '', weight: entry.weight, groups: entry.groups }));
  }

  // ------------------------------------------------------------------ tooltips
  function countryLines(f: Frame, iso3: string): TooltipLine[] {
    const c = model.countryOf(iso3);
    const totals = model.totals(f.table, c < 0 ? [] : [c], f.state.range);
    const value = f.values.get(iso3) ?? Number.NaN;
    const rank = f.ranking.rank.get(iso3);
    const lines: TooltipLine[] = [{ text: f.display.withUnit(value), strong: true }];
    const people = env.population?.mean(iso3, f.state.range) ?? Number.NaN;
    if (f.display.perCapita) {
      const raw = metricOf(totals, f.metric, f.covered);
      lines.push({ text: Number.isNaN(people) ? 'Population inconnue (Banque mondiale)' : `soit ${formatWithUnit(raw, f.metric)} pour ${formatPopulation(people)} d’habitants` });
    }
    if (rank !== undefined) {
      const before = f.compare === null ? undefined : f.compareRanking?.rank.get(iso3);
      const was = f.compare === null ? '' : before === undefined ? ` · hors classement en ${formatRange(f.compare)}` : ` · ${ordinal(before)} en ${formatRange(f.compare)}`;
      lines.push({ text: `${ordinal(rank)} sur ${f.ranking.ordered.length} pays${was}` });
    } else if (totals.incidents === 0 && f.covered) {
      lines.push({ text: f.filtered ? 'Aucun incident avec les filtres actifs' : 'Aucun incident enregistré sur la période' });
    } else if (f.metric.kind === 'mean' && totals.incidents > 0) {
      lines.push({ text: `Moins de 10 incidents : pas classé (${plural(totals.incidents, 'incident')})` });
    } else if (f.display.perCapita && people < MIN_POPULATION_FOR_RATE) {
      lines.push({ text: 'Moins d’un million d’habitants : pas classé' });
    }
    if (f.metric.kind !== 'count' && totals.incidents > 0) {
      lines.push({ text: `${plural(totals.incidents, 'incident')} · valeur connue pour ${formatShare(knownShareOf(totals, f.metric))}` });
    }
    if (f.selected.length === 0) {
      const links = linksOf(f, iso3);
      if (links.length > 0) {
        const names = links.slice(0, 3).map((l) => env.name(l.to));
        const more = links.length > 3 ? ` et ${links.length - 3} autre(s)` : '';
        lines.push({ text: `Ses organisations agissent aussi en : ${names.join(', ')}${more}` });
      }
    }
    lines.push({
      text: f.colors.has(iso3)
        ? 'Clic : retirer de la sélection · double-clic : zoomer'
        : f.selected.length >= MAX_SELECTION
          ? `Sélection complète (${MAX_SELECTION} pays) : retirez-en un`
          : 'Clic : ajouter à la sélection · double-clic : zoomer',
    });
    return lines;
  }

  function showCountryTooltip(event: PointerEvent, f: Frame, iso3: string): void {
    const region = env.region(iso3);
    tooltip.show(event, region === '' ? env.name(iso3) : `${env.name(iso3)} · ${region}`, countryLines(f, iso3));
  }

  function showPointTooltip(event: PointerEvent, f: Frame, n: number): void {
    const set = placed.sets[n];
    const i = placed.index[n] ?? 0;
    if (set === undefined) return;
    const c = set.file.columns;
    const killed = c.killed[i];
    const wounded = c.wounded[i];
    const place = [c.city[i], env.name(set.iso3)].filter((v) => v != null && v !== '').join(', ');
    tooltip.show(event, `${incidentDate(c.year[i] ?? 0, c.month[i], c.day[i])} · ${place}`, [
      {
        text: `${killed == null ? 'morts inconnus' : plural(killed, 'mort')} · ${wounded == null ? 'blessés inconnus' : plural(wounded, 'blessé')}`,
        strong: true,
        key: f.colors.get(set.iso3),
      },
      { text: `${categoryLabel('attackType', incidentCategory(set, 'attackType', i))} contre ${categoryLabel('targetType', incidentCategory(set, 'targetType', i)).toLowerCase()}` },
      { text: categoryLabel('group', incidentCategory(set, 'group', i)) },
      { text: 'Clic : ouvrir la fiche' },
    ]);
  }

  /** What the heat sums around the pointer: the incidents within one blur radius. */
  function showHeatTooltip(event: PointerEvent, f: Frame, x: number, y: number, under: string | null): boolean {
    const c = cells;
    if (c === null) return false;
    const totals = emptyTotals();
    const cityCounts = new Map<string, number>();
    const r2 = HEAT_RADIUS * HEAT_RADIUS;
    for (let m = 0; m < inView.n; m++) {
      const dx = (inView.xs[m] ?? 0) - x;
      const dy = (inView.ys[m] ?? 0) - y;
      if (dx * dx + dy * dy > r2) continue;
      const i = inView.idx[m] ?? 0;
      totals.incidents += c.incidents[i] ?? 0;
      totals.killedSum += c.killedSum[i] ?? 0;
      totals.killedKnown += c.killedKnown[i] ?? 0;
      totals.woundedSum += c.woundedSum[i] ?? 0;
      totals.woundedKnown += c.woundedKnown[i] ?? 0;
      const city = c.city[i];
      if (city != null && city !== '' && city !== 'Unknown') cityCounts.set(city, (cityCounts.get(city) ?? 0) + (c.incidents[i] ?? 0));
    }
    if (totals.incidents === 0) return false;
    const [top] = [...cityCounts].sort((a, b) => b[1] - a[1]);
    const km = Math.round(2 * HEAT_RADIUS * kmPerPixel(camera, viewport));
    const value = metricOf(totals, f.metric, true);
    const lines: TooltipLine[] = [{ text: f.metric.kind === 'count' ? plural(totals.incidents, 'incident') : `${formatWithUnit(value, f.metric)} · ${plural(totals.incidents, 'incident')}`, strong: true }];
    if (top !== undefined) lines.push({ text: `Surtout à ${top[0]} (${plural(top[1], 'incident')})` });
    lines.push({
      text: under === null ? 'Double-clic : zoomer sur cette zone' : `Clic : ${f.colors.has(under) ? 'retirer' : 'sélectionner'} ${env.name(under)} · double-clic : zoomer`,
    });
    tooltip.show(event, `Zone d’environ ${km} km · ${formatRange(f.state.range)}`, lines);
    return true;
  }

  // ------------------------------------------------------------------ pointer and keyboard
  const pointers = new Map<number, [number, number]>();
  let press: { x: number; y: number; moved: boolean } | null = null;
  let pinch: number | null = null;

  const local = (event: { clientX: number; clientY: number }): [number, number] => {
    const box = canvas.node()?.getBoundingClientRect();
    return box === undefined ? [0, 0] : [event.clientX - box.left, event.clientY - box.top];
  };

  function setHover(iso3: string | null): void {
    if (iso3 === hovered) return;
    hovered = iso3;
    const current = store.get().hover;
    if (iso3 === null ? current !== null : current?.id !== iso3) store.set({ hover: iso3 === null ? null : { dim: 'country', id: iso3 } });
    requestDraw();
  }

  function onHover(event: PointerEvent): void {
    const f = frame;
    if (f === null) return;
    const [x, y] = local(event);
    const n = pointAt(x, y);
    canvas.classed('is-pointing', false);
    if (n !== null) {
      canvas.classed('is-pointing', true);
      setHover(null);
      showPointTooltip(event, f, n);
      return;
    }
    const bubble = bubbleAt(x, y);
    if (bubble !== null) {
      canvas.classed('is-pointing', true);
      setHover(null);
      showBubbleTooltip(event, f, bubble);
      return;
    }
    if (mode === 'groups') {
      const under = countryAt(x, y);
      if (showTerritoryTooltip(event, f, x, y, under)) {
        canvas.classed('is-pointing', under !== null);
        setHover(under);
        return;
      }
    }
    if (onHeat(x, y)) {
      const under = countryAt(x, y);
      if (showHeatTooltip(event, f, x, y, under)) {
        canvas.classed('is-pointing', true);
        setHover(under);
        return;
      }
    }
    const iso3 = countryAt(x, y);
    setHover(iso3);
    if (iso3 === null) tooltip.hide();
    else {
      canvas.classed('is-pointing', true);
      showCountryTooltip(event, f, iso3);
    }
  }

  function say(text: string): void {
    status.text(text).classed('is-visible', true).classed('is-error', false);
    if (flash !== null) win?.clearTimeout(flash);
    flash = win?.setTimeout(() => {
      flash = null;
      if (frame !== null) updateStatus();
    }, 2600) ?? null;
  }

  /** The incidents of the placed points that lie inside the view (the placement keeps a margin around it). */
  function visibleSpots(): Spot[] {
    const spots: Spot[] = [];
    for (let n = 0; n < placed.n; n++) {
      const x = placed.xs[n] ?? 0;
      const y = placed.ys[n] ?? 0;
      if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) continue;
      const id = placed.sets[n]?.file.columns.eventId[placed.index[n] ?? 0];
      if (id !== undefined) spots.push({ id, x, y });
    }
    return spots;
  }

  /**
   * An arrow key moves the open incident to its neighbour in the view (neighbour.ts), whatever the
   * pointer can reach; with none open, it opens the incident nearest to the centre. The camera only
   * moves when the incident ends up near an edge, and then by the distance that brings it back.
   */
  function stepIncident(direction: Direction, leavePile: boolean): void {
    const f = frame;
    if (f === null) return;
    if (mode !== 'points') {
      say('Zoomez jusqu’aux attentats pour passer de l’un à l’autre avec les flèches.');
      return;
    }
    const spots = visibleSpots();
    const open = f.state.incident;
    const target = open !== null && spots.some((s) => s.id === open) ? neighbour(spots, open, direction, leavePile) : nearestTo(spots, viewport.width / 2, viewport.height / 2);
    if (target === null) {
      const side = { left: 'à gauche', right: 'à droite', up: 'au-dessus', down: 'en dessous' }[direction];
      say(spots.length === 0 ? 'Aucun attentat dans la vue.' : `Aucun autre attentat ${side} dans la vue.`);
      return;
    }
    // The move is made here, not by syncCamera, which would fly to the incident at a deep zoom.
    targetKey = `${f.selected.join(',')}|${target.id}`;
    store.set({ incident: target.id });
    const pile = spots.filter((s) => Math.hypot(s.x - target.x, s.y - target.y) <= PILE_PX);
    if (pile.length > 1) say(`${pile.filter((s) => compareIds(s.id, target.id) <= 0).length} sur ${pile.length} au même endroit, du plus ancien au plus récent.`);
    const mx = Math.min(140, viewport.width * 0.18);
    const my = Math.min(90, viewport.height * 0.18);
    const shift = (v: number, size: number, margin: number) => (v < margin ? margin - v : v > size - margin ? size - margin - v : 0);
    const sx = shift(target.x, viewport.width, mx);
    const sy = shift(target.y, viewport.height, my);
    if (sx !== 0 || sy !== 0) flyTo(rotateBy(camera, viewport, sx, sy));
  }

  function onClick(x: number, y: number): void {
    const f = frame;
    if (f === null) return;
    const n = pointAt(x, y);
    if (n !== null) {
      const set = placed.sets[n];
      const id = set?.file.columns.eventId[placed.index[n] ?? 0];
      if (id !== undefined) store.set({ incident: id });
      return;
    }
    const bubble = bubbleAt(x, y);
    if (bubble !== null) {
      toggleGroup(bubble.name);
      return;
    }
    // A click on the heat selects the country under it, like a click on the country.
    const iso3 = countryAt(x, y);
    if (iso3 === null) return;
    // The second click of a double-click belongs to the zoom, not to the selection.
    const t = now();
    if (lastClick !== null && lastClick.iso3 === iso3 && t - lastClick.at < 350) return;
    lastClick = { iso3, at: t };
    if (!toggleCountry(store, iso3)) say(`${MAX_SELECTION} pays au plus : retirez-en un pour en ajouter un autre.`);
  }

  /** Double-click on a country: frame it (and keep it selected); elsewhere, zoom in. */
  function onDoubleClick(x: number, y: number): void {
    const iso3 = countryAt(x, y);
    const place = iso3 === null ? undefined : places.get(iso3);
    if (iso3 === null || place === undefined) {
      zoomBy(2, [x, y]);
      return;
    }
    markInteracted();
    if (!selectedOf(store.get()).includes(iso3)) toggleCountry(store, iso3);
    // Already inside the country: keep zooming where the pointer is.
    const fit = fitCamera(place.main, viewport);
    if (camera.k >= fit.k * 0.9) zoomBy(2, [x, y]);
    else flyTo(fit);
  }

  /** Keeps only this organization everywhere, or removes it from the filter. */
  function toggleGroup(name: string): void {
    store.set((s) => {
      const current = s.filters.group ?? [];
      return { filters: { ...s.filters, group: current.includes(name) ? current.filter((v) => v !== name) : [...current, name] } };
    });
  }

  function zoomBy(factor: number, at?: [number, number]): void {
    markInteracted();
    framed = false;
    const point = at ?? [viewport.width / 2, viewport.height / 2];
    camera = zoomAround(camera, viewport, point, factor);
    active = null;
    if (wheeling !== null) win?.clearTimeout(wheeling);
    wheeling = win?.setTimeout(() => {
      wheeling = null;
      requestDraw();
    }, 160) ?? null;
    requestDraw();
  }

  canvas
    .on('pointerdown', (event: PointerEvent) => {
      const element = canvas.node();
      element?.setPointerCapture?.(event.pointerId);
      pointers.set(event.pointerId, local(event));
      press = { x: event.clientX, y: event.clientY, moved: false };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = a !== undefined && b !== undefined ? Math.hypot(a[0] - b[0], a[1] - b[1]) : null;
      }
      markInteracted();
    })
    .on('pointermove', (event: PointerEvent) => {
      pointerInside = true;
      const previous = pointers.get(event.pointerId);
      if (previous === undefined) {
        onHover(event);
        return;
      }
      const position = local(event);
      pointers.set(event.pointerId, position);
      if (pointers.size === 2 && pinch !== null) {
        const [a, b] = [...pointers.values()];
        if (a !== undefined && b !== undefined) {
          const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
          zoomBy(distance / pinch, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
          pinch = distance;
        }
        return;
      }
      if (press !== null && !press.moved && Math.hypot(event.clientX - press.x, event.clientY - press.y) < 4) return;
      if (press !== null) press.moved = true;
      dragging = true;
      framed = false;
      active = null;
      tooltip.hide();
      canvas.classed('is-dragging', true);
      camera = rotateBy(camera, viewport, position[0] - previous[0], position[1] - previous[1]);
      requestDraw();
    })
    .on('pointerup pointercancel', (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      const wasClick = press !== null && !press.moved && event.type === 'pointerup' && pointers.size === 0;
      if (pointers.size === 0) {
        press = null;
        dragging = false;
        canvas.classed('is-dragging', false);
        requestDraw();
      }
      if (wasClick) {
        const [x, y] = local(event);
        onClick(x, y);
      }
    })
    .on('pointerleave', () => {
      pointerInside = false;
      tooltip.hide();
      setHover(null);
      requestDraw();
    })
    .on('dblclick', (event: MouseEvent) => {
      event.preventDefault();
      const [x, y] = local(event);
      onDoubleClick(x, y);
    })
    .on('keydown', (event: KeyboardEvent) => {
      // The arrows walk from incident to incident; the globe is turned with the pointer.
      const arrow = ARROWS[event.key];
      if (arrow !== undefined) {
        event.preventDefault();
        markInteracted();
        stepIncident(arrow, event.shiftKey);
        requestDraw();
        return;
      }
      const keys: Record<string, () => void> = {
        '+': () => zoomBy(1.6),
        '=': () => zoomBy(1.6),
        '-': () => zoomBy(1 / 1.6),
        Enter: () => {
          const iso3 = countryAt(viewport.width / 2, viewport.height / 2);
          if (iso3 !== null && !toggleCountry(store, iso3)) say(`${MAX_SELECTION} pays au plus.`);
        },
      };
      const action = keys[event.key];
      if (action === undefined) return;
      event.preventDefault();
      markInteracted();
      framed = false;
      active = null;
      action();
      requestDraw();
    });
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    tooltip.hide();
    const scale = event.deltaMode === 1 ? 0.05 : event.deltaMode === 2 ? 1 : 0.0022;
    zoomBy(Math.exp(-event.deltaY * scale), local(event));
  };
  canvas.node()?.addEventListener('wheel', onWheel, { passive: false });

  // ------------------------------------------------------------------ update
  function update(next: Frame): void {
    const previous = frame;
    frame = next;
    baseVersion++;
    // A new period or filter cross-fades the incidents (not the first frame, not without motion).
    const key = `${next.state.range.from}-${next.state.range.to}|${filtersKey(next.filters)}|${next.metric.id}`;
    const element = canvas.node();
    if (key !== incidentKey && previous !== null && !reducedMotion && mode !== 'none' && element != null && element.width > 0) {
      fadeCanvas.width = element.width;
      fadeCanvas.height = element.height;
      fadeCanvas.getContext?.('2d')?.drawImage(element, 0, 0);
      fadeStart = now();
      fadeCamera = cameraKey(element);
    }
    incidentKey = key;
    if (previous === null || previous.scan !== next.scan) linkIndex = null;

    const fills = computeFills(next);
    const changed = [...fills].some(([iso3, fill]) => targetFills.get(iso3) !== fill);
    if (changed) {
      const u = easeOut(Math.min(1, (now() - tweenStart) / COLOR_TWEEN_MS));
      fromFills = new Map(env.drawable.map((iso3) => [iso3, fillAt(iso3, u)]));
      targetFills = fills;
      tweenStart = previous === null || reducedMotion ? -Infinity : now();
    }

    clearButton
      .attr('hidden', next.selected.length === 0 ? '' : null)
      .html(iconLabel('close', next.selected.length > 1 ? `Tout désélectionner (${next.selected.length})` : 'Désélectionner'));
    updateStatus();
    canvas.attr('aria-label', describe(next));
    updateHint(next);
    syncCamera(next, previous === null);
    requestDraw();
  }

  function updateStatus(): void {
    if (flash !== null) return;
    const wanted = env.drawable;
    const failed = wanted.filter((iso3) => files.error(iso3) !== undefined);
    const done = wanted.filter((iso3) => files.get(iso3) !== undefined || files.error(iso3) !== undefined).length;
    const loading = done < wanted.length;
    const text = loading
      ? `Chargement des attentats : ${done} pays sur ${wanted.length}…`
      : failed.length > 0 && failed.length <= 3
        ? `Incidents indisponibles : ${failed.map((iso3) => env.name(iso3)).join(', ')}`
        : failed.length > 3
          ? `Incidents indisponibles pour ${failed.length} pays`
          : '';
    status.classed('is-visible', text !== '').classed('is-error', !loading && failed.length > 0).text(text);
  }

  function describe(f: Frame): string {
    const period = formatRange(f.state.range);
    const top = f.ranking.ordered.slice(0, 3).map((iso3) => `${env.name(iso3)} (${f.display.withUnit(f.values.get(iso3) ?? Number.NaN)})`);
    const what = mode === 'points' ? 'attentats un par un, par organisation et par arme' : mode === 'groups' ? 'territoires des organisations' : 'attentats en carte de chaleur';
    const selection = f.selected.length > 0 ? ` Pays sélectionnés : ${f.selected.map((iso3) => env.name(iso3)).join(', ')}.` : '';
    return `Globe : ${what}, ${period}. Les plus touchés : ${top.join(', ')}.${selection}`;
  }

  return {
    update,
    highlight(ref) {
      const iso3 = ref?.dim === 'country' ? ref.id : null;
      const group = ref?.dim === 'group' ? ref.id : null;
      if (iso3 === external && group === externalGroup) return;
      external = iso3;
      externalGroup = group;
      requestDraw();
    },
    previewIncident(eventId) {
      if (eventId === previewed) return;
      previewed = eventId;
      requestDraw();
    },
    destroy() {
      loop?.stop();
      loop = null;
      if (wheeling !== null) win?.clearTimeout(wheeling);
      if (flash !== null) win?.clearTimeout(flash);
      resize?.disconnect();
      canvas.node()?.removeEventListener('wheel', onWheel);
      canvas.on('.', null);
    },
  };
}

/** Position of a value on the colour ramp: log1p for counts, four decades of log10 for rates. */
export function rampPosition(v: number, max: number, rate: boolean): number {
  if (!(max > 0) || !(v > 0)) return 0;
  if (!rate) return Math.min(1, Math.log1p(v) / Math.log1p(max));
  return Math.min(1, Math.max(0, (Math.log10(v) - Math.log10(max)) / RATE_DECADES + 1));
}

/** "39,3 millions", "850 000". */
function formatPopulation(n: number): string {
  return n >= 1e6 ? `${formatRate(n / 1e6)} millions` : formatCount(Math.round(n));
}

/** An organization's name short enough for a label on the map: its acronym when it has one. */
function shortName(name: string): string {
  const acronym = /\(([^()]{2,12})\)\s*$/.exec(name)?.[1];
  if (acronym !== undefined) return acronym;
  return name.length > 26 ? `${name.slice(0, 25)}…` : name;
}

function pointRadius(killed: number | null): number {
  return killed === null || killed <= 0 ? 2.2 : Math.min(18, 2.2 + 1.3 * Math.sqrt(killed));
}

function buildLayer(atlas: CountryAtlas): Layer {
  const shapes: Shape[] = [
    ...atlas.countries.map((feature) => shapeOf(feature.properties.iso3, feature)),
    ...atlas.uncoded.map((feature) => shapeOf(null, feature)),
  ];
  const objects = atlas.topology.objects.countries;
  const borders = mesh(atlas.topology, objects, (a, b) => a !== b).coordinates.map((coordinates): Border => {
    const line: LineString = { type: 'LineString', coordinates };
    const centre = geoCentroid(line) as [number, number];
    let radius = 0;
    for (const vertex of coordinates) radius = Math.max(radius, geoDistance(centre, vertex as [number, number]));
    return { line, centre, radius };
  });
  return { shapes, borders, outlined: [] };
}

/** The simplified countries, plus the detailed shapes of the small countries they leave out (Bahrain, Malta…). */
function hybridLayer(atlas: CountryAtlas, detail: Layer): Layer {
  const base = buildLayer(atlas);
  const present = new Set(atlas.countries.map((c) => c.properties.iso3));
  const extras = detail.shapes.filter((s) => s.iso3 !== null && !present.has(s.iso3));
  return { shapes: [...base.shapes, ...extras], borders: base.borders, outlined: extras };
}

function shapeOf(iso3: string | null, feature: Feature<Polygon | MultiPolygon>): Shape {
  const centre = geoCentroid(feature) as [number, number];
  let radius = 0;
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  for (const polygon of polygons) {
    for (const vertex of polygon[0] ?? []) {
      const d = geoDistance(centre, vertex as [number, number]);
      if (d > radius) radius = d;
    }
  }
  return { iso3, feature, centre, radius };
}

function largestPolygon(feature: Feature<Polygon | MultiPolygon>): Feature<Polygon> {
  if (feature.geometry.type === 'Polygon') return feature as Feature<Polygon>;
  let best: Feature<Polygon> | null = null;
  let bestArea = -1;
  for (const coordinates of feature.geometry.coordinates) {
    const part: Feature<Polygon> = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } };
    const area = geoArea(part);
    if (area > bestArea) {
      bestArea = area;
      best = part;
    }
  }
  return best ?? (feature as unknown as Feature<Polygon>);
}
