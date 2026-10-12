import { json } from "d3";

/**
 * Format of every JSON file under public/data/<dataset>/, written by
 * preprocess/preprocess.py, and the validators that check it when it is loaded.
 *
 * Year series are arrays indexed by year - years.first. A year without any row
 * in the source (meta.years.gaps) is null in every series; any other year
 * holds a measured value, possibly 0. Casualty series keep apart the sum of the
 * known values and the number of incidents whose value is known, so that an
 * unknown value is never read as 0.
 */

export const SCHEMA_VERSION = 1;
export const METRICS = ["incidents", "killed", "wounded"] as const;
export type MetricId = (typeof METRICS)[number];
export type CasualtyMetric = Exclude<MetricId, "incidents">;

export type Meta = {
  schemaVersion: 1;
  dataset: { id: string; title: string; citation: string | null; license: string | null };
  build: {
    /** "preprocessed": full source; "extract": a sample used to test another column layout. */
    kind: "preprocessed" | "extract";
    sourceFile: string;
    sourceSha256: string;
    sourceEncoding: string;
  };
  /** gaps: years of [first, last] without any row in the source. */
  years: { first: number; last: number; gaps: number[] };
  rows: {
    total: number;
    /** Rows whose country has no single shape on the map (counted in notRepresentable). */
    withoutGeo: number;
    /** Rows without valid latitude and longitude (counted in aggregates, not drawn as points). */
    withoutCoordinates: number;
  };
  /** Shares of rows, in [0, 1]. */
  quality: {
    killedKnownShare: number;
    woundedKnownShare: number;
    unknownGroupShare: number;
    withoutCoordinatesShare: number;
  };
};

export type YearValues = (number | null)[];
export type CasualtySeries = { sum: YearValues; known: YearValues };

export type EntityYears = {
  label: string;
  incidents: YearValues;
  killed: CasualtySeries;
  wounded: CasualtySeries;
};

export type CountryYears = EntityYears & {
  /** Most frequent source region of the country's incidents; null without incidents. */
  region: string | null;
  withoutCoordinates: YearValues;
};

export type YearlyFile<E extends EntityYears = EntityYears> = {
  schemaVersion: 1;
  years: { first: number; last: number };
  entities: Record<string, E>;
};

/** agg/country_year.json, keyed by ISO alpha-3; every drawable country is present. */
export type CountryYearFile = YearlyFile<CountryYears> & { notRepresentable: EntityYears };

/** agg/region_year.json, keyed by source region label. */
export type RegionYearFile = YearlyFile;

/** agg/group_year.json, keyed by source group name; "Unknown" holds the unattributed incidents. */
export type GroupYearFile = YearlyFile;

export type IncidentSummary = {
  eventId: string;
  year: number;
  month: number | null;
  day: number | null;
  city: string | null;
  killed: number | null;
  wounded: number | null;
  attackType: string;
  group: string;
};

/**
 * top_events.json: for each country, the perYear deadliest incidents of each
 * year, so that the exact top perYear of any window is found among them.
 */
export type TopEventsFile = {
  schemaVersion: 1;
  perYear: number;
  countries: Record<string, IncidentSummary[]>;
};

/** incidents/<iso3>.json: incidents with valid coordinates, column by column. */
export type CountryIncidentsFile = {
  schemaVersion: 1;
  iso3: string;
  count: number;
  /** Incidents of this country left out of the file for lack of valid coordinates. */
  withoutCoordinates: number;
  dictionaries: { attackType: string[]; targetType: string[]; group: string[] };
  columns: {
    eventId: string[];
    year: number[];
    month: (number | null)[];
    day: (number | null)[];
    latitude: number[];
    longitude: number[];
    city: (string | null)[];
    /** Indexes into dictionaries.attackType, targetType and group. */
    attackType: number[];
    targetType: number[];
    group: number[];
    killed: (number | null)[];
    wounded: (number | null)[];
    /** 1 for a suicide attack, else 0. */
    suicide: number[];
  };
};

