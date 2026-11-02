import { geoCentroid, geoDistance, geoInterpolate, geoOrthographic, geoPath, type GeoPermissibleObjects, type GeoProjection } from 'd3';

/**
 * The camera of the globe: the geographic point at the centre of the view and a zoom factor
 * (k = 1 shows the whole globe). Everything the globe draws derives from it, so a flight between
 * two places is an interpolation between two cameras.
 */
export interface Camera {
  /** Longitude of the centre, degrees. */
  readonly lambda: number;
  /** Latitude of the centre, degrees. */
  readonly phi: number;
  readonly k: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export const MIN_K = 0.85;
export const MAX_K = 220;
const MAX_TILT = 85;
const RAD = Math.PI / 180;
/** Mean Earth radius, to turn screen distances into kilometres. */
export const EARTH_KM = 6371;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const wrap = (lambda: number): number => ((((lambda + 180) % 360) + 360) % 360) - 180;

/** Radius of the whole globe at k = 1: it fits the view with a margin for the shadow and labels. */
export function baseRadius(v: Viewport): number {
  return Math.max(1, Math.min(v.width, v.height) * 0.48);
}

export function clampCamera(c: Camera): Camera {
  return { lambda: wrap(c.lambda), phi: clamp(c.phi, -MAX_TILT, MAX_TILT), k: clamp(c.k, MIN_K, MAX_K) };
}

/**
 * The d3 projection of a camera. Drawing is clipped to the hemisphere facing the viewer and to the
 * view, so a deep zoom only rasterizes what is on screen.
 */
export function projectionFor(c: Camera, v: Viewport, clipToView = true): GeoProjection {
  const projection = geoOrthographic()
    .rotate([-c.lambda, -c.phi, 0])
    .scale(baseRadius(v) * c.k)
    .translate([v.width / 2, v.height / 2])
    .precision(c.k > 6 ? 0.2 : 0.6);
  // The whole globe is in view below k = 1.2: clipping to the view would only cost time. Zoomed in,
  // a small circle around the view clips first, so a large country (Russia) reaches the rectangle
  // clip already cut down to what is near the screen.
  if (!clipToView || c.k <= 1.2) return projection;
  return projection.clipAngle(Math.min(90, (viewRadius(c, v) * 180) / Math.PI + 2)).clipExtent([
    [-4, -4],
    [v.width + 4, v.height + 4],
  ]);
}

/**
 * The same projection without any clipping or resampling, for shapes entirely on the visible
 * hemisphere: clipping a polygon to the horizon costs more than drawing it, and most shapes in view
 * never touch the horizon.
 */
export function frontProjection(c: Camera, v: Viewport): GeoProjection {
  return geoOrthographic()
    .rotate([-c.lambda, -c.phi, 0])
    .scale(baseRadius(v) * c.k)
    .translate([v.width / 2, v.height / 2])
    .preclip((stream) => stream)
    .precision(0);
}

/** True when a bounding circle (centre, angular radius) lies entirely on the visible hemisphere. */
export function onFrontSide(c: Camera, centre: [number, number], radius: number): boolean {
  return geoDistance([c.lambda, c.phi], centre) + radius < Math.PI / 2 - 0.01;
}

/** Kilometres per screen pixel at the centre of the view. */
export function kmPerPixel(c: Camera, v: Viewport): number {
  return EARTH_KM / (baseRadius(v) * c.k);
}

/**
 * Angular radius (radians) of the part of the globe that can appear in the view: the visible
 * hemisphere when zoomed out, less when the view only shows a region.
 */
export function viewRadius(c: Camera, v: Viewport): number {
  const half = Math.hypot(v.width, v.height) / 2 / (baseRadius(v) * c.k);
  return half >= 1 ? Math.PI / 2 : Math.asin(half);
}

/**
 * Projects many points per frame with the orthographic formulas of d3 (same rotation convention),
 * from precomputed sines and cosines: a point costs a few multiplications and no trigonometry.
 */
export class PointProjector {
  private readonly cosL0: number;
  private readonly sinL0: number;
  private readonly cosP0: number;
  private readonly sinP0: number;
  private readonly r: number;
  private readonly cx: number;
  private readonly cy: number;

  constructor(c: Camera, v: Viewport) {
    this.cosL0 = Math.cos(c.lambda * RAD);
    this.sinL0 = Math.sin(c.lambda * RAD);
    this.cosP0 = Math.cos(c.phi * RAD);
    this.sinP0 = Math.sin(c.phi * RAD);
    this.r = baseRadius(v) * c.k;
    this.cx = v.width / 2;
    this.cy = v.height / 2;
  }

