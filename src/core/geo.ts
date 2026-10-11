import { geoArea, json } from "d3";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { feature, merge } from "topojson-client";
import type {
  GeometryCollection,
  MultiPolygon as TopoMultiPolygon,
  Polygon as TopoPolygon,
  Topology,
} from "topojson-specification";
import countriesTopologyUrl from "world-atlas/countries-50m.json?url";
import { ISO_NUMERIC_TO_ALPHA3 } from "./iso3166";

export type CountryGeometry = Polygon | MultiPolygon;

export type CountryFeature = Feature<CountryGeometry, { iso3: string; name: string }>;

/** A drawn entity that cannot be joined by ISO code (e.g. Kosovo, Somaliland). */
export type UncodedFeature = Feature<
  CountryGeometry,
  { isoNumeric: string | null; name: string }
>;

export type CountriesTopology = Topology<{
  countries: GeometryCollection<{ name: string }>;
}>;

export type CountryAtlas = {
  readonly topology: CountriesTopology;
  /** One feature per ISO alpha-3 code, ordered by code. */
  readonly countries: readonly CountryFeature[];
  /** Entities without a usable ISO code, ordered by name. */
  readonly uncoded: readonly UncodedFeature[];
  featureFor(iso3: string): CountryFeature | undefined;
};

/** world-atlas countries-50m, emitted by Vite as a separate cacheable asset. */
export const COUNTRIES_TOPOLOGY_URL: string = countriesTopologyUrl;

type CountryObject = (TopoPolygon<{ name: string }> | TopoMultiPolygon<{ name: string }>) & {
  id?: string | number;
};

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function countryObjects(topology: unknown): CountryObject[] {
  const countries = (topology as { objects?: { countries?: GeometryCollection } } | null)
    ?.objects?.countries;
  if (countries?.type !== "GeometryCollection" || !Array.isArray(countries.geometries)) {
    throw new Error('Invalid topology: expected a "countries" GeometryCollection in objects.');
  }
  for (const geometry of countries.geometries) {
    if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
      throw new Error(
        `Invalid topology: country geometry ${String(geometry.id)} has type ${geometry.type}.`,
      );
    }
  }
  return countries.geometries as CountryObject[];
}

function toFeature(topology: CountriesTopology, object: CountryObject) {
  return feature(topology, object) as Feature<CountryGeometry, { name: string }>;
}

export function buildCountryAtlas(topology: unknown): CountryAtlas {
  const objects = countryObjects(topology);
  const typed = topology as CountriesTopology;

  const groups = new Map<string, CountryObject[]>();
  const uncoded: UncodedFeature[] = [];
  for (const object of objects) {
    const isoNumeric = object.id === undefined ? null : String(object.id);
    const iso3 = isoNumeric === null ? undefined : ISO_NUMERIC_TO_ALPHA3[isoNumeric];
    if (iso3 === undefined) {
      uncoded.push({
        type: "Feature",
        properties: { isoNumeric, name: object.properties?.name ?? "" },
        geometry: toFeature(typed, object).geometry,
      });
      continue;
    }
    groups.set(iso3, [...(groups.get(iso3) ?? []), object]);
  }

  // Décision D3 (docs/map-decisions.md) : les géométries d'un même code sont
  // fusionnées, et l'entité prend le nom de la plus grande (Australie et non
  // Ashmore-et-Cartier), pour ne pas dépendre de l'ordre du fichier.
  const countries: CountryFeature[] = [...groups.entries()].map(([iso3, members]) => {
    const parts = members.map((member) => toFeature(typed, member));
    const largest = parts.reduce((best, part) => (geoArea(part) > geoArea(best) ? part : best));
    return {
      type: "Feature",
      id: iso3,
      properties: { iso3, name: largest.properties.name },
      geometry: parts.length === 1 ? parts[0].geometry : merge(typed, members),
    };
  });

  countries.sort((a, b) => byCodePoint(a.properties.iso3, b.properties.iso3));
  uncoded.sort((a, b) => byCodePoint(a.properties.name, b.properties.name));
  const index = new Map(countries.map((country) => [country.properties.iso3, country]));

  return {
    topology: typed,
    countries,
    uncoded,
    featureFor: (iso3) => index.get(iso3),
  };
}

const atlasCache = new Map<string, Promise<CountryAtlas>>();

/**
 * Loads and indexes a countries topology once per URL.
 * fetchTopology defaults to d3.json; tests inject their own.
 */
export function loadCountryAtlas(
  url: string = COUNTRIES_TOPOLOGY_URL,
  fetchTopology: (url: string) => Promise<unknown> = (target) => json(target),
): Promise<CountryAtlas> {
  const cached = atlasCache.get(url);
  if (cached) {
    return cached;
  }

  // On mémoïse la promesse (et non le résultat) pour que deux vues qui
  // demandent la carte en même temps ne déclenchent qu'un seul téléchargement.
  // Un échec est retiré du cache : sinon une coupure réseau passagère
  // bloquerait la carte jusqu'au rechargement de la page.
  const pending = fetchTopology(url)
    .then(buildCountryAtlas)
    .catch((error: unknown) => {
      atlasCache.delete(url);
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to load country geometry from "${url}": ${reason}`, {
        cause: error,
      });
    });
  atlasCache.set(url, pending);
  return pending;
}
