import { SCHEMA_VERSION, type DatasetMeta, type MetricDef } from './contracts';

/** Raised for any malformed data file; `path` points at the offending field. */
export class DatasetError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'DatasetError';
  }
}

function fail(path: string, message: string): never {
  throw new DatasetError(path, message);
}

function obj(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'objet attendu');
  return value as Record<string, unknown>;
}

function arr(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(path, 'tableau attendu');
  return value;
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(path, 'chaîne non vide attendue');
  return value;
}

function nullableStr(value: unknown, path: string): string | null {
  if (value === null) return null;
  return str(value, path);
}

function int(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) fail(path, 'entier attendu');
  return value;
}

const ID = /^[a-z][a-z0-9_]*$/;

function id(value: unknown, path: string): string {
  const s = str(value, path);
  if (!ID.test(s)) fail(path, `identifiant [a-z][a-z0-9_]* attendu, reçu "${s}"`);
  return s;
}

function parseMetric(value: unknown, path: string): MetricDef {
  const o = obj(value, path);
  const base = { id: id(o.id, `${path}.id`), label: str(o.label, `${path}.label`), unit: str(o.unit, `${path}.unit`) };
  const kind = o.kind;
  if (kind === 'count' || kind === 'sum') return { ...base, kind };
  if (kind === 'mean') return { ...base, kind, of: id(o.of, `${path}.of`) };
  return fail(`${path}.kind`, 'count | sum | mean attendu');
}

/**
 * Runtime validation of meta.json, the entry point of every dataset. Throws DatasetError with the
 * path of the first problem so that a wrong adapter mapping is reported precisely.
 */
export function parseDatasetMeta(input: unknown): DatasetMeta {
  const o = obj(input, 'meta');
  if (o.schemaVersion !== SCHEMA_VERSION) {
    fail('meta.schemaVersion', `version ${String(o.schemaVersion)} non supportée (attendu ${SCHEMA_VERSION})`);
  }

  const years = obj(o.years, 'meta.years');
  const first = int(years.first, 'meta.years.first');
  const last = int(years.last, 'meta.years.last');
  if (first > last) fail('meta.years', `first (${first}) > last (${last})`);
  const gaps = arr(years.gaps, 'meta.years.gaps').map((g, i) => {
    const y = int(g, `meta.years.gaps[${i}]`);
    if (y < first || y > last) fail(`meta.years.gaps[${i}]`, `${y} hors de [${first}, ${last}]`);
    return y;
  });

  const dimensions = arr(o.dimensions, 'meta.dimensions').map((d, i) => {
    const p = `meta.dimensions[${i}]`;
    const r = obj(d, p);
    return { id: id(r.id, `${p}.id`), label: str(r.label, `${p}.label`) };
  });
  const dimIds = new Set(dimensions.map((d) => d.id));
  if (dimIds.size !== dimensions.length) fail('meta.dimensions', 'identifiants dupliqués');

  const metrics = arr(o.metrics, 'meta.metrics').map((m, i) => parseMetric(m, `meta.metrics[${i}]`));
  const metricIds = new Set(metrics.map((m) => m.id));
  if (metricIds.size !== metrics.length) fail('meta.metrics', 'identifiants dupliqués');
  const counts = metrics.filter((m) => m.kind === 'count').length;
  if (counts !== 1) fail('meta.metrics', `exactement une métrique "count" attendue, ${counts} trouvée(s)`);
  for (const m of metrics) {
    if (m.kind !== 'mean') continue;
    const target = metrics.find((x) => x.id === m.of);
    if (target?.kind !== 'sum') fail(`meta.metrics.${m.id}.of`, `"${m.of}" doit désigner une métrique "sum"`);
  }

  const geo = obj(o.geo, 'meta.geo');
  const geoDim = id(geo.dim, 'meta.geo.dim');
  if (!dimIds.has(geoDim)) fail('meta.geo.dim', `dimension "${geoDim}" inconnue`);
  if (geo.idSpace !== 'iso3') fail('meta.geo.idSpace', '"iso3" attendu');
  const parentDim = geo.parentDim === null ? null : id(geo.parentDim, 'meta.geo.parentDim');
  if (parentDim !== null && !dimIds.has(parentDim)) fail('meta.geo.parentDim', `dimension "${parentDim}" inconnue`);

  const yearlyDims = arr(o.yearlyDims, 'meta.yearlyDims').map((d, i) => {
    const v = id(d, `meta.yearlyDims[${i}]`);
    if (!dimIds.has(v)) fail(`meta.yearlyDims[${i}]`, `dimension "${v}" inconnue`);
    return v;
  });
  if (!yearlyDims.includes(geoDim)) fail('meta.yearlyDims', `doit contenir la dimension géographique "${geoDim}"`);

  const build = obj(o.build, 'meta.build');
  let parsedBuild: DatasetMeta['build'];
  if (build.kind === 'dev-stub') {
    parsedBuild = { kind: 'dev-stub' };
  } else if (build.kind === 'preprocessed') {
    parsedBuild = { kind: 'preprocessed', generatedAt: str(build.generatedAt, 'meta.build.generatedAt'), sourceRows: int(build.sourceRows, 'meta.build.sourceRows') };
  } else {
    return fail('meta.build.kind', 'dev-stub | preprocessed attendu');
  }

  let quality: DatasetMeta['quality'] = null;
  if (o.quality !== null && o.quality !== undefined) {
    const q = obj(o.quality, 'meta.quality');
    const shares = (v: unknown, path: string): Record<string, number> => {
      const r = obj(v, path);
      const out: Record<string, number> = {};
      for (const [k, x] of Object.entries(r)) {
        if (typeof x !== 'number' || x < 0 || x > 1) fail(`${path}.${k}`, 'proportion dans [0,1] attendue');
        out[k] = x;
      }
      return out;
    };
    quality = {
      rows: int(q.rows, 'meta.quality.rows'),
      rowsWithoutGeo: int(q.rowsWithoutGeo, 'meta.quality.rowsWithoutGeo'),
      rowsWithoutCoordinates: int(q.rowsWithoutCoordinates, 'meta.quality.rowsWithoutCoordinates'),
      unknownShare: shares(q.unknownShare, 'meta.quality.unknownShare'),
      knownShare: shares(q.knownShare, 'meta.quality.knownShare'),
    };
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    id: id(o.id, 'meta.id'),
    name: str(o.name, 'meta.name'),
    citation: nullableStr(o.citation, 'meta.citation'),
    license: nullableStr(o.license, 'meta.license'),
    build: parsedBuild,
    years: { first, last, gaps },
    geo: { dim: geoDim, idSpace: 'iso3', parentDim },
    dimensions,
    metrics,
    yearlyDims,
    quality,
  };
}