/**
 * summaries/<iso3>.json: free-text summary by event id, for the incidents of the
 * country that have one (with or without coordinates). Kept out of
 * incidents/<iso3>.json, of which they were 80 % of the weight (D12).
 */
export type SummariesFile = {
  schemaVersion: 1;
  iso3: string;
  summaries: Record<string, string>;
};

export const FLOW_DIMENSIONS = ["country", "attackType", "targetType", "weaponType"] as const;
export type FlowDimension = (typeof FLOW_DIMENSIONS)[number];

/**
 * flow.json: sparse cube year x country x attack type x target type x weapon
 * type, column by column, one row per combination with at least one incident.
 * The country dictionary holds ISO alpha-3 codes and "" for incidents without a
 * representable country, so that the cube sums to every incident.
 */
export type FlowFile = {
  schemaVersion: 1;
  years: { first: number; last: number };
  count: number;
  dictionaries: Record<FlowDimension, string[]>;
  columns: {
    year: number[];
    /** Indexes into dictionaries.country, attackType, targetType and weaponType. */
    country: number[];
    attackType: number[];
    targetType: number[];
    weaponType: number[];
    incidents: number[];
    killedSum: number[];
    killedKnown: number[];
    woundedSum: number[];
    woundedKnown: number[];
  };
};

export class ContractError extends Error {
  override name = "ContractError";
}

const fail = (path: string, message: string): never => {
  throw new ContractError(`${path}: ${message}`);
};

const at = (path: string, key: string | number) => (path ? `${path}.${key}` : String(key));

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(path || "root", "expected an object");
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, path: string, length?: number): unknown[] {
  if (!Array.isArray(value)) return fail(path, "expected an array");
  if (length !== undefined && value.length !== length) {
    return fail(path, `expected ${length} values, got ${value.length}`);
  }
  return value;
}

function text(value: unknown, path: string): string {
  return typeof value === "string" ? value : fail(path, "expected a string");
}

function nullable<T>(check: (value: unknown, path: string) => T) {
  return (value: unknown, path: string): T | null => (value === null ? null : check(value, path));
}

function integer(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    return fail(path, `expected an integer in [${min}, ${max}], got ${String(value)}`);
  }
  return value as number;
}

function amount(value: unknown, path: string, min = 0, max = Number.MAX_VALUE): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    return fail(path, `expected a number in [${min}, ${max}], got ${String(value)}`);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  return allowed.includes(value as T)
    ? (value as T)
    : fail(path, `expected one of ${allowed.join(", ")}, got ${String(value)}`);
}

function schemaVersion(root: Record<string, unknown>): void {
  if (root.schemaVersion !== SCHEMA_VERSION) {
    fail("schemaVersion", `expected ${SCHEMA_VERSION}, got ${String(root.schemaVersion)}`);
  }
}

export function parseMeta(value: unknown): Meta {
  const root = record(value, "");
  schemaVersion(root);

  const dataset = record(root.dataset, "dataset");
  text(dataset.id, "dataset.id");
  text(dataset.title, "dataset.title");
  nullable(text)(dataset.citation, "dataset.citation");
  nullable(text)(dataset.license, "dataset.license");

  const build = record(root.build, "build");
  oneOf(build.kind, ["preprocessed", "extract"], "build.kind");
  text(build.sourceFile, "build.sourceFile");
  if (!/^[0-9a-f]{64}$/.test(text(build.sourceSha256, "build.sourceSha256"))) {
    fail("build.sourceSha256", "expected 64 lowercase hexadecimal characters");
  }
  text(build.sourceEncoding, "build.sourceEncoding");

  const years = record(root.years, "years");
  const first = integer(years.first, "years.first");
  const last = integer(years.last, "years.last", first);
  let previous = first;
  for (const [i, gap] of list(years.gaps, "years.gaps").entries()) {
    previous = integer(gap, `years.gaps.${i}`, previous + 1, last - 1);
  }

  const rows = record(root.rows, "rows");
  const total = integer(rows.total, "rows.total");
  integer(rows.withoutGeo, "rows.withoutGeo", 0, total);
  integer(rows.withoutCoordinates, "rows.withoutCoordinates", 0, total);

  const quality = record(root.quality, "quality");
  for (const key of [
    "killedKnownShare",
    "woundedKnownShare",
    "unknownGroupShare",
    "withoutCoordinatesShare",
  ]) {
    amount(quality[key], `quality.${key}`, 0, 1);
  }
  return value as Meta;
}

