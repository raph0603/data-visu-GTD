/**
 * Heat layer of the incidents, in the manner of Snap Map: the weights are summed on a coarse screen
 * grid, blurred by a gaussian (three box blurs), then coloured through a ramp whose opacity rises
 * with the density. The blur radius is fixed on screen, so zooming in separates the hot spots.
 */

/** Colour stops of the ramp: cold and transparent at low density, hot and opaque at the peak. */
export const HEAT_STOPS: readonly (readonly [number, string, number])[] = [
  [0, '#4f7cff', 0],
  [0.1, '#4f7cff', 0.28],
  [0.3, '#2ec5ff', 0.55],
  [0.52, '#5bd66b', 0.74],
  [0.7, '#ffe03a', 0.84],
  [0.85, '#ff9a1f', 0.9],
  [1, '#ef3b2c', 0.95],
];

/** The ramp as a CSS gradient, for the legend. */
export function heatGradient(): string {
  const stops = HEAT_STOPS.map(([t, hex, a]) => {
    const [r, g, b] = rgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${Math.max(a, 0.15)}) ${Math.round(t * 100)}%`;
  });
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/**
 * Densities under this many isolated incidents' peaks stay transparent: the tails of the blur and
 * the scattered incidents, so that the heat marks where attacks gather, not every place one happened.
 */
const CUTOFF = 1.5;

export class HeatField {
  /** Grid step in CSS pixels. */
  readonly cell: number;
  /** Blur radius in CSS pixels (about two standard deviations). */
  readonly radius: number;
  private width = 0;
  private height = 0;
  private grid = new Float32Array(0);
  private tmp = new Float32Array(0);
  private unit = 1;
  private top = 0;
  private readonly lut = buildLut();
  private readonly canvas: HTMLCanvasElement;
  private image: ImageData | null = null;

  constructor(doc: Document, cell: number, radius: number) {
    this.cell = cell;
    this.radius = radius;
    this.canvas = doc.createElement('canvas');
  }

  /** Largest density in view, in weight units per blob (one isolated incident of weight 1 is 1). */
  get max(): number {
    return this.top / this.unit;
  }

  /**
   * Sums the weights of the projected positions, blurs them and paints the result over `context`
   * (whose transform maps CSS pixels). Returns false when nothing was painted.
   */
  draw(context: CanvasRenderingContext2D, xs: Float64Array, ys: Float64Array, weight: (m: number) => number, n: number, width: number, height: number): boolean {
    const gw = Math.max(1, Math.ceil(width / this.cell));
    const gh = Math.max(1, Math.ceil(height / this.cell));
    if (this.width !== gw || this.height !== gh) {
      this.width = gw;
      this.height = gh;
      this.grid = new Float32Array(gw * gh);
      this.tmp = new Float32Array(gw * gh);
      this.canvas.width = gw;
      this.canvas.height = gh;
      this.image = null;
    } else {
      this.grid.fill(0);
    }
    const grid = this.grid;
    let any = false;
    for (let m = 0; m < n; m++) {
      const w = weight(m);
      if (!(w > 0)) continue;
      const gx = Math.floor((xs[m] ?? 0) / this.cell);
      const gy = Math.floor((ys[m] ?? 0) / this.cell);
      if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) continue;
      grid[gy * gw + gx] = (grid[gy * gw + gx] ?? 0) + w;
      any = true;
    }
    this.top = 0;
    if (!any) return false;

    const sigma = this.radius / this.cell / 2;
    for (const box of boxesForGauss(sigma, 3)) {
      blurH(grid, this.tmp, gw, gh, box);
      blurV(this.tmp, grid, gw, gh, box);
    }
    // One isolated incident of weight 1 peaks at about 1 / (2π σ²) once blurred.
    this.unit = 1 / (2 * Math.PI * sigma * sigma);
    let top = 0;
    for (let i = 0; i < grid.length; i++) if ((grid[i] ?? 0) > top) top = grid[i] ?? 0;
    this.top = top;

    const context2 = this.canvas.getContext?.('2d') ?? null;
    if (context2 === null) return false;
    if (this.image === null) this.image = context2.createImageData(gw, gh);
    const data = this.image.data;
    const floor = this.unit * CUTOFF;
    const scale = Math.log1p(top / floor);
    const lut = this.lut;
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i] ?? 0;
      const o = i * 4;
      if (v <= floor || scale <= 0) {
        data[o + 3] = 0;
        continue;
      }
      const t = Math.min(255, Math.round((Math.log1p(v / floor) / scale) * 255));
      data[o] = lut[t * 4] ?? 0;
      data[o + 1] = lut[t * 4 + 1] ?? 0;
      data[o + 2] = lut[t * 4 + 2] ?? 0;
      data[o + 3] = lut[t * 4 + 3] ?? 0;
    }
    context2.putImageData(this.image, 0, 0);
    context.save();
    context.imageSmoothingEnabled = true;
    context.drawImage(this.canvas, 0, 0, gw, gh, 0, 0, gw * this.cell, gh * this.cell);
    context.restore();
    return true;
  }

  /** Position of the density under a point on the ramp, 0 to 1 (0 off the heat). */
  at(x: number, y: number): number {
    const gx = Math.floor(x / this.cell);
    const gy = Math.floor(y / this.cell);
    if (gx < 0 || gy < 0 || gx >= this.width || gy >= this.height || this.top === 0) return 0;
    const v = this.grid[gy * this.width + gx] ?? 0;
    const floor = this.unit * CUTOFF;
    return v <= floor ? 0 : Math.log1p(v / floor) / Math.log1p(this.top / floor);
  }

  /** Forgets the last drawing (nothing to point at). */
  clear(): void {
    this.top = 0;
  }
}

/**
 * Territories of several classes (the organizations of the view): one density per class, blurred
 * like the heat, and each pixel takes the colour of the class that dominates it, more opaque where
 * the incidents are denser. The heat said where; the territories say who, at the same places.
 */
export class ClassField {
  readonly cell: number;
  readonly radius: number;
  private width = 0;
  private height = 0;
  private classes = 0;
  private grids: Float32Array[] = [];
  private total = new Float32Array(0);
  private tmp = new Float32Array(0);
  private floor = 1;
  private top = 0;
  private readonly canvas: HTMLCanvasElement;
  private image: ImageData | null = null;

  constructor(doc: Document, cell: number, radius: number) {
    this.cell = cell;
    this.radius = radius;
    this.canvas = doc.createElement('canvas');
  }

  draw(
    context: CanvasRenderingContext2D,
    xs: Float64Array,
    ys: Float64Array,
    n: number,
    weight: (m: number) => number,
    classOf: (m: number) => number,
    colors: readonly string[],
    width: number,
    height: number,
  ): void {
    const gw = Math.max(1, Math.ceil(width / this.cell));
    const gh = Math.max(1, Math.ceil(height / this.cell));
    const size = gw * gh;
    if (this.width !== gw || this.height !== gh || this.classes !== colors.length) {
      this.width = gw;
      this.height = gh;
      this.classes = colors.length;
      this.grids = colors.map(() => new Float32Array(size));
      this.total = new Float32Array(size);
      this.tmp = new Float32Array(size);
      this.canvas.width = gw;
      this.canvas.height = gh;
      this.image = null;
    } else {
      for (const grid of this.grids) grid.fill(0);
    }
    this.top = 0;
    for (let m = 0; m < n; m++) {
      const w = weight(m);
      if (!(w > 0)) continue;
      const gx = Math.floor((xs[m] ?? 0) / this.cell);
      const gy = Math.floor((ys[m] ?? 0) / this.cell);
      if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) continue;
      const grid = this.grids[classOf(m)];
      if (grid !== undefined) grid[gy * gw + gx] = (grid[gy * gw + gx] ?? 0) + w;
    }
    const sigma = this.radius / this.cell / 2;
    const boxes = boxesForGauss(sigma, 3);
    for (const grid of this.grids) {
      for (const box of boxes) {
        blurH(grid, this.tmp, gw, gh, box);
        blurV(this.tmp, grid, gw, gh, box);
      }
    }
    // Isolated incidents stay faintly visible: at this scale each one counts.
    this.floor = 0.08 / (2 * Math.PI * sigma * sigma);
    const context2 = this.canvas.getContext?.('2d') ?? null;
    if (context2 === null) return;
    if (this.image === null) this.image = context2.createImageData(gw, gh);
    const data = this.image.data;
    const rgbs = colors.map(rgb);
    const total = this.total;
    let top = 0;
    for (let i = 0; i < size; i++) {
      let sum = 0;
      for (const grid of this.grids) sum += grid[i] ?? 0;
      total[i] = sum;
      if (sum > top) top = sum;
    }
    this.top = top;
    const scale = Math.log1p(top / this.floor);
    for (let i = 0; i < size; i++) {
      const o = i * 4;
      const sum = total[i] ?? 0;
      if (sum <= this.floor || scale <= 0) {
        data[o + 3] = 0;
        continue;
      }
      let best = 0;
      let bestValue = -1;
      for (let c = 0; c < this.grids.length; c++) {
        const v = this.grids[c]?.[i] ?? 0;
        if (v > bestValue) {
          bestValue = v;
          best = c;
        }
      }
      const t = Math.log1p(sum / this.floor) / scale;
      const [r, g, b] = rgbs[best] ?? [128, 128, 128];
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      // From transparent at the edge, so that a territory has soft borders, not the grid's squares.
      data[o + 3] = Math.round(255 * Math.min(0.85, 1.25 * Math.pow(t, 0.75)));
    }
    context2.putImageData(this.image, 0, 0);
    context.save();
    context.imageSmoothingEnabled = true;
    context.drawImage(this.canvas, 0, 0, gw, gh, 0, 0, gw * this.cell, gh * this.cell);
    context.restore();
  }

  /** True when a point lies on a territory. */
  covers(x: number, y: number): boolean {
    const gx = Math.floor(x / this.cell);
    const gy = Math.floor(y / this.cell);
    if (gx < 0 || gy < 0 || gx >= this.width || gy >= this.height || this.top === 0) return false;
    return (this.total[gy * this.width + gx] ?? 0) > this.floor;
  }

  clear(): void {
    this.top = 0;
  }
}

function rgb(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** 256 RGBA entries interpolated between the stops. */
function buildLut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 1;
    while (k < HEAT_STOPS.length - 1 && (HEAT_STOPS[k]?.[0] ?? 1) < t) k++;
    const [t0, c0, a0] = HEAT_STOPS[k - 1] ?? HEAT_STOPS[0] ?? [0, '#000000', 0];
    const [t1, c1, a1] = HEAT_STOPS[k] ?? [1, '#000000', 1];
    const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    const from = rgb(c0);
    const to = rgb(c1);
    lut[i * 4] = from[0] + (to[0] - from[0]) * u;
    lut[i * 4 + 1] = from[1] + (to[1] - from[1]) * u;
    lut[i * 4 + 2] = from[2] + (to[2] - from[2]) * u;
    lut[i * 4 + 3] = 255 * (a0 + (a1 - a0) * u);
  }
  return lut;
}

/** Radii of `n` box blurs whose succession approximates a gaussian of standard deviation `sigma`. */
export function boxesForGauss(sigma: number, n: number): number[] {
  const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => Math.max(0, ((i < m ? wl : wu) - 1) / 2));
}

/** Horizontal box blur of radius r, from `src` into `dst` (running sum, edges taken as zero). */
function blurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const size = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = 0; x <= r && x < w; x++) sum += src[row + x] ?? 0;
    for (let x = 0; x < w; x++) {
      dst[row + x] = sum / size;
      const add = x + r + 1;
      const drop = x - r;
      if (add < w) sum += src[row + add] ?? 0;
      if (drop >= 0) sum -= src[row + drop] ?? 0;
    }
  }
}

/** Vertical box blur of radius r, from `src` into `dst`. */
function blurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const size = 2 * r + 1;
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y <= r && y < h; y++) sum += src[y * w + x] ?? 0;
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum / size;
      const add = y + r + 1;
      const drop = y - r;
      if (add < h) sum += src[add * w + x] ?? 0;
      if (drop >= 0) sum -= src[drop * w + x] ?? 0;
    }
  }
}
