/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  fetchCountryIncidents,
  fetchCountryYear,
  fetchCube,
  fetchGroupYear,
  fetchMeta,
  fetchRegionYear,
  fetchSummaries,
  fetchTopEvents,
} from "./contracts";
import { YearlyIndex } from "./series";

// Reads the files written by preprocess/preprocess.py, as the browser would
// fetch them from public/.
const publicRoot = new URL("../../public/", import.meta.url);
const readJson = async (url: string) => JSON.parse(readFileSync(new URL(url, publicRoot), "utf8"));
const generated = existsSync(new URL("data/gtd/meta.json", publicRoot));
const title = generated
  ? "generated public/data/gtd"
  : "generated public/data/gtd (SKIPPED: run python preprocess/preprocess.py first)";

describe.skipIf(!generated)(title, () => {
  it("passes fetchMeta", async () => {
    const meta = await fetchMeta("gtd", readJson);
    expect(meta.build.kind).toBe("preprocessed");
  });

  it("builds a YearlyIndex from country_year.json", async () => {
    const meta = await fetchMeta("gtd", readJson);
    const index = new YearlyIndex(await fetchCountryYear("gtd", meta, readJson));
    const { first, last } = meta.years;

    expect(index.gaps).toEqual(meta.years.gaps);
    const mapped = index.keys.reduce(
      (sum, key) => sum + index.window(key, "incidents", first, last),
      0,
    );
    expect(mapped).toBe(meta.rows.total - meta.rows.withoutGeo);
    for (const gap of meta.years.gaps) {
      expect(index.value("IRQ", "incidents", gap)).toBeNaN();
    }
  });

  it("counts every incident once in group_year.json and in cube.json", async () => {
    const meta = await fetchMeta("gtd", readJson);
    const { first, last } = meta.years;
    const groups = new YearlyIndex(await fetchGroupYear("gtd", meta, readJson));
    const byGroup = groups.keys.reduce((sum, key) => sum + groups.window(key, "incidents", first, last), 0);
    expect(byGroup).toBe(meta.rows.total);

    const cube = await fetchCube("gtd", meta, readJson);
    expect(cube.columns.incidents.reduce((sum, n) => sum + n, 0)).toBe(meta.rows.total);
  });

  it("validates region_year.json, top_events.json and every incidents and summaries file", async () => {
    const meta = await fetchMeta("gtd", readJson);
    const countries = await fetchCountryYear("gtd", meta, readJson);
    await fetchRegionYear("gtd", meta, readJson);
    await fetchTopEvents("gtd", meta, readJson);
    for (const iso3 of Object.keys(countries.entities)) {
      await fetchCountryIncidents("gtd", iso3, meta, readJson);
      await fetchSummaries("gtd", iso3, readJson);
    }
  });
});