function checkYears(root: Record<string, unknown>, meta: Meta): void {
  const years = record(root.years, "years");
  if (years.first !== meta.years.first || years.last !== meta.years.last) {
    fail("years", `expected ${meta.years.first}-${meta.years.last} as in meta.json`);
  }
}

function yearValues(
  value: unknown,
  path: string,
  meta: Meta,
  check: (value: unknown, path: string) => number,
): YearValues {
  const { first, last, gaps } = meta.years;
  const values = list(value, path, last - first + 1);
  values.forEach((entry, i) => {
    const year = first + i;
    if (gaps.includes(year)) {
      if (entry !== null) fail(path, `${year} must be null (no data that year)`);
    } else if (entry === null) {
      fail(path, `${year} must not be null`);
    } else {
      check(entry, `${path}[${year}]`);
    }
  });
  return values as YearValues;
}

function notAbove(values: YearValues, limit: YearValues, path: string, meta: Meta): void {
  values.forEach((entry, i) => {
    if (entry !== null && entry > (limit[i] ?? 0)) {
      fail(path, `${meta.years.first + i} exceeds the number of incidents`);
    }
  });
}

function entityYears(value: unknown, path: string, meta: Meta): Record<string, unknown> {
  const entity = record(value, path);
  text(entity.label, at(path, "label"));
  const incidents = yearValues(entity.incidents, at(path, "incidents"), meta, integer);
  for (const metric of ["killed", "wounded"] as const) {
    const series = record(entity[metric], at(path, metric));
    yearValues(series.sum, at(path, `${metric}.sum`), meta, amount);
    const known = yearValues(series.known, at(path, `${metric}.known`), meta, integer);
    notAbove(known, incidents, at(path, `${metric}.known`), meta);
  }
  return entity;
}

function yearlyFile(value: unknown, meta: Meta): Record<string, unknown> {
  const root = record(value, "");
  schemaVersion(root);
  checkYears(root, meta);
  record(root.entities, "entities");
  return root;
}

export function parseCountryYearFile(value: unknown, meta: Meta): CountryYearFile {
  const root = yearlyFile(value, meta);
  for (const [key, raw] of Object.entries(record(root.entities, "entities"))) {
    const path = `entities.${key}`;
    if (!/^[A-Z]{3}$/.test(key)) fail(path, "expected an ISO alpha-3 key");
    const entity = entityYears(raw, path, meta);
    nullable(text)(entity.region, at(path, "region"));
    const withoutCoordinates = yearValues(
      entity.withoutCoordinates,
      at(path, "withoutCoordinates"),
      meta,
      integer,
    );
    notAbove(withoutCoordinates, entity.incidents as YearValues, at(path, "withoutCoordinates"), meta);
  }
  entityYears(root.notRepresentable, "notRepresentable", meta);
  return value as CountryYearFile;
}

export function parseRegionYearFile(value: unknown, meta: Meta): RegionYearFile {
  const root = yearlyFile(value, meta);
  for (const [key, raw] of Object.entries(record(root.entities, "entities"))) {
    entityYears(raw, `entities.${key}`, meta);
  }
  return value as RegionYearFile;
}

export function parseGroupYearFile(value: unknown, meta: Meta): GroupYearFile {
  return parseRegionYearFile(value, meta);
}

function incidentYear(value: unknown, path: string, meta: Meta): number {
  const year = integer(value, path, meta.years.first, meta.years.last);
  return meta.years.gaps.includes(year) ? fail(path, `${year} has no data`) : year;
}

