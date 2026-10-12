import { describe, expect, it } from "vitest";
import {
  ContractError,
  fetchMeta,
  parseCountryIncidentsFile,
  parseCountryYearFile,
  parseMeta,
  parseRegionYearFile,
  parseTopEventsFile,
  type CountryIncidentsFile,
  type CountryYearFile,
  type Meta,
  type TopEventsFile,
} from "./contracts";

const meta: Meta = {
  schemaVersion: 1,
  dataset: { id: "gtd", title: "Global Terrorism Database", citation: null, license: null },
  build: {
    kind: "preprocessed",
    sourceFile: "gtd.csv",
    sourceSha256: "a".repeat(64),
    sourceEncoding: "cp1252",
  },
  years: { first: 1990, last: 1992, gaps: [1991] },
  rows: { total: 6, withoutGeo: 1, withoutCoordinates: 1 },
  quality: {
    killedKnownShare: 0.5,
    woundedKnownShare: 1,
    unknownGroupShare: 0.25,
    withoutCoordinatesShare: 0.166667,
  },
};

const series = (a: number, c: number) => [a, null, c];

const countryYear: CountryYearFile = {
  schemaVersion: 1,
  years: { first: 1990, last: 1992 },
  entities: {
    FRA: {
      label: "France",
      region: "Western Europe",
      incidents: series(3, 2),
      killed: { sum: series(4, 0), known: series(2, 1) },
      wounded: { sum: series(1.5, 0), known: series(3, 2) },
      withoutCoordinates: series(1, 0),
    },
  },
  notRepresentable: {
    label: "Not representable",
    incidents: series(1, 0),
    killed: { sum: series(0, 0), known: series(0, 0) },
    wounded: { sum: series(0, 0), known: series(1, 0) },
  },
};

const incidents: CountryIncidentsFile = {
  schemaVersion: 1,
  iso3: "FRA",
  count: 2,
  withoutCoordinates: 1,
  dictionaries: { attackType: ["Bombing/Explosion"], targetType: ["Business"], group: ["Unknown"] },
  columns: {
    eventId: ["199001010001", "199201010001"],
    year: [1990, 1992],
    month: [1, null],
    day: [1, null],
    latitude: [48.85, 43.3],
    longitude: [2.35, 5.37],
    city: ["Paris", null],
    attackType: [0, 0],
    targetType: [0, 0],
    group: [0, 0],
    killed: [4, null],
    wounded: [1.5, 0],
    summary: [null, "A “quoted” summary"],
  },
};

const topEvents: TopEventsFile = {
  schemaVersion: 1,
  perYear: 2,
  countries: {
    FRA: [
      {
        eventId: "199001010001",
        year: 1990,
        month: 1,
        day: 1,
        city: "Paris",
        killed: 4,
        wounded: 1.5,
        attackType: "Bombing/Explosion",
        group: "Unknown",
      },
    ],
  },
};

const clone = <T>(value: T): T => structuredClone(value);

describe("parseMeta", () => {
  it("accepts a valid meta.json", () => {
    expect(parseMeta(clone(meta))).toEqual(meta);
  });

  it.each([
    ["schemaVersion", (m: Meta) => ((m as { schemaVersion: number }).schemaVersion = 2)],
    ["build.kind", (m: Meta) => ((m.build as { kind: string }).kind = "manual")],
    ["years.gaps", (m: Meta) => (m.years.gaps = [1989])],
    ["rows.withoutGeo", (m: Meta) => (m.rows.withoutGeo = 7)],
    ["quality.killedKnownShare", (m: Meta) => (m.quality.killedKnownShare = 1.2)],
    ["build.sourceSha256", (m: Meta) => (m.build.sourceSha256 = "xyz")],
  ])("rejects an invalid %s", (path, corrupt) => {
    const value = clone(meta);
    corrupt(value);
    expect(() => parseMeta(value)).toThrow(new RegExp(path.replace(".", "\\.")));
  });

  it("rejects a value that is not an object", () => {
    expect(() => parseMeta(null)).toThrow(ContractError);
  });
});

