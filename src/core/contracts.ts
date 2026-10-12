/**
 * Data contracts: one interface per JSON file produced by the preprocessing step (Phase 2) or by
 * the dataset adapter for another CSV. Views read ONLY these shapes; no source column name appears here.
 *
 * Layout under public/data/<datasetId>/:
 *   meta.json                 DatasetMeta
 *   agg/<dim>_year.json       YearlyEntitySeries   (one file per dim listed in DatasetMeta.yearlyDims)
 *   top_events.json           TopEventsFile
 *   incidents/<geoId>.json    IncidentTable        (lazy, one file per geographic entity)
 *   flow.json                 FlowCube             (lazy, categorical cube for the flow view)
 *
 * Every file carries `schemaVersion`. Bump it on any breaking change; the loader rejects a mismatch.
 */

export const SCHEMA_VERSION = 1 as const;

/** Marks a missing numeric value in integer columns (JSON cannot carry NaN). */
export const UNKNOWN = -1 as const;

/* ------------------------------------------------------------------ meta */

export interface DimensionDef {
  /** Stable machine id used in state, URLs and file names (lowercase, [a-z0-9_]). */
  readonly id: string;
  readonly label: string;
}

/**
 * - count: number of rows (exactly one per dataset). Always fully known.
 * - sum:   sum of a numeric column; some rows may have no value (tracked in `known`).
 * - mean:  sum(of) / known(of), i.e. average over rows where the value exists (never a mean of means).
 */
export type MetricDef =
  | { readonly id: string; readonly label: string; readonly unit: string; readonly kind: 'count' }
  | { readonly id: string; readonly label: string; readonly unit: string; readonly kind: 'sum' }
  | { readonly id: string; readonly label: string; readonly unit: string; readonly kind: 'mean'; readonly of: string };

export type BuildInfo =
  | { readonly kind: 'dev-stub' }
  | { readonly kind: 'preprocessed'; readonly generatedAt: string; readonly sourceRows: number };

export interface QualityReport {
  readonly rows: number;
  /** Rows whose geographic entity has no polygon (historical states, unmapped names). */
  readonly rowsWithoutGeo: number;
  readonly rowsWithoutCoordinates: number;
  /** Share (0..1) of rows with an unknown actor, by dimension id. */
  readonly unknownShare: Readonly<Record<string, number>>;
  /** Share (0..1) of rows with a known value, by sum-metric id. */
  readonly knownShare: Readonly<Record<string, number>>;
}

export interface DatasetMeta {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  /** null until copied from the source page; never invented. */
  readonly citation: string | null;
  readonly license: string | null;
  readonly build: BuildInfo;
  readonly years: {
    readonly first: number;
    readonly last: number;
    /** Years inside [first,last] with no collected data. They must never be displayed as zero. */
    readonly gaps: readonly number[];
  };
  /** The dimension drawn as polygons on maps; `parentDim` groups it (country → region). */
  readonly geo: { readonly dim: string; readonly idSpace: 'iso3'; readonly parentDim: string | null };
  readonly dimensions: readonly DimensionDef[];
  readonly metrics: readonly MetricDef[];
  /** Dimensions that have an agg/<dim>_year.json file (candidates for leaderboard entities). */
  readonly yearlyDims: readonly string[];
  readonly quality: QualityReport | null;
}

/* ------------------------------------------------------- agg/<dim>_year */

export interface EntityRow {
  /** Geo dim: ISO 3166-1 alpha-3 (or the policy code from the mapping table). Others: slug. */
  readonly id: string;
  readonly label: string;
  /** Id in the geo parent dimension (country → region), null otherwise. */
  readonly parent: string | null;
  /** metricId → one value per year from firstYear to lastYear. Present for count and sum metrics. */
  readonly sum: Readonly<Record<string, readonly number[]>>;
  /** metricId → rows with a known value per year. Present for sum metrics only (a count is always known). */
  readonly known: Readonly<Record<string, readonly number[]>>;
}

export interface YearlyEntitySeries {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly dim: string;
  readonly firstYear: number;
  readonly lastYear: number;
  readonly entities: readonly EntityRow[];
}

/* ------------------------------------------------------------ top_events */

export interface EventSummary {
  readonly id: string;
  readonly year: number;
  /** 0 when unknown. */
  readonly month: number;
  readonly label: string;
  readonly measures: Readonly<Record<string, number>>;
  /** dimension id → label (actor, attack type, target type...). */
  readonly dims: Readonly<Record<string, string>>;
  readonly summary: string | null;
}

export interface TopEventsFile {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  /** Metric id used to rank events inside each entity. */
  readonly rankedBy: string;
  readonly limit: number;
  /** Geo entity id → events, most severe first. */
  readonly byGeo: Readonly<Record<string, readonly EventSummary[]>>;
}

/* ------------------------------------------------- incidents/<geoId> */

/**
 * Columnar layout: all arrays have length `n` and are aligned by index. Rows without coordinates are
 * excluded here and counted in `withoutCoordinates` (they still count in the yearly aggregates).
 */
export interface IncidentTable {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly geoId: string;
  readonly n: number;
  readonly withoutCoordinates: number;
  readonly id: readonly string[];
  readonly year: readonly number[];
  readonly month: readonly number[];
  readonly lon: readonly number[];
  readonly lat: readonly number[];
  /** sum-metric id → value per incident, UNKNOWN (-1) when missing. */
  readonly measures: Readonly<Record<string, readonly number[]>>;
  /** dimension id → dictionary-coded labels. */
  readonly dims: Readonly<Record<string, { readonly dict: readonly string[]; readonly code: readonly number[] }>>;
  /** Optional free text; Phase 2 decides from the measured size whether it ships. */
  readonly text?: { readonly place: readonly string[]; readonly summary: readonly string[] };
}

/* ---------------------------------------------------------------- flow */

/**
 * Sparse categorical cube for flow/alluvial views.
 * Row layout: [yearOffset, code_0 .. code_(d-1), value_0 .. value_(m-1)]
 * with d = dims.length, m = measures.length, yearOffset = year - firstYear.
 */
export interface FlowCube {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly firstYear: number;
  readonly lastYear: number;
  readonly dims: readonly string[];
  readonly dict: readonly (readonly string[])[];
  readonly measures: readonly string[];
  readonly rows: readonly (readonly number[])[];
}
