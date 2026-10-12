import { describe, expect, it } from "vitest";
import {
  aggregateIncidents, filterIncidents, parseIncident, sortRankings,
  type Filters,
} from "./rankings";

const incident = (overrides: Record<string, string> = {}) => parseIncident({
  eventid: "1", iyear: "2017", country_txt: "A", region_txt: "R", city: "Springfield", provstate: "S",
  gname: "G", attacktype1_txt: "Bombing", weaptype1_txt: "Explosives",
  nkill: "0", nwound: "0", suicide: "0", success: "1", doubtterr: "0", ...overrides,
});

const filters: Filters = {
  startYear: 2013, endYear: 2017, categories: {}, flags: {},
  knownDeathsOnly: false, knownInjuriesOnly: false,
};

describe("classements filtrés", () => {
  it("distingue les zéros des valeurs inconnues et invalides", () => {
    expect(incident().deaths).toBe(0);
    expect(incident({ nkill: "", nwound: "-99", doubtterr: "-9" })).toMatchObject({
      deaths: null, injuries: null, doubtterr: null,
    });
    expect(incident({ nkill: "NaN" }).deaths).toBeNull();
  });

  it("combine période, catégories, indicateurs binaires et complétude", () => {
    const rows = [incident(), incident({ country_txt: "B" }), incident({ iyear: "2012" }),
      incident({ suicide: "1" }), incident({ nwound: "" })];
    expect(filterIncidents(rows, {
      ...filters, categories: { country_txt: "A", region_txt: "R" },
      flags: { suicide: "0", success: "1" }, knownInjuriesOnly: true,
    })).toEqual([rows[0]]);
  });

  it("ne classe pas les indicateurs inconnus comme des valeurs nulles égales à zéro", () => {
    const rows = aggregateIncidents([incident({ nkill: "", nwound: "" }),
      incident({ country_txt: "B" })], "country_txt");
    expect(sortRankings(rows, "deaths").map((row) => row.category)).toEqual(["B"]);
    expect(sortRankings(rows, "attacks")).toHaveLength(2);
  });

  it("calcule chaque moyenne avec son propre dénominateur connu", () => {
    const [row] = aggregateIncidents([
      incident({ nkill: "0", nwound: "2" }),
      incident({ nkill: "6", nwound: "" }),
      incident({ nkill: "", nwound: "10", suicide: "1", success: "0" }),
    ], "country_txt");
    expect(row).toMatchObject({
      attacks: 3, deaths: 6, injuries: 12, averageDeaths: 3, averageInjuries: 6,
      casualties: 2, averageCasualties: 2, knownCasualtyIncidents: 1,
      unknownDeathIncidents: 1, unknownInjuryIncidents: 1, suicideAttacks: 1,
    });
    expect(row.successRate).toBeCloseTo(200 / 3);
  });

  it("filtre les drapeaux inconnus sans les confondre avec non", () => {
    const rows = [incident(), incident({ doubtterr: "" })];
    expect(filterIncidents(rows, { ...filters, flags: { doubtterr: "unknown" } })).toEqual([rows[1]]);
    expect(filterIncidents(rows, { ...filters, flags: { doubtterr: "0" } })).toEqual([rows[0]]);
  });

  it("sépare les villes homonymes et masque les catégories Unknown à la demande", () => {
    const rows = aggregateIncidents([incident(), incident({ country_txt: "B" }), incident({ provstate: "T" }),
      incident({ city: "Unknown" })], "city", true);
    expect(rows.map((row) => row.category)).toEqual(["Springfield (S, A)", "Springfield (S, B)", "Springfield (T, A)"]);
  });

  it("applique le minimum d'incidents et gère les sélections vides ou inversées", () => {
    const rows = aggregateIncidents([incident(), incident(), incident({ country_txt: "B", nkill: "20" })], "country_txt");
    expect(sortRankings(rows, "averageDeaths", 2).map((row) => row.category)).toEqual(["A"]);
    expect(filterIncidents([incident()], { ...filters, startYear: 2018 })).toEqual([]);
    expect(aggregateIncidents([], "country_txt")).toEqual([]);
  });
});