export function parseTopEventsFile(value: unknown, meta: Meta): TopEventsFile {
  const root = record(value, "");
  schemaVersion(root);
  const perYear = integer(root.perYear, "perYear", 1);
  for (const [iso3, raw] of Object.entries(record(root.countries, "countries"))) {
    const perYearCount = new Map<number, number>();
    for (const [i, rawEvent] of list(raw, `countries.${iso3}`).entries()) {
      const path = `countries.${iso3}.${i}`;
      const event = record(rawEvent, path);
      text(event.eventId, at(path, "eventId"));
      const year = incidentYear(event.year, at(path, "year"), meta);
      nullable((entry, p) => integer(entry, p, 1, 12))(event.month, at(path, "month"));
      nullable((entry, p) => integer(entry, p, 1, 31))(event.day, at(path, "day"));
      nullable(text)(event.city, at(path, "city"));
      nullable(amount)(event.killed, at(path, "killed"));
      nullable(amount)(event.wounded, at(path, "wounded"));
      text(event.attackType, at(path, "attackType"));
      text(event.group, at(path, "group"));
      perYearCount.set(year, (perYearCount.get(year) ?? 0) + 1);
    }
    for (const [year, n] of perYearCount) {
      if (n > perYear) fail(`countries.${iso3}`, `${n} events in ${year} exceed perYear ${perYear}`);
    }
  }
  return value as TopEventsFile;
}

export function parseCountryIncidentsFile(value: unknown, meta: Meta): CountryIncidentsFile {
  const root = record(value, "");
  schemaVersion(root);
  if (!/^[A-Z]{3}$/.test(text(root.iso3, "iso3"))) fail("iso3", "expected an ISO alpha-3 code");
  const n = integer(root.count, "count");
  integer(root.withoutCoordinates, "withoutCoordinates");

  const dictionaries = record(root.dictionaries, "dictionaries");
  const sizes: Record<string, number> = {};
  for (const name of ["attackType", "targetType", "group"]) {
    const entries = list(dictionaries[name], `dictionaries.${name}`);
    entries.forEach((entry, i) => text(entry, `dictionaries.${name}.${i}`));
    sizes[name] = entries.length;
  }

  const columns = record(root.columns, "columns");
  const column = (name: string, check: (value: unknown, path: string) => unknown) =>
    list(columns[name], `columns.${name}`, n).forEach((entry, i) =>
      check(entry, `columns.${name}[${i}]`),
    );
  column("eventId", text);
  column("year", (entry, path) => incidentYear(entry, path, meta));
  column("month", nullable((entry, path) => integer(entry, path, 1, 12)));
  column("day", nullable((entry, path) => integer(entry, path, 1, 31)));
  column("latitude", (entry, path) => amount(entry, path, -90, 90));
  column("longitude", (entry, path) => amount(entry, path, -180, 180));
  column("city", nullable(text));
  for (const name of ["attackType", "targetType", "group"]) {
    column(name, (entry, path) => integer(entry, path, 0, (sizes[name] ?? 0) - 1));
  }
  column("killed", nullable(amount));
  column("wounded", nullable(amount));
  column("suicide", (entry, path) => integer(entry, path, 0, 1));
  return value as CountryIncidentsFile;
}

export function parseSummariesFile(value: unknown): SummariesFile {
  const root = record(value, "");
  schemaVersion(root);
  if (!/^[A-Z]{3}$/.test(text(root.iso3, "iso3"))) fail("iso3", "expected an ISO alpha-3 code");
  for (const [eventId, summary] of Object.entries(record(root.summaries, "summaries"))) {
    text(summary, `summaries.${eventId}`);
  }
  return value as SummariesFile;
}

