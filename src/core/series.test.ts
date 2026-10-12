import { describe, expect, it } from "vitest";
import type { YearlyFile } from "./contracts";
import { YearlyIndex } from "./series";

// 1990-1995, 1993 has no data at all (null everywhere).
//            1990 1991 1992 1993  1994 1995
// incidents     2    0    1  null    3    0
// killed sum    5    0    0  null    2    0
// killed known  2    0    0  null    1    0
const file: YearlyFile = {
  schemaVersion: 1,
  years: { first: 1990, last: 1995 },
  entities: {
    AAA: {
      label: "Aaa",
      incidents: [2, 0, 1, null, 3, 0],
      killed: { sum: [5, 0, 0, null, 2, 0], known: [2, 0, 0, null, 1, 0] },
      wounded: { sum: [0, 0, 0, null, 0, 0], known: [2, 0, 1, null, 3, 0] },
    },
  },
};
const index = new YearlyIndex(file);

describe("YearlyIndex.value", () => {
  it("returns the measured count of a year", () => {
    expect(index.value("AAA", "incidents", 1990)).toBe(2);
    expect(index.value("AAA", "incidents", 1994)).toBe(3);
  });

  it("returns 0 for a year with data but no incident", () => {
    expect(index.value("AAA", "incidents", 1991)).toBe(0);
    expect(index.value("AAA", "killed", 1991)).toBe(0);
  });

  it("returns NaN for a year without any data", () => {
    expect(index.value("AAA", "incidents", 1993)).toBeNaN();
    expect(index.value("AAA", "killed", 1993)).toBeNaN();
  });

  it("returns NaN outside the covered years", () => {
    expect(index.value("AAA", "incidents", 1989)).toBeNaN();
    expect(index.value("AAA", "incidents", 1996)).toBeNaN();
  });

  it("returns NaN when incidents exist but no casualty value is known", () => {
    expect(index.value("AAA", "killed", 1992)).toBeNaN();
  });

  it("returns the sum of known casualties when some are known", () => {
    expect(index.value("AAA", "killed", 1994)).toBe(2);
  });

  it("returns a measured 0 for known casualties that sum to zero", () => {
    expect(index.value("AAA", "wounded", 1990)).toBe(0);
  });

  it("returns NaN for an entity absent from the file", () => {
    expect(index.value("ZZZ", "incidents", 1990)).toBeNaN();
  });
});

describe("YearlyIndex.window", () => {
  it("sums a window and skips the years without data", () => {
    expect(index.window("AAA", "incidents", 1990, 1995)).toBe(6);
    expect(index.window("AAA", "incidents", 1992, 1994)).toBe(4);
  });

  it("returns NaN for a window made only of years without data", () => {
    expect(index.window("AAA", "incidents", 1993, 1993)).toBeNaN();
  });

  it("clips the window to the covered years", () => {
    expect(index.window("AAA", "incidents", 1985, 1991)).toBe(2);
    expect(index.window("AAA", "incidents", 1996, 2000)).toBeNaN();
  });

  it("applies the casualty rules to the whole window", () => {
    expect(index.window("AAA", "killed", 1990, 1992)).toBe(5);
    expect(index.window("AAA", "killed", 1991, 1992)).toBeNaN();
    expect(index.window("AAA", "killed", 1991, 1991)).toBe(0);
  });

  it("rejects a window whose start is after its end", () => {
    expect(() => index.window("AAA", "incidents", 1994, 1990)).toThrow(RangeError);
  });
});

describe("YearlyIndex.knownShare", () => {
  it("returns the share of incidents whose casualty value is known", () => {
    // known 2 + 0 + 0 + 1 + 0 = 3 out of 2 + 0 + 1 + 3 + 0 = 6 incidents.
    expect(index.knownShare("AAA", "killed", 1990, 1995)).toBe(0.5);
  });

  it("returns NaN when the window has no incident", () => {
    expect(index.knownShare("AAA", "killed", 1991, 1991)).toBeNaN();
  });

  it("returns 1 for the incidents metric", () => {
    expect(index.knownShare("AAA", "incidents", 1990, 1995)).toBe(1);
  });
});

describe("YearlyIndex.mean", () => {
  it("divides the known sum by the number of known values, not by the incidents", () => {
    // killed: (5 + 0 + 0 + 2 + 0) / (2 + 0 + 0 + 1 + 0) known values.
    expect(index.mean("AAA", "killed", 1990, 1995)).toBeCloseTo(7 / 3, 12);
  });

  it("is not a mean of yearly means", () => {
    // Yearly means 2.5 (1990) and 2 (1994) would average to 2.25.
    expect(index.mean("AAA", "killed", 1990, 1994)).toBeCloseTo(7 / 3, 12);
  });

  it("returns NaN when no value is known or the window has no data", () => {
    expect(index.mean("AAA", "killed", 1992, 1992)).toBeNaN(); // 1 incident, deaths unknown
    expect(index.mean("AAA", "killed", 1991, 1991)).toBeNaN(); // no incident: no mean
    expect(index.mean("AAA", "killed", 1993, 1993)).toBeNaN(); // year without data
  });
});

describe("YearlyIndex metadata", () => {
  it("exposes the covered years, the gaps and the keys", () => {
    expect([index.first, index.last]).toEqual([1990, 1995]);
    expect(index.gaps).toEqual([1993]);
    expect(index.keys).toEqual(["AAA"]);
  });
});
