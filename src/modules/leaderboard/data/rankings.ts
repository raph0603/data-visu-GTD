export type DataRow = Record<string, string>;

export const dimensions = {
  country: "Pays",
  region: "Régions",
  group: "Groupes",
  attackType: "Types d'attaque",
  weaponType: "Armes",
  targetType: "Cibles",
  province: "Provinces / États",
  city: "Villes",
  weaponSubtype: "Sous-types d'armes",
  targetSubtype: "Sous-types de cibles",
};

export type Dimension = keyof typeof dimensions;
export type Flag = "suicide" | "success" | "doubt";

export const metrics = {
  attacks: "Nombre d'attaques",
  deaths: "Morts connus",
  averageDeaths: "Morts moyens par incident renseigné",
  injuries: "Blessés connus",
  averageInjuries: "Blessés moyens par incident renseigné",
  casualties: "Morts + blessés (incidents renseignés)",
  averageCasualties: "Morts + blessés moyens par incident renseigné",
  suicideAttacks: "Nombre d'attaques-suicides",
  successRate: "Taux de réussite GTD (%)",
};

export type Metric = keyof typeof metrics;

export type CategoryGroup = { name: string; members: string[] };

export type Incident = {
  values: DataRow;
  year: number;
  deaths: number | null;
  injuries: number | null;
  suicide: number | null;
  success: number | null;
  doubt: number | null;
};

export type Filters = {
  startYear: number;
  endYear: number;
  categories: Partial<Record<Dimension, string>>;
  flags: Partial<Record<Flag, "" | "0" | "1" | "unknown">>;
  knownDeathsOnly: boolean;
  knownInjuriesOnly: boolean;
};

export type RankingRow = {
  category: string;
  attacks: number;
  deaths: number | null;
  injuries: number | null;
  casualties: number | null;
  averageDeaths: number | null;
  averageInjuries: number | null;
  averageCasualties: number | null;
  suicideAttacks: number | null;
  successRate: number | null;
  knownDeathIncidents: number;
  knownInjuryIncidents: number;
  knownCasualtyIncidents: number;
  knownSuicideIncidents: number;
  knownSuccessIncidents: number;
  unknownDeathIncidents: number;
  unknownInjuryIncidents: number;
};

function numericValue(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function flagValue(value: string | undefined): number | null {
  return value === "0" ? 0 : value === "1" ? 1 : null;
}

export function parseIncident(values: DataRow): Incident {
  return {
    values,
    year: Number(values.year),
    deaths: numericValue(values.killed),
    injuries: numericValue(values.wounded),
    suicide: flagValue(values.suicide),
    success: flagValue(values.success),
    doubt: flagValue(values.doubt),
  };
}

export function filterIncidents(incidents: Incident[], filters: Filters): Incident[] {
  const categories = Object.entries(filters.categories) as [Dimension, string][];
  const flags = Object.entries(filters.flags) as [Flag, string][];
  return incidents.filter((incident) => {
    if (incident.year < filters.startYear || incident.year > filters.endYear) return false;
    if (filters.knownDeathsOnly && incident.deaths === null) return false;
    if (filters.knownInjuriesOnly && incident.injuries === null) return false;
    if (categories.some(([column, value]) => value && incident.values[column] !== value)) return false;
    return flags.every(([flag, value]) =>
      value === "" || (value === "unknown" ? incident[flag] === null : incident[flag] === Number(value)),
    );
  });
}

export function incidentCategory(incident: Incident, dimension: Dimension): string {
  const label = incident.values[dimension]?.trim() || "Unknown";
  return dimension === "city" ? `${label} (${incident.values.province}, ${incident.values.country})`
    : dimension === "province" ? `${label} (${incident.values.country})` : label;
}

export function aggregateIncidents(
  incidents: Incident[], dimension: Dimension, excludeUnknown = false, categoryGroups: CategoryGroup[] = [],
): RankingRow[] {
  const membership = new Map<string, string>();
  for (const group of categoryGroups) {
    for (const member of group.members) {
      if (membership.has(member)) throw new Error("Une catégorie ne peut appartenir qu'à un seul groupe.");
      membership.set(member, group.name);
    }
  }
  const groups = new Map<string, RankingRow>();
  for (const incident of incidents) {
    const label = incident.values[dimension]?.trim() || "Unknown";
    if (excludeUnknown && label.toLowerCase() === "unknown") continue;
    const originalCategory = incidentCategory(incident, dimension);
    const category = membership.get(originalCategory) ?? originalCategory;
    let totals = groups.get(category);
    if (!totals) {
      totals = {
        category, attacks: 0, deaths: 0, injuries: 0, casualties: 0,
        averageDeaths: null, averageInjuries: null, averageCasualties: null,
        suicideAttacks: 0, successRate: 0,
        knownDeathIncidents: 0, knownInjuryIncidents: 0, knownCasualtyIncidents: 0,
        knownSuicideIncidents: 0, knownSuccessIncidents: 0,
        unknownDeathIncidents: 0, unknownInjuryIncidents: 0,
      };
      groups.set(category, totals);
    }
    totals.attacks += 1;
    if (incident.deaths !== null) {
      totals.deaths! += incident.deaths;
      totals.knownDeathIncidents += 1;
    } else {
      totals.unknownDeathIncidents += 1;
    }
    if (incident.injuries !== null) {
      totals.injuries! += incident.injuries;
      totals.knownInjuryIncidents += 1;
    } else {
      totals.unknownInjuryIncidents += 1;
    }
    if (incident.deaths !== null && incident.injuries !== null) {
      totals.casualties! += incident.deaths + incident.injuries;
      totals.knownCasualtyIncidents += 1;
    }
    if (incident.suicide !== null) {
      totals.suicideAttacks! += incident.suicide;
      totals.knownSuicideIncidents += 1;
    }
    if (incident.success !== null) {
      totals.successRate! += incident.success;
      totals.knownSuccessIncidents += 1;
    }
  }
  return [...groups.values()].map((totals) => ({
    ...totals,
    deaths: totals.knownDeathIncidents ? totals.deaths : null,
    injuries: totals.knownInjuryIncidents ? totals.injuries : null,
    casualties: totals.knownCasualtyIncidents ? totals.casualties : null,
    averageDeaths: totals.knownDeathIncidents ? totals.deaths! / totals.knownDeathIncidents : null,
    averageInjuries: totals.knownInjuryIncidents ? totals.injuries! / totals.knownInjuryIncidents : null,
    averageCasualties: totals.knownCasualtyIncidents ? totals.casualties! / totals.knownCasualtyIncidents : null,
    suicideAttacks: totals.knownSuicideIncidents ? totals.suicideAttacks : null,
    successRate: totals.knownSuccessIncidents ? 100 * totals.successRate! / totals.knownSuccessIncidents : null,
  }));
}

export function sortRankings(rows: RankingRow[], metric: Metric, minimumAttacks = 1): RankingRow[] {
  return rows.filter((row) => row.attacks >= minimumAttacks && row[metric] !== null)
    .sort((a, b) => b[metric]! - a[metric]! || a.category.localeCompare(b.category));
}
