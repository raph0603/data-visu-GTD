/**
 * Hexagonal binning in screen space (pointy-top grid), recomputed whenever the camera moves: a bin
 * always has the same size on screen, so density reads the same at every zoom.
 */
export interface HexBin {
  readonly key: number;
  readonly x: number;
  readonly y: number;
  /** Positions, in the caller's point list, of the points that fall in this bin. */
  readonly items: number[];
}

const cellKey = (i: number, j: number): number => (j + 2048) * 8192 + (i + 2048);

export class HexGrid {
  private readonly dx: number;
  private readonly dy: number;

  constructor(readonly radius: number) {
    this.dx = radius * 2 * Math.sin(Math.PI / 3);
    this.dy = radius * 1.5;
  }

  /** Grid cell of a point: [column, row], the row parity shifting columns by half a cell. */
  cell(x: number, y: number): [number, number] {
    const py = y / this.dy;
    let pj = Math.round(py);
    const px = x / this.dx - (pj & 1) / 2;
    let pi = Math.round(px);
    const py1 = py - pj;
    // Near the slanted edges, the nearest of the two candidate centres wins.
    if (Math.abs(py1) * 3 > 1) {
      const px1 = px - pi;
      const pi2 = pi + (px < pi ? -1 : 1) / 2;
      const pj2 = pj + (py < pj ? -1 : 1);
      const px2 = px - pi2;
      const py2 = py - pj2;
      if (px1 * px1 + py1 * py1 > px2 * px2 + py2 * py2) {
        pi = pi2 + ((pj & 1) !== 0 ? 1 : -1) / 2;
        pj = pj2;
      }
    }
    return [pi, pj];
  }

  key(x: number, y: number): number {
    const [i, j] = this.cell(x, y);
    return cellKey(i, j);
  }

  centre(i: number, j: number): [number, number] {
    return [(i + (j & 1) / 2) * this.dx, j * this.dy];
  }

  bin(xs: ArrayLike<number>, ys: ArrayLike<number>, count: number): Map<number, HexBin> {
    const bins = new Map<number, HexBin>();
    for (let n = 0; n < count; n++) {
      const x = xs[n] ?? 0;
      const y = ys[n] ?? 0;
      const [i, j] = this.cell(x, y);
      const key = cellKey(i, j);
      let bin = bins.get(key);
      if (bin === undefined) {
        const [cx, cy] = this.centre(i, j);
        bin = { key, x: cx, y: cy, items: [] };
        bins.set(key, bin);
      }
      bin.items.push(n);
    }
    return bins;
  }

  /** Traces one hexagon of radius `r` around (x, y) on a 2D context. */
  trace(context: CanvasRenderingContext2D, x: number, y: number, r: number = this.radius): void {
    for (let corner = 0; corner < 6; corner++) {
      const angle = (corner * Math.PI) / 3;
      const cx = x + Math.sin(angle) * r;
      const cy = y - Math.cos(angle) * r;
      if (corner === 0) context.moveTo(cx, cy);
      else context.lineTo(cx, cy);
    }
    context.closePath();
  }
}
