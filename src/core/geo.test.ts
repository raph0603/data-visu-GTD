/// <reference types="node" />
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { geoArea } from "d3";
import type { Feature } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { describe, expect, it } from "vitest";
import { buildCountryAtlas, loadCountryAtlas, type CountryGeometry } from "./geo";

type CountriesTopology = Topology<{
  countries: GeometryCollection<{ name: string }>;
}>;

const require = createRequire(import.meta.url);
const world = JSON.parse(
  readFileSync(require.resolve("world-atlas/countries-50m.json"), "utf8"),
) as CountriesTopology;

// One square country whose numeric code is not in ISO 3166-1.
const tinyTopology = {
  type: "Topology",
  arcs: [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
  ],
  objects: {
    countries: {
      type: "GeometryCollection",
      geometries: [
        { type: "Polygon", arcs: [[0]], id: "999", properties: { name: "Nowhere" } },
      ],
    },
  },
};

describe("buildCountryAtlas", () => {
  const atlas = buildCountryAtlas(world);

  it("indexes countries by ISO alpha-3 code", () => {
    const france = atlas.featureFor("FRA");
    expect(france?.properties).toEqual({ iso3: "FRA", name: "France" });
    expect(france?.geometry.type).toMatch(/^(Multi)?Polygon$/);
  });

  it("returns undefined for a code without geometry", () => {
    expect(atlas.featureFor("ZZZ")).toBeUndefined();
  });

  it("keeps one feature per distinct coded geometry id", () => {
    // 241 geometries - 5 without id - 1 duplicate id (036).
    expect(atlas.countries).toHaveLength(235);
  });

  it("merges the geometries that share a code into one feature", () => {
    const sources = world.objects.countries.geometries
      .filter((geometry) => geometry.id === "036")
      .map((geometry) => feature(world, geometry) as Feature<CountryGeometry, { name: string }>);
    expect(sources.map((source) => source.properties.name).sort()).toEqual([
      "Ashmore and Cartier Is.",
      "Australia",
    ]);
    const expectedArea = sources.reduce((sum, source) => sum + geoArea(source), 0);

    const australia = atlas.featureFor("AUS");
    expect(australia?.properties.name).toBe("Australia");
    expect(geoArea(australia!)).toBeCloseTo(expectedArea, 12);
  });

  it("orders countries by ISO alpha-3 code", () => {
    const codes = atlas.countries.map((country) => country.properties.iso3);
    expect(codes).toEqual([...codes].sort());
  });

  it("keeps geometries without ISO code so that the map has no holes", () => {
    expect(atlas.uncoded.map((entity) => entity.properties.name)).toEqual([
      "Indian Ocean Ter.",
      "Kosovo",
      "N. Cyprus",
      "Siachen Glacier",
      "Somaliland",
    ]);
    for (const entity of atlas.uncoded) {
      expect(entity.properties.isoNumeric).toBeNull();
      expect(geoArea(entity)).toBeGreaterThan(0);
    }
  });

  it("keeps a geometry whose numeric code is unknown as uncoded", () => {
    const tiny = buildCountryAtlas(tinyTopology);
    expect(tiny.countries).toEqual([]);
    expect(tiny.uncoded.map((entity) => entity.properties)).toEqual([
      { isoNumeric: "999", name: "Nowhere" },
    ]);
  });

  it("rejects a topology without a countries collection", () => {
    expect(() => buildCountryAtlas({ type: "Topology", arcs: [], objects: {} })).toThrow(
      /countries/,
    );
    expect(() => buildCountryAtlas(null)).toThrow(/countries/);
  });
});

describe("loadCountryAtlas", () => {
  it("fetches a given URL once and reuses the atlas", async () => {
    const requested: string[] = [];
    const fetchTopology = async (url: string) => {
      requested.push(url);
      return tinyTopology;
    };

    const first = await loadCountryAtlas("memo-test.json", fetchTopology);
    const second = await loadCountryAtlas("memo-test.json", fetchTopology);

    expect(requested).toEqual(["memo-test.json"]);
    expect(second).toBe(first);
  });

  it("does not keep a failed load, so that the next call retries", async () => {
    let calls = 0;
    const fetchTopology = async () => {
      calls += 1;
      if (calls === 1) throw new Error("network down");
      return tinyTopology;
    };

    await expect(loadCountryAtlas("retry-test.json", fetchTopology)).rejects.toThrow(
      /retry-test\.json.*network down/,
    );
    const atlas = await loadCountryAtlas("retry-test.json", fetchTopology);

    expect(calls).toBe(2);
    expect(atlas.uncoded).toHaveLength(1);
  });
});
