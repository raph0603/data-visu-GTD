import type { Feature, Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { clampCamera, fitCamera, flight, MAX_K, PointProjector, projectionFor, zoomAround, type Camera } from './camera';
import { boxesForGauss } from './heat';

const view = { width: 800, height: 600 };
const RAD = Math.PI / 180;

function square(lon: number, lat: number, size: number): Feature<Polygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [lon - size, lat - size],
          [lon - size, lat + size],
          [lon + size, lat + size],
          [lon + size, lat - size],
          [lon - size, lat - size],
        ],
      ],
    },
  };
}

describe('PointProjector', () => {
  it('matches the d3 projection of the same camera, and hides the far side', () => {
    const camera: Camera = { lambda: 44, phi: 33, k: 3 };
    const projection = projectionFor(camera, view, false);
    const projector = new PointProjector(camera, view);
    const out: [number, number] = [0, 0];
    for (const [lon, lat] of [
      [44.4, 33.3],
      [36.3, 33.5],
      [51.4, 35.7],
      [30, 10],
    ] as const) {
      expect(projector.project(Math.cos(lat * RAD), Math.sin(lat * RAD), Math.cos(lon * RAD), Math.sin(lon * RAD), out)).toBe(true);
      const expected = projection([lon, lat]);
      expect(out[0]).toBeCloseTo(expected?.[0] ?? Number.NaN, 6);
      expect(out[1]).toBeCloseTo(expected?.[1] ?? Number.NaN, 6);
    }
    // The antipode of the centre is on the far side.
    expect(projector.project(Math.cos(-33 * RAD), Math.sin(-33 * RAD), Math.cos(-136 * RAD), Math.sin(-136 * RAD), out)).toBe(false);
  });
});

describe('camera moves', () => {
  it('frames a shape at its centre, zoomed so that it fills most of the view', () => {
    const camera = fitCamera(square(10, 45, 2), view);
    expect(camera.lambda).toBeCloseTo(10, 0);
    expect(camera.phi).toBeCloseTo(45, 0);
    expect(camera.k).toBeGreaterThan(5);
    const [[x0, y0], [x1, y1]] = [projectionFor(camera, view, false)([8, 43]) ?? [0, 0], projectionFor(camera, view, false)([12, 47]) ?? [0, 0]];
    expect(Math.abs(x1 - x0)).toBeLessThanOrEqual(view.width);
    expect(Math.abs(y1 - y0)).toBeLessThanOrEqual(view.height);
  });

  it('flies from one camera to the other, rising on a long trip', () => {
    const from: Camera = { lambda: -74, phi: 40, k: 20 };
    const to: Camera = { lambda: 44, phi: 33, k: 20 };
    const move = flight(from, to);
    expect(move.at(0).lambda).toBeCloseTo(from.lambda, 6);
    expect(move.at(1).lambda).toBeCloseTo(to.lambda, 6);
    expect(move.at(1).phi).toBeCloseTo(to.phi, 6);
    expect(move.at(0.5).k).toBeLessThan(from.k);
    expect(move.duration).toBeGreaterThan(0);
  });

  it('keeps the zoom inside its bounds and the longitude inside [-180, 180]', () => {
    expect(clampCamera({ lambda: 190, phi: 95, k: 1e6 })).toEqual({ lambda: -170, phi: 85, k: MAX_K });
    expect(zoomAround({ lambda: 0, phi: 0, k: 1 }, view, [400, 300], 2).k).toBe(2);
  });
});

describe('boxesForGauss', () => {
  it('gives three box blurs whose variances add up to the gaussian one', () => {
    for (const sigma of [1.5, 2.5, 4]) {
      const radii = boxesForGauss(sigma, 3);
      expect(radii).toHaveLength(3);
      for (const r of radii) expect(Number.isInteger(r)).toBe(true);
      // A box of width w = 2r + 1 has a variance of (w² − 1) / 12.
      const variance = radii.reduce((sum, r) => sum + ((2 * r + 1) ** 2 - 1) / 12, 0);
      expect(Math.abs(variance - sigma * sigma)).toBeLessThan(sigma);
    }
  });
});
