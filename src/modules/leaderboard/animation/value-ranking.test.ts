import { describe, expect, it } from "vitest";
import { ValueRankingAnimation, type ValueTrack } from "./value-ranking";

function animation(tracks: ValueTrack[], order: string[], limit = tracks.length) {
  return new ValueRankingAnimation(tracks, 1000, limit, order,
    new Map(order.map((category, rank) => [category, Math.min(rank, limit)])),
    new Map(order.map((category, rank) => [category, rank < limit ? 1 : 0])));
}

describe("dépassements pendant le classement animé", () => {
  it("attend un dépassement strict avant de monter ou de descendre", () => {
    const scene = animation([
      { category: "A", start: 100, end: 0, presentAtEnd: true },
      { category: "B", start: 0, end: 100, presentAtEnd: true },
    ], ["A", "B"]);
    for (const progress of [0, 0.4, 0.5, 0.501]) {
      const rows = scene.sample(progress);
      expect(rows.map((row) => row!.category)).toEqual(["A", "B"]);
      expect(rows[0]!.position).toBe(0);
      expect(rows[1]!.position).toBe(1);
    }
    expect(scene.sample(0.51).map((row) => row!.category)).toEqual(["B", "A"]);
    const moving = scene.sample(0.6);
    expect(moving[0]!.position).toBeLessThan(1);
    expect(moving[1]!.position).toBeGreaterThan(0);
    expect(scene.sample(1).map((row) => row!.position)).toEqual([0, 1]);
  });

  it("respecte la même règle pour une transition en sens inverse", () => {
    const scene = animation([
      { category: "A", start: 0, end: 100, presentAtEnd: true },
      { category: "B", start: 100, end: 0, presentAtEnd: true },
    ], ["B", "A"]);
    expect(scene.sample(0.49).map((row) => row!.category)).toEqual(["B", "A"]);
    expect(scene.sample(0.5).map((row) => row!.category)).toEqual(["B", "A"]);
    expect(scene.sample(0.51).map((row) => row!.category)).toEqual(["A", "B"]);
  });

  it("conserve l'ordre lors d'une égalité, même à la fin", () => {
    const scene = animation([
      { category: "Z", start: 100, end: 50, presentAtEnd: true },
      { category: "A", start: 0, end: 50, presentAtEnd: true },
    ], ["Z", "A"]);
    expect(scene.sample(1).map((row) => row!.category)).toEqual(["Z", "A"]);
  });

  it("préserve les égalités visibles lors d'une reprise en cours d'interpolation", () => {
    const scene = animation([
      { category: "A", start: 49.8, end: 40, presentAtEnd: true },
      { category: "B", start: 50.2, end: 60, presentAtEnd: true },
    ], ["A", "B"]);
    expect(scene.sample(0).map((row) => row!.category)).toEqual(["A", "B"]);
    expect(scene.sample(0)[0]!.position).toBe(0);
  });

  it("fait entrer une catégorie seulement lorsqu'elle atteint le top, même entre deux années", () => {
    const scene = animation([
      { category: "A", start: 10, end: 0, presentAtEnd: true },
      { category: "B", start: 0, end: 10, presentAtEnd: true },
      { category: "C", start: 6, end: 6, presentAtEnd: true },
    ], ["A", "C", "B"], 1);
    expect(scene.sample(0).find((row) => row!.category === "C")!.opacity).toBe(0);
    expect(scene.sample(0.3)[0]!.category).toBe("A");
    expect(scene.sample(0.5)[0]!.category).toBe("C");
    expect(scene.sample(0.6).find((row) => row!.category === "C")!.opacity).toBeGreaterThan(0);
    expect(scene.sample(1)[0]!.category).toBe("B");
  });
});