  /** Writes the screen position of a point into `out`; false on the far side of the globe. */
  project(cosLat: number, sinLat: number, cosLon: number, sinLon: number, out: [number, number]): boolean {
    const cosDl = cosLon * this.cosL0 + sinLon * this.sinL0;
    const sinDl = sinLon * this.cosL0 - cosLon * this.sinL0;
    if (this.sinP0 * sinLat + this.cosP0 * cosLat * cosDl < 0) return false;
    out[0] = this.cx + this.r * cosLat * sinDl;
    out[1] = this.cy - this.r * (this.cosP0 * sinLat - this.sinP0 * cosLat * cosDl);
    return true;
  }
}

/**
 * The camera that frames some geography (the main polygon of one or two countries) in the view,
 * centred on its on-screen bounding box rather than on its centroid.
 */
export function fitCamera(object: GeoPermissibleObjects, v: Viewport, margin = 0.74, maxK = 60): Camera {
  const [lambda, phi] = geoCentroid(object);
  let probe = projectionFor({ lambda, phi, k: 1 }, v, false);
  let [[x0, y0], [x1, y1]] = geoPath(probe).bounds(object);
  const centre = probe.invert?.([(x0 + x1) / 2, (y0 + y1) / 2]) ?? null;
  const at = centre !== null && Number.isFinite(centre[0]) ? { lambda: centre[0], phi: centre[1] } : { lambda, phi };
  probe = projectionFor({ ...at, k: 1 }, v, false);
  [[x0, y0], [x1, y1]] = geoPath(probe).bounds(object);
  const w = x1 - x0;
  const h = y1 - y0;
  const k = w > 0 && h > 0 ? Math.min((v.width * margin) / w, (v.height * margin) / h) : maxK / 2;
  return clampCamera({ ...at, k: clamp(k, 1, maxK) });
}

/** Rotation under a drag: the globe follows the pointer, and pans at a deep zoom. */
export function rotateBy(c: Camera, v: Viewport, dx: number, dy: number): Camera {
  const degPerPx = 180 / (Math.PI * baseRadius(v) * c.k);
  const shrink = Math.max(0.2, Math.cos(c.phi * RAD));
  return clampCamera({ lambda: c.lambda - (dx * degPerPx) / shrink, phi: c.phi + dy * degPerPx, k: c.k });
}

/** Zoom by a factor around a screen point, which stays (nearly) under the pointer. */
export function zoomAround(c: Camera, v: Viewport, point: readonly [number, number], factor: number): Camera {
  const k = clamp(c.k * factor, MIN_K, MAX_K);
  const geo = projectionFor(c, v, false).invert?.([point[0], point[1]]) ?? null;
  if (geo === null || !Number.isFinite(geo[0]) || !Number.isFinite(geo[1])) return clampCamera({ ...c, k });
  const [lambda, phi] = geoInterpolate([c.lambda, c.phi], geo)(1 - c.k / k);
  return clampCamera({ lambda, phi, k });
}

export interface Flight {
  readonly duration: number;
  at(t: number): Camera;
}

/**
 * A camera move: the centre travels along the great circle while the zoom is interpolated in log
 * space. A long trip at a deep zoom first rises, so the viewer sees where they are going (van Wijk).
 */
export function flight(from: Camera, to: Camera): Flight {
  const a: [number, number] = [from.lambda, from.phi];
  const b: [number, number] = [to.lambda, to.phi];
  const path = geoInterpolate(a, b);
  const distance = geoDistance(a, b);
  const la = Math.log(from.k);
  const lb = Math.log(to.k);
  const lowest = Math.log(clamp(1.2 / Math.max(distance, 1e-3), 1, MAX_K));
  const dip = lowest < Math.min(la, lb) - 0.05;
  // Quadratic Bézier in log zoom whose midpoint is `lowest`.
  const control = 2 * lowest - (la + lb) / 2;
  const logK = (t: number) => (dip ? (1 - t) * (1 - t) * la + 2 * t * (1 - t) * control + t * t * lb : la + (lb - la) * t);
  const duration = clamp(650 + 520 * (distance / Math.PI) + 90 * Math.abs(la - lb) + (dip ? 250 : 0), 450, 1700);
  return {
    duration,
    at(t) {
      const [lambda, phi] = path(t);
      return clampCamera({ lambda, phi, k: Math.exp(logK(t)) });
    },
  };
}

/** Out-quart: the move answers the click at once and lands softly. */
export function easeOut(t: number): number {
  return 1 - (1 - t) ** 4;
}
