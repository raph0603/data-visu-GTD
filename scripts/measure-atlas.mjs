// Measures the world-atlas country topologies used to choose the map geometry
// (docs/map-decisions.md, D1): size, gzip size, entity count, ids, point counts.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import { feature } from "topojson-client";

const require = createRequire(import.meta.url);
const resolutions = ["110m", "50m", "10m"];
const sampleCountries = { "368": "Iraq", "004": "Afghanistan", "422": "Lebanon", "170": "Colombia" };

const countPoints = (coordinates) =>
  typeof coordinates[0] === "number"
    ? 1
    : coordinates.reduce((sum, child) => sum + countPoints(child), 0);

const kilobytes = (bytes) => Number((bytes / 1024).toFixed(1));

const summaries = {};
const idsByResolution = {};
for (const resolution of resolutions) {
  const buffer = readFileSync(require.resolve(`world-atlas/countries-${resolution}.json`));
  const topology = JSON.parse(buffer.toString("utf8"));
  const features = feature(topology, topology.objects.countries).features;
  const points = features.map((f) => (f.geometry ? countPoints(f.geometry.coordinates) : 0));
  const sortedPoints = [...points].sort((a, b) => a - b);
  const ids = features.map((f) => f.id).filter((id) => id !== undefined);

  idsByResolution[resolution] = new Set(ids);
  summaries[resolution] = {
    rawKB: kilobytes(buffer.length),
    gzipKB: kilobytes(gzipSync(buffer, { level: 6 }).length),
    entities: features.length,
    withoutId: features.length - ids.length,
    duplicateIds: [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))].join(",") || "-",
    points: points.reduce((sum, n) => sum + n, 0),
    medianPoints: sortedPoints[Math.floor(sortedPoints.length / 2)],
    ...Object.fromEntries(
      Object.entries(sampleCountries).map(([id, name]) => [
        name,
        points[features.findIndex((f) => f.id === id)] ?? "absent",
      ]),
    ),
  };
}

console.table(summaries);
const only50m = [...idsByResolution["50m"]].filter((id) => !idsByResolution["110m"].has(id));
console.log(`Ids present in 50m but not in 110m: ${only50m.length}`);
