import { describe, expect, it } from "vitest";
import { buildAnnualFrames, buildTimelineFrames } from "./timeline";
import { parseIncident, type Filters } from "./rankings";

const filters: Filters = {
  startYear: 1992, endYear: 1995, categories: {}, flags: {},
  knownDeathsOnly: false, knownInjuriesOnly: false,
};
const incident = (year: number, deaths: string, country = "A") => parseIncident({
  eventId: `${year}-${country}`, year: String(year), killed: deaths, wounded: "0",
  country: country, suicide: "0", success: "1", doubt: "0",
});

describe("agrégation temporelle", () => {
  it("combine regroupement de catégories, période et minimum d'incidents", () => {
    const [frame] = buildTimelineFrames([incident(1992, "10", "A"), incident(1994, "2", "B")],
      [1992, 1994], filters, "country", "averageDeaths", 2, false, "period",
      [{ name: "Ensemble", members: ["A", "B"] }]);
    expect(frame!.ranking).toHaveLength(1);
    expect(frame!.ranking[0]!.category).toBe("Ensemble");
    expect(frame!.ranking[0]!.averageDeaths).toBe(6);
    expect(frame!.ranking[0]!.attacks).toBe(2);
  });
  it("regroupe les années par bornes calendaires et limite les périodes aux filtres", () => {
    const frames = buildTimelineFrames([incident(1992, "10"), incident(1994, "2"), incident(1995, "3")],
      [1992, 1994, 1995], filters, "country", "deaths", 1, false, "fiveYears");
    expect(frames.map((frame) => frame!.periodLabel)).toEqual(["1992–1994", "1995"]);
    expect(frames[0]!.ranking[0]!.deaths).toBe(12);
    expect(frames[0]!.missingYears).toEqual([1993]!);
    expect(frames[1]!.ranking[0]!.deaths).toBe(3);
    expect(frames[0]!.incidents).toHaveLength(2);
  });

  it("recalcule les moyennes et les taux à partir des incidents renseignés", () => {
    const rows = [incident(1992, "10"), incident(1994, "0"), incident(1994, "0"), incident(1994, "")];
    rows[0]!.success = 0;
    rows[3]!.success = null;
    const [frame] = buildTimelineFrames(rows, [1992, 1994], filters,
      "country", "averageDeaths", 1, false, "decade");
    expect(frame!.ranking[0]!.averageDeaths).toBeCloseTo(10 / 3);
    expect(frame!.ranking[0]!.successRate).toBeCloseTo(200 / 3);
    expect(frame!.ranking[0]!.knownDeathIncidents).toBe(3);
    expect(frame!.unknownDeaths).toBe(1);
  });

  it("applique les filtres et le minimum d'incidents à la période regroupée", () => {
    const rows = [incident(1992, "10"), incident(1994, "2"), incident(1994, "100", "B")];
    const [frame] = buildTimelineFrames(rows, [1992, 1994],
      { ...filters, categories: { country: "A" } }, "country", "attacks", 2, false, "period");
    expect(frame!.periodLabel).toBe("1992–1995");
    expect(frame!.ranking.map((row) => [row!.category, row!.attacks])).toEqual([["A", 2]]);
    expect(frame!.incidents).toHaveLength(2);
    expect(frame!.missingYears).toEqual([1993, 1995]);
  });

  it("conserve les périodes vides observées et les indicateurs entièrement inconnus", () => {
    const rows = [incident(1992, "", "A")];
    const frames = buildTimelineFrames(rows, [1992, 1994, 1995], filters,
      "country", "deaths", 1, false, "fiveYears");
    expect(frames).toHaveLength(2);
    expect(frames[0]!.unknownDeaths).toBe(1);
    expect(frames[0]!.ranking).toEqual([]);
    expect(frames[1]!.incidents).toEqual([]);
    expect(buildTimelineFrames(rows, [1992]!, { ...filters, startYear: 1995, endYear: 1992 },
      "country", "attacks", 1, false, "period")).toEqual([]);
  });
});

describe("séquence annuelle", () => {
  it("calcule chaque année indépendamment et saute les années absentes du fichier", () => {
    const frames = buildAnnualFrames([incident(1992, "10"), incident(1994, "2")],
      [1992, 1994, 1995], filters, "country", "deaths", 1, false);
    expect(frames.map((frame) => frame!.year)).toEqual([1992, 1994, 1995]);
    expect(frames[0]!.ranking[0]!.deaths).toBe(10);
    expect(frames[1]!.ranking[0]!.deaths).toBe(2);
    expect(frames[2]!.ranking).toEqual([]);
  });

  it("conserve les années observées même si aucun incident ne correspond aux filtres", () => {
    const frames = buildAnnualFrames([incident(1992, "")], [1992, 1994],
      { ...filters, categories: { country: "B" } }, "country", "attacks", 1, false);
    expect(frames).toHaveLength(2);
    expect(frames.every((frame) => frame!.incidents.length === 0)).toBe(true);
  });

  it("applique le minimum par année et distingue les valeurs inconnues", () => {
    const frames = buildAnnualFrames([incident(1992, ""), incident(1994, "0")],
      [1992, 1994], filters, "country", "deaths", 1, false);
    expect(frames[0]!.unknownDeaths).toBe(1);
    expect(frames[0]!.ranking).toEqual([]);
    expect(frames[1]!.ranking[0]!.deaths).toBe(0);
    expect(buildAnnualFrames([incident(1992, "1"), incident(1994, "1")],
      [1992, 1994], filters, "country", "attacks", 2, false)
      .every((frame) => frame!.ranking.length === 0)).toBe(true);
  });

  it("retourne une séquence vide pour une période inversée", () => {
    expect(buildAnnualFrames([incident(1992, "1")], [1992, 1994],
      { ...filters, startYear: 1995, endYear: 1992 }, "country", "attacks", 1, false)).toEqual([]);
  });
});
