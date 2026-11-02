import { describe, expect, it } from "vitest";
import { closestFrameIndex, interpolateSummaryPoint, summarizeFrames } from "./timeline-summary";
import { buildAnnualFrames, buildTimelineFrames } from "./timeline";
import { parseIncident, type Filters } from "./rankings";

const filters: Filters = {
  startYear: 1992, endYear: 1994, categories: {}, flags: {},
  knownDeathsOnly: false, knownInjuriesOnly: false,
};
const rows = [parseIncident({ year: "1992", country: "A", killed: "10", wounded: "0" }),
  parseIncident({ year: "1992", country: "B", killed: "4", wounded: "0" }),
  parseIncident({ year: "1994", country: "A", killed: "3", wounded: "0" })];
const frames = buildAnnualFrames(rows, [1992, 1994], filters, "country", "deaths", 1, false);

describe("courbe de la somme annuelle", () => {
  it("additionne les valeurs des barres affichées et conserve les années absentes comme trous", () => {
    expect(summarizeFrames(frames, "deaths", Infinity)).toEqual([
      { year: 1992, value: 14 }, { year: 1993, value: null }, { year: 1994, value: 3 },
    ]);
    expect(summarizeFrames(frames, "deaths", 1)[0]!.value).toBe(10);
  });

  it("ne remplace pas des indicateurs inconnus par des zéros", () => {
    const unknown = buildAnnualFrames([parseIncident({ year: "1992", country: "A", killed: "" })],
      [1992, 1994], filters, "country", "deaths", 1, false);
    expect(summarizeFrames(unknown, "deaths", 10)).toEqual([
      { year: 1992, value: null }, { year: 1993, value: null }, { year: 1994, value: 0 },
    ]);
  });

  it("gère une période vide et choisit une année disponible au clic", () => {
    expect(summarizeFrames([], "attacks", 10)).toEqual([]);
    expect(closestFrameIndex(frames, 1993.6)).toBe(1);
    expect(closestFrameIndex(frames, 1900)).toBe(0);
    expect(closestFrameIndex(frames, 2100)).toBe(1);
    expect(closestFrameIndex(frames, 1993, 1992)).toBe(1);
    expect(closestFrameIndex(frames, 1993, 1994)).toBe(0);
  });

  it("interpole les trous pour l'affichage sans modifier les données ni extrapoler", () => {
    const points = summarizeFrames(frames, "deaths", Infinity);
    expect(interpolateSummaryPoint(points, 1993)).toEqual({ year: 1993, value: 8.5, interpolated: true });
    expect(interpolateSummaryPoint(points, 1992)).toEqual({ year: 1992, value: 14, interpolated: false });
    expect(interpolateSummaryPoint(points, 1991).value).toBeNull();
    expect(points[1]!.value).toBeNull();
  });

  it("utilise une seule somme par période agrégée et conserve son libellé", () => {
    const grouped = buildTimelineFrames(rows, [1992, 1994], filters,
      "country", "deaths", 1, false, "period");
    expect(summarizeFrames(grouped, "deaths", Infinity)).toEqual([
      { year: 1992, value: 17, label: "1992–1994" },
    ]);
    expect(summarizeFrames(grouped, "deaths", 1)[0]!.value).toBe(13);
    expect(grouped[0]!.missingYears).toEqual([1993]!);
  });
});