export function parseFlowFile(value: unknown, meta: Meta): FlowFile {
  const root = record(value, "");
  schemaVersion(root);
  checkYears(root, meta);
  const n = integer(root.count, "count");

  const dictionaries = record(root.dictionaries, "dictionaries");
  const sizes = {} as Record<FlowDimension, number>;
  for (const name of FLOW_DIMENSIONS) {
    const entries = list(dictionaries[name], `dictionaries.${name}`);
    entries.forEach((entry, i) => {
      const label = text(entry, `dictionaries.${name}.${i}`);
      if (name === "country" && !/^([A-Z]{3})?$/.test(label)) {
        fail(`dictionaries.country.${i}`, 'expected an ISO alpha-3 code or ""');
      }
    });
    sizes[name] = entries.length;
  }

  const columns = record(root.columns, "columns");
  const column = (name: string) => list(columns[name], `columns.${name}`, n);
  column("year").forEach((entry, i) => incidentYear(entry, `columns.year[${i}]`, meta));
  for (const name of FLOW_DIMENSIONS) {
    column(name).forEach((entry, i) => integer(entry, `columns.${name}[${i}]`, 0, sizes[name] - 1));
  }
  const incidents = column("incidents").map((entry, i) => integer(entry, `columns.incidents[${i}]`, 1));
  for (const metric of ["killed", "wounded"]) {
    column(`${metric}Sum`).forEach((entry, i) => amount(entry, `columns.${metric}Sum[${i}]`));
    column(`${metric}Known`).forEach((entry, i) =>
      integer(entry, `columns.${metric}Known[${i}]`, 0, incidents[i]),
    );
  }
  return value as FlowFile;
}

export type FetchJson = (url: string) => Promise<unknown>;

export const dataUrl = (dataset: string, file: string): string => `data/${dataset}/${file}`;

async function fetchParsed<T>(url: string, fetchJson: FetchJson, parse: (value: unknown) => T) {
  try {
    return parse(await fetchJson(url));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load "${url}": ${reason}`, { cause: error });
  }
}

export function fetchMeta(dataset: string, fetchJson: FetchJson = json): Promise<Meta> {
  return fetchParsed(dataUrl(dataset, "meta.json"), fetchJson, (value) => {
    const meta = parseMeta(value);
    if (meta.dataset.id !== dataset) {
      fail("dataset.id", `expected "${dataset}", got "${meta.dataset.id}"`);
    }
    return meta;
  });
}

export function fetchCountryYear(dataset: string, meta: Meta, fetchJson: FetchJson = json) {
  return fetchParsed(dataUrl(dataset, "agg/country_year.json"), fetchJson, (value) =>
    parseCountryYearFile(value, meta),
  );
}

export function fetchRegionYear(dataset: string, meta: Meta, fetchJson: FetchJson = json) {
  return fetchParsed(dataUrl(dataset, "agg/region_year.json"), fetchJson, (value) =>
    parseRegionYearFile(value, meta),
  );
}

export function fetchGroupYear(dataset: string, meta: Meta, fetchJson: FetchJson = json) {
  return fetchParsed(dataUrl(dataset, "agg/group_year.json"), fetchJson, (value) =>
    parseGroupYearFile(value, meta),
  );
}

export function fetchFlow(dataset: string, meta: Meta, fetchJson: FetchJson = json) {
  return fetchParsed(dataUrl(dataset, "flow.json"), fetchJson, (value) => parseFlowFile(value, meta));
}

export function fetchTopEvents(dataset: string, meta: Meta, fetchJson: FetchJson = json) {
  return fetchParsed(dataUrl(dataset, "top_events.json"), fetchJson, (value) =>
    parseTopEventsFile(value, meta),
  );
}

export function fetchCountryIncidents(
  dataset: string,
  iso3: string,
  meta: Meta,
  fetchJson: FetchJson = json,
) {
  return fetchParsed(dataUrl(dataset, `incidents/${iso3}.json`), fetchJson, (value) =>
    parseCountryIncidentsFile(value, meta),
  );
}

export function fetchSummaries(dataset: string, iso3: string, fetchJson: FetchJson = json) {
  return fetchParsed(dataUrl(dataset, `summaries/${iso3}.json`), fetchJson, parseSummariesFile);
}
