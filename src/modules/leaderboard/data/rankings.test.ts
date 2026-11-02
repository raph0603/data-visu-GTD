import { describe, expect, it } from "vitest";
import {
  aggregateIncidents, filterIncidents, parseIncident, sortRankings,
  type Filters,
} from "./rankings";

const incident = (overrides: Record<string, string> = {}) => parseIncident({
  eventId: "1", year: "2017", country: "A", region: "R", city: "Springfield", province: "S",
  group: "G", attackType: "Bombing", weaponType: "Explosives",
  killed: "0", wounded: "0", suicide: "0", success: "1", doubt: "0", ...overrides,
});

const filters: Filters = {
  startYear: 2013, endYear: 2017, categories: {}, flags: {},
  knownDeathsOnly: false, knownInjuriesOnly: false,
};

describe("classements filtrés", () => {
  it("regroupe plusieurs catégories sans compter deux fois leurs incidents", () => {
    const rows = aggregateIncidents([incident({ killed: "10", country: "A" }),
      incident({ killed: "0", country: "B", success: "0" }), incident({ killed: "0", country: "B" }),
      incident({ killed: "", country: "B" }), incident({ killed: "7", country: "C" })],
    "country", false, [{ name: "A et B", members: ["A", "B"] }]);
    expect(rows).toHaveLength(2);
    const group = rows.find((row) => row!.category === "A et B")!;
    expect(group.attacks).toBe(4);
    expect(group.deaths).toBe(10);
    expect(group.averageDeaths).toBeCloseTo(10 / 3);
    expect(group.successRate).toBe(75);
    expect(group.unknownDeathIncidents).toBe(1);
    expect(rows.find((row) => row!.category === "C")!.deaths).toBe(7);
    expect(rows.reduce((sum, row) => sum + row!.attacks, 0)).toBe(5);
  });

  it("conserve les villes homonymes distinctes dans les regroupements", () => {
    const rows = aggregateIncidents([incident(), incident({ country: "B" }), incident({ city: "Elsewhere" })],
      "city", false, [{ name: "Villes regroupées", members: ["Springfield (S, A)", "Elsewhere (S, A)"] }]);
    expect(rows.map((row) => [row!.category, row!.attacks])).toEqual([["Villes regroupées", 2], ["Springfield (S, B)", 1]]);
  });

  it("empêche qu'une catégorie appartienne à deux groupes", () => {
    expect(() => aggregateIncidents([incident()], "country", false,
      [{ name: "Premier", members: ["A", "B"] }, { name: "Second", members: ["A", "C"] }]))
      .toThrow("Une catégorie ne peut appartenir qu'à un seul groupe.");
  });

  it("respecte l'exclusion Unknown avant de calculer un groupe", () => {
    const [row] = aggregateIncidents([incident(), incident({ country: "Unknown", killed: "50" })],
      "country", true, [{ name: "Groupe", members: ["A", "Unknown"] }]);
    expect(row!.attacks).toBe(1);
    expect(row!.deaths).toBe(0);
  });
  it("distingue les zéros des valeurs inconnues et invalides", () => {
    expect(incident().deaths).toBe(0);
    expect(incident({ killed: "", wounded: "-99", doubt: "-9" })).toMatchObject({
      deaths: null, injuries: null, doubt: null,
    });
    expect(incident({ killed: "NaN" }).deaths).toBeNull();
  });

  it("combine période, catégories, indicateurs binaires et complétude", () => {
    const rows = [incident(), incident({ country: "B" }), incident({ year: "2012" }),
      incident({ suicide: "1" }), incident({ wounded: "" })];
    expect(filterIncidents(rows, {
      ...filters, categories: { country: "A", region: "R" },
      flags: { suicide: "0", success: "1" }, knownInjuriesOnly: true,
    })).toEqual([rows[0]!]);
  });

  it("ne classe pas les indicateurs inconnus comme des valeurs nulles égales à zéro", () => {
    const rows = aggregateIncidents([incident({ killed: "", wounded: "" }),
      incident({ country: "B" })], "country");
    expect(sortRankings(rows, "deaths").map((row) => row!.category)).toEqual(["B"]);
    expect(sortRankings(rows, "attacks")).toHaveLength(2);
  });

  it("calcule chaque moyenne avec son propre dénominateur connu", () => {
    const [row] = aggregateIncidents([
      incident({ killed: "0", wounded: "2" }),
      incident({ killed: "6", wounded: "" }),
      incident({ killed: "", wounded: "10", suicide: "1", success: "0" }),
    ], "country");
    expect(row).toMatchObject({
      attacks: 3, deaths: 6, injuries: 12, averageDeaths: 3, averageInjuries: 6,
      casualties: 2, averageCasualties: 2, knownCasualtyIncidents: 1,
      unknownDeathIncidents: 1, unknownInjuryIncidents: 1, suicideAttacks: 1,
    });
    expect(row!.successRate).toBeCloseTo(200 / 3);
  });

  it("filtre les drapeaux inconnus sans les confondre avec non", () => {
    const rows = [incident(), incident({ doubt: "" })];
    expect(filterIncidents(rows, { ...filters, flags: { doubt: "unknown" } })).toEqual([rows[1]!]);
    expect(filterIncidents(rows, { ...filters, flags: { doubt: "0" } })).toEqual([rows[0]!]);
  });

  it("sépare les villes homonymes et masque les catégories Unknown à la demande", () => {
    const rows = aggregateIncidents([incident(), incident({ country: "B" }), incident({ province: "T" }),
      incident({ city: "Unknown" })], "city", true);
    expect(rows.map((row) => row!.category)).toEqual(["Springfield (S, A)", "Springfield (S, B)", "Springfield (T, A)"]);
  });

  it("applique le minimum d'incidents et gère les sélections vides ou inversées", () => {
    const rows = aggregateIncidents([incident(), incident(), incident({ country: "B", killed: "20" })], "country");
    expect(sortRankings(rows, "averageDeaths", 2).map((row) => row!.category)).toEqual(["A"]);
    expect(filterIncidents([incident()], { ...filters, startYear: 2018 })).toEqual([]);
    expect(aggregateIncidents([], "country")).toEqual([]);
  });
});