describe("parseCountryYearFile", () => {
  it("accepts a valid file", () => {
    expect(parseCountryYearFile(clone(countryYear), meta)).toEqual(countryYear);
  });

  it("rejects a series whose length differs from the covered years", () => {
    const value = clone(countryYear);
    value.entities.FRA!.incidents = [3, null];
    expect(() => parseCountryYearFile(value, meta)).toThrow(/entities\.FRA\.incidents/);
  });

  it("rejects a 0 on a year without data", () => {
    const value = clone(countryYear);
    value.entities.FRA!.incidents = [3, 0, 2];
    expect(() => parseCountryYearFile(value, meta)).toThrow(/1991 must be null/);
  });

  it("rejects a null on a year with data", () => {
    const value = clone(countryYear);
    value.entities.FRA!.killed.sum = [null, null, 0];
    expect(() => parseCountryYearFile(value, meta)).toThrow(/1990 must not be null/);
  });

  it("rejects more known casualty values than incidents", () => {
    const value = clone(countryYear);
    value.entities.FRA!.killed.known = series(4, 1);
    expect(() => parseCountryYearFile(value, meta)).toThrow(/killed\.known/);
  });

  it("rejects years that differ from meta.json", () => {
    const value = clone(countryYear);
    value.years.first = 1989;
    expect(() => parseCountryYearFile(value, meta)).toThrow(/years/);
  });

  it("requires the notRepresentable series", () => {
    const value = clone(countryYear) as Partial<CountryYearFile>;
    delete value.notRepresentable;
    expect(() => parseCountryYearFile(value, meta)).toThrow(/notRepresentable/);
  });
});

describe("parseRegionYearFile", () => {
  it("accepts entities without region or coordinates series", () => {
    const value = {
      schemaVersion: 1,
      years: { first: 1990, last: 1992 },
      entities: { "Western Europe": clone(countryYear.notRepresentable) },
    };
    expect(parseRegionYearFile(clone(value), meta)).toEqual(value);
  });
});

describe("parseCountryIncidentsFile", () => {
  it("accepts a valid file", () => {
    expect(parseCountryIncidentsFile(clone(incidents), meta)).toEqual(incidents);
  });

  it("rejects columns of different lengths", () => {
    const value = clone(incidents);
    value.columns.city = ["Paris"];
    expect(() => parseCountryIncidentsFile(value, meta)).toThrow(/columns\.city/);
  });

  it("rejects a dictionary index out of range", () => {
    const value = clone(incidents);
    value.columns.group = [0, 1];
    expect(() => parseCountryIncidentsFile(value, meta)).toThrow(/columns\.group/);
  });

  it("rejects a latitude out of range", () => {
    const value = clone(incidents);
    value.columns.latitude = [48.85, 91];
    expect(() => parseCountryIncidentsFile(value, meta)).toThrow(/columns\.latitude/);
  });

  it("rejects an incident in a year without data", () => {
    const value = clone(incidents);
    value.columns.year = [1990, 1991];
    expect(() => parseCountryIncidentsFile(value, meta)).toThrow(/columns\.year/);
  });
});

describe("parseTopEventsFile", () => {
  it("accepts a valid file", () => {
    expect(parseTopEventsFile(clone(topEvents), meta)).toEqual(topEvents);
  });

  it("rejects more events than perYear for one country and year", () => {
    const value = clone(topEvents);
    const event = value.countries.FRA![0]!;
    value.countries.FRA = [event, { ...event, eventId: "2" }, { ...event, eventId: "3" }];
    expect(() => parseTopEventsFile(value, meta)).toThrow(/perYear/);
  });
});

describe("fetchMeta", () => {
  it("requests data/<dataset>/meta.json and validates it", async () => {
    const requested: string[] = [];
    const result = await fetchMeta("gtd", async (url) => {
      requested.push(url);
      return clone(meta);
    });
    expect(requested).toEqual(["data/gtd/meta.json"]);
    expect(result).toEqual(meta);
  });

  it("rejects the meta.json of another dataset", async () => {
    await expect(fetchMeta("other", async () => clone(meta))).rejects.toThrow(/dataset\.id/);
  });

  it("names the file in the error of an invalid meta.json", async () => {
    await expect(fetchMeta("gtd", async () => ({}))).rejects.toThrow(/data\/gtd\/meta\.json/);
  });
});
