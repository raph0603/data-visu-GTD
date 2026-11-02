import {
  aggregateIncidents, filterIncidents, sortRankings,
  type CategoryGroup, type Dimension, type Filters, type Incident, type Metric, type RankingRow,
} from "./rankings";

export type AnnualFrame = {
  year: number;
  incidents: Incident[];
  ranking: RankingRow[];
  unknownDeaths: number;
  unknownInjuries: number;
};

export const temporalAggregations = {
  year: "Par année",
  fiveYears: "Par périodes de 5 ans",
  decade: "Par décennie",
  period: "Toute la période sélectionnée",
};

export type TemporalAggregation = keyof typeof temporalAggregations;
export type TimelineFrame = AnnualFrame & {
  startYear: number;
  endYear: number;
  periodLabel: string;
  missingYears: number[];
};

export function buildAnnualFrames(
  incidents: Incident[], years: number[], filters: Filters,
  dimension: Dimension, metric: Metric, minimumAttacks: number, excludeUnknown: boolean,
): AnnualFrame[] {
  return buildTimelineFrames(incidents, years, filters, dimension, metric, minimumAttacks, excludeUnknown, "year");
}

export function buildTimelineFrames(
  incidents: Incident[], years: number[], filters: Filters,
  dimension: Dimension, metric: Metric, minimumAttacks: number, excludeUnknown: boolean,
  aggregation: TemporalAggregation,
  categoryGroups: CategoryGroup[] = [],
): TimelineFrame[] {
  const availableYears = [...new Set(years)].filter((year) => year >= filters.startYear && year <= filters.endYear)
    .sort((a, b) => a - b);
  if (!availableYears.length) return [];
  const size = aggregation === "fiveYears" ? 5 : aggregation === "decade" ? 10 : 1;
  const periodStart = (year: number) => aggregation === "period" ? filters.startYear
    : Math.max(filters.startYear, Math.floor(year / size) * size);
  const buckets = new Map<number, Incident[]>();
  for (const year of availableYears) buckets.set(periodStart(year), []);
  for (const incident of filterIncidents(incidents, filters)) {
    buckets.get(periodStart(incident.year))?.push(incident);
  }
  const observedYears = new Set(availableYears);
  return [...buckets].map(([startYear, selected]) => {
    const endYear = aggregation === "period" ? filters.endYear
      : Math.min(filters.endYear, Math.floor(startYear / size) * size + size - 1);
    return {
      year: startYear, startYear, endYear,
      periodLabel: startYear === endYear ? String(startYear) : `${startYear}–${endYear}`,
      missingYears: Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index)
        .filter((year) => !observedYears.has(year)),
      incidents: selected,
      ranking: sortRankings(aggregateIncidents(selected, dimension, excludeUnknown, categoryGroups), metric, minimumAttacks),
      unknownDeaths: selected.filter((incident) => incident.deaths === null).length,
      unknownInjuries: selected.filter((incident) => incident.injuries === null).length,
    };
  });
}
