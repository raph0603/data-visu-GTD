import { json } from 'd3';
import type { YearRange } from '../../core/state';
import populationUrl from './population.json?url';

/**
 * Yearly population of the drawable countries and of the world ("WLD"), from the World Bank
 * (SP.POP.TOTL, CC BY 4.0), written by preprocess/population.py (D21). The GTD has no population:
 * it is what rates per million inhabitants need. A missing year is null, never 0.
 */
export interface PopulationFile {
  readonly schemaVersion: 1;
  readonly source: string;
  readonly license: string;
  readonly url: string;
  readonly retrieved: string | null;
  readonly years: { readonly first: number; readonly last: number };
  readonly values: Readonly<Record<string, readonly (number | null)[]>>;
}

export const WORLD = 'WLD';

/** Countries below this mean population over the window are not ranked by rate: one attack would top the list. */
export const MIN_POPULATION_FOR_RATE = 1_000_000;

export class Population {
  constructor(readonly file: PopulationFile) {}

  has(code: string): boolean {
    return this.file.values[code] !== undefined;
  }

  /** Mean population over the years of the window that have a value; NaN without any. */
  mean(code: string, range: YearRange): number {
    const series = this.file.values[code];
    if (series === undefined) return Number.NaN;
    let sum = 0;
    let n = 0;
    for (let year = Math.max(range.from, this.file.years.first); year <= Math.min(range.to, this.file.years.last); year++) {
      const value = series[year - this.file.years.first];
      if (value != null) {
        sum += value;
        n++;
      }
    }
    return n === 0 ? Number.NaN : sum / n;
  }

  /** Population of one year; NaN when unknown. */
  at(code: string, year: number): number {
    return this.file.values[code]?.[year - this.file.years.first] ?? Number.NaN;
  }
}

export function parsePopulation(raw: unknown): PopulationFile {
  const file = raw as Partial<PopulationFile> | null;
  if (file?.schemaVersion !== 1 || typeof file.values !== 'object' || file.values === null || typeof file.years?.first !== 'number') {
    throw new Error('population.json: unexpected format');
  }
  return file as PopulationFile;
}

/** The population table, or null when it cannot be loaded: the rates are then unavailable. */
export function loadPopulation(): Promise<Population | null> {
  return json(populationUrl)
    .then((raw) => new Population(parsePopulation(raw)))
    .catch(() => null);
}

/** A value per million inhabitants; NaN without population (or without value). */
export function perMillion(value: number, population: number): number {
  return Number.isFinite(value) && population > 0 ? (value / population) * 1e6 : Number.NaN;
}
