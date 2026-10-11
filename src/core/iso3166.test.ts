/// <reference types="node" />
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { ISO_NUMERIC_TO_ALPHA3 } from "./iso3166";

type CountryGeometry = { id?: string; properties: { name: string } };
type CountriesTopology = {
  objects: { countries: { geometries: CountryGeometry[] } };
};

const require = createRequire(import.meta.url);
const topology = JSON.parse(
  readFileSync(require.resolve("world-atlas/countries-50m.json"), "utf8"),
) as CountriesTopology;
const geometries = topology.objects.countries.geometries;

describe("ISO_NUMERIC_TO_ALPHA3", () => {
  it("maps 3-digit numeric codes to unique 3-letter codes", () => {
    const entries = Object.entries(ISO_NUMERIC_TO_ALPHA3);
    expect(entries.length).toBe(249);
    for (const [numeric, alpha3] of entries) {
      expect(numeric).toMatch(/^\d{3}$/);
      expect(alpha3).toMatch(/^[A-Z]{3}$/);
    }
    expect(new Set(entries.map(([, alpha3]) => alpha3)).size).toBe(entries.length);
  });

  it("matches known ISO 3166-1 pairs", () => {
    expect(ISO_NUMERIC_TO_ALPHA3["004"]).toBe("AFG");
    expect(ISO_NUMERIC_TO_ALPHA3["250"]).toBe("FRA");
    expect(ISO_NUMERIC_TO_ALPHA3["368"]).toBe("IRQ");
    expect(ISO_NUMERIC_TO_ALPHA3["840"]).toBe("USA");
  });

  it("resolves every coded geometry of world-atlas countries-50m", () => {
    const unresolved = geometries
      .filter((geometry) => geometry.id !== undefined)
      .filter((geometry) => ISO_NUMERIC_TO_ALPHA3[geometry.id!] === undefined)
      .map((geometry) => `${geometry.id} ${geometry.properties.name}`);
    expect(unresolved).toEqual([]);
  });

  it("lists the countries-50m geometries that have no ISO code", () => {
    const withoutId = geometries
      .filter((geometry) => geometry.id === undefined)
      .map((geometry) => geometry.properties.name)
      .sort();
    expect(withoutId).toEqual([
      "Indian Ocean Ter.",
      "Kosovo",
      "N. Cyprus",
      "Siachen Glacier",
      "Somaliland",
    ]);
  });
});
