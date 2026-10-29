// Measures the alternative "reassign by coordinates" for the GTD country names
// that are not directly mapped (docs/map-decisions.md, D6): for each name, in
// which current 50m shape (d3.geoContains) do its incidents fall?
// Input on stdin: the JSON written by preprocess/export_policy_points.py.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { geoBounds, geoContains } from "d3";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { ISO_NUMERIC_TO_ALPHA3 } from "../src/core/iso3166.ts";

type Point = { country: string; year: number; latitude: number | null; longitude: number | null };
type Shape = { label: string; feature: Feature<Polygon | MultiPolygon>; bounds: [[number, number], [number, number]] };

const require = createRequire(import.meta.url);
const topology = JSON.parse(
  readFileSync(require.resolve("world-atlas/countries-50m.json"), "utf8"),
) as Topology<{ countries: GeometryCollection<{ name: string }> }>;

const shapes: Shape[] = topology.objects.countries.geometries.map((geometry) => {
  const shape = feature(topology, geometry) as Feature<Polygon | MultiPolygon, { name: string }>;
  const code = geometry.id === undefined ? undefined : ISO_NUMERIC_TO_ALPHA3[String(geometry.id)];
  return {
    label: code ?? `sans code: ${shape.properties.name}`,
    feature: shape,
    bounds: geoBounds(shape),
  };
});

// Bounding-box filter before the exact spherical test; boxes that cross the
// antimeridian have west > east.
function inBounds([[west, south], [east, north]]: Shape["bounds"], lon: number, lat: number) {
  if (lat < south || lat > north) return false;
  return west <= east ? lon >= west && lon <= east : lon >= west || lon <= east;
}

function locate(lon: number, lat: number): string {
  const hit = shapes.find(
    (shape) => inBounds(shape.bounds, lon, lat) && geoContains(shape.feature, [lon, lat]),
  );
  return hit?.label ?? "aucune forme (mer, côte ou coordonnée hors carte)";
}

const points = JSON.parse(readFileSync(0, "utf8")) as Point[];
const byCountry = new Map<string, Point[]>();
for (const point of points) {
  byCountry.set(point.country, [...(byCountry.get(point.country) ?? []), point]);
}

for (const [country, rows] of [...byCountry].sort((a, b) => b[1].length - a[1].length)) {
  const years = rows.map((row) => row.year);
  const located = rows.filter((row) => row.latitude !== null && row.longitude !== null);
  const tally = new Map<string, number>();
  for (const row of located) {
    const label = locate(row.longitude!, row.latitude!);
    tally.set(label, (tally.get(label) ?? 0) + 1);
  }
  const distribution = [...tally]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${label}=${count}`)
    .join(", ");
  console.log(
    `${country} | ${rows.length} incidents, ${Math.min(...years)}-${Math.max(...years)} | ` +
      `sans coordonnées: ${rows.length - located.length} | ${distribution}`,
  );
}
