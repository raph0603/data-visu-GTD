import { json, select } from "d3";
import { loadData, type DataRow } from "./data/loadData";
import {
  aggregateIncidents, dimensions, filterIncidents, metrics, parseIncident, sortRankings,
  type Dimension, type Filters, type Flag, type Metric, type RankingRow,
} from "./data/rankings";
import "./style.css";

type Metadata = {
  sourceColumnCount: number;
  retainedColumns: string[];
  removedDuplicates: number;
  unknownDeathIncidents: number;
  unknownInjuryIncidents: number;
  years: number[];
  missingYears: number[];
};

const app = select<HTMLDivElement, unknown>("#app");
app.append("h1").text("GTD data visualisation");
const status = app.append("p").text("Chargement des données...");
const content = app.append("section");
const numberFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

async function displayData(): Promise<void> {
  try {
    const [rows, metadata] = await Promise.all([
      loadData<DataRow>("data/gtd-clean.csv"),
      json<Metadata>("data/gtd-metadata.json"),
    ]);
    if (!metadata) throw new Error("Le fichier de préparation est vide.");
    const columns = metadata.retainedColumns;
    const incidents = rows.map(parseIncident);
    const years = metadata.years;
    status.text(`${numberFormat.format(rows.length)} événements chargés depuis le CSV nettoyé.`);
    content.append("p").text(
      `${metadata.sourceColumnCount} colonnes initiales → ${columns.length} colonnes conservées. ` +
      `${numberFormat.format(metadata.removedDuplicates)} doublons supprimés. ` +
      `${numberFormat.format(metadata.unknownDeathIncidents)} incidents avec morts inconnus ; ` +
      `${numberFormat.format(metadata.unknownInjuryIncidents)} avec blessés inconnus.`,
    );
    content.append("p").text(
      `Période : ${years[0]}–${years.at(-1)}. Années absentes : ${metadata.missingYears.join(", ") || "aucune"}.`,
    );

    content.append("h2").text("Filtres des incidents");
    const periodControls = content.append("p");
    periodControls.append("label").attr("for", "start-year").text("De : ");
    const startYear = periodControls.append("select").attr("id", "start-year");
    periodControls.append("label").attr("for", "end-year").text(" À : ");
    const endYear = periodControls.append("select").attr("id", "end-year");
    for (const control of [startYear, endYear]) {
      control.selectAll("option").data(years).join("option")
        .attr("value", (year) => year).text((year) => year);
      control.property("value", years.at(-1));
    }
    const filterColumns: Dimension[] = [
      "region_txt", "country_txt", "provstate", "gname", "attacktype1_txt",
      "weaptype1_txt", "weapsubtype1_txt", "targtype1_txt", "targsubtype1_txt",
    ];
    const categoryControls = filterColumns.map((column, index) => {
      const line = index % 3 === 0 ? content.append("p") : content.select<HTMLParagraphElement>("p:last-child");
      line.append("label").attr("for", `filter-${column}`).text(` ${dimensions[column]} : `);
      const control = line.append("select").attr("id", `filter-${column}`).style("max-width", "100%");
      const values = [...new Set(rows.map((row) => row[column]))].sort((a, b) => a.localeCompare(b));
      control.selectAll("option").data(["", ...values]).join("option")
        .attr("value", (value) => value).text((value) => value || "Tous");
      return { column, control };
    });
    const flagLabels: Record<Flag, string> = {
      suicide: "Attaque-suicide", success: "Réussite GTD", doubtterr: "Doute sur la qualification terroriste",
    };
    const flagControls = (Object.entries(flagLabels) as [Flag, string][]).map(([flag, label]) => {
      const line = content.append("p");
      line.append("label").attr("for", `filter-${flag}`).text(`${label} : `);
      const control = line.append("select").attr("id", `filter-${flag}`);
      control.selectAll("option").data([
        ["", "Tous"], ["1", "Oui"], ["0", "Non"], ["unknown", "Non renseigné"],
      ]).join("option").attr("value", ([value]) => value).text(([, value]) => value);
      return { flag, control };
    });
    const knownControls = content.append("p");
    const knownDeaths = knownControls.append("input").attr("type", "checkbox").attr("id", "known-deaths");
    knownControls.append("label").attr("for", "known-deaths").text(" Nombre de morts renseigné uniquement ");
    const knownInjuries = knownControls.append("input").attr("type", "checkbox").attr("id", "known-injuries");
    knownControls.append("label").attr("for", "known-injuries").text(" Nombre de blessés renseigné uniquement ");
    const resetButton = knownControls.append("button").attr("type", "button").text("Réinitialiser les filtres");

    content.append("h2").text("Classement de la sélection");
    const rankingControls = content.append("p");
    rankingControls.append("label").attr("for", "dimension").text("Catégorie : ");
    const dimensionSelect = rankingControls.append("select").attr("id", "dimension");
    dimensionSelect.selectAll("option").data(Object.entries(dimensions)).join("option")
      .attr("value", ([value]) => value).text(([, label]) => label);
    rankingControls.append("label").attr("for", "metric").text(" Indicateur : ");
    const metricSelect = rankingControls.append("select").attr("id", "metric");
    metricSelect.selectAll("option").data(Object.entries(metrics)).join("option")
      .attr("value", ([value]) => value).text(([, label]) => label);
    const limitControls = content.append("p");
    limitControls.append("label").attr("for", "limit").text("Résultats : ");
    const limit = limitControls.append("select").attr("id", "limit");
    limit.selectAll("option").data([["10", "10"], ["20", "20"], ["50", "50"], ["all", "Tous"]])
      .join("option").attr("value", ([value]) => value).text(([, label]) => label);
    limitControls.append("label").attr("for", "minimum-attacks").text(" Minimum d'incidents par catégorie : ");
    const minimumAttacks = limitControls.append("input").attr("id", "minimum-attacks")
      .attr("type", "number").attr("min", "1").attr("step", "1").property("value", 1);
    const excludeUnknown = limitControls.append("input").attr("type", "checkbox").attr("id", "exclude-unknown");
    limitControls.append("label").attr("for", "exclude-unknown").text(" Masquer les catégories Unknown");
    content.append("p").text(
      "Les filtres se combinent avant le calcul. Les moyennes utilisent les incidents renseignés ; morts + blessés utilise les incidents où les deux valeurs sont connues. « — » indique une valeur inconnue.",
    );
    const selectionSummary = content.append("p").attr("aria-live", "polite");
    const rankingTable = content.append("table");
    const rankingHead = rankingTable.append("thead").append("tr");
    const rankingBody = rankingTable.append("tbody");
    content.append("h2").text("Données nettoyées : les 10 premières lignes de la sélection");
    const preview = content.append("table");
    const columnLabels: Record<string, string> = {
      eventid: "Identifiant", iyear: "Année", nkill: "Morts", nwound: "Blessés",
      ...dimensions, ...flagLabels,
    };
    preview.append("thead").append("tr").selectAll("th").data(columns)
      .join("th").text((column) => columnLabels[column] ?? column);
    const previewBody = preview.append("tbody");

    function update(): void {
      const filters: Filters = {
        startYear: Number(startYear.property("value")), endYear: Number(endYear.property("value")),
        categories: Object.fromEntries(categoryControls.map(({ column, control }) => [column, control.property("value")])),
        flags: Object.fromEntries(flagControls.map(({ flag, control }) => [flag, control.property("value")])),
        knownDeathsOnly: Boolean(knownDeaths.property("checked")),
        knownInjuriesOnly: Boolean(knownInjuries.property("checked")),
      };
      const selected = filterIncidents(incidents, filters);
      const dimension = String(dimensionSelect.property("value")) as Dimension;
      const metric = String(metricSelect.property("value")) as Metric;
      const inputMinimum = Number(minimumAttacks.property("value"));
      const minimum = Number.isFinite(inputMinimum) ? Math.max(1, Math.ceil(inputMinimum)) : 1;
      minimumAttacks.property("value", minimum);
      const ranked = sortRankings(aggregateIncidents(selected, dimension, Boolean(excludeUnknown.property("checked"))), metric, minimum);
      const displayed = limit.property("value") === "all" ? ranked : ranked.slice(0, Number(limit.property("value")));
      const missingDeaths = selected.filter((incident) => incident.deaths === null).length;
      const missingInjuries = selected.filter((incident) => incident.injuries === null).length;
      selectionSummary.text(filters.startYear > filters.endYear
        ? "La date de début doit précéder ou être égale à la date de fin."
        : `${numberFormat.format(selected.length)} incidents sélectionnés ; ` +
          `${numberFormat.format(missingDeaths)} avec morts inconnus, ${numberFormat.format(missingInjuries)} avec blessés inconnus. ` +
          `${displayed.length} catégories affichées sur ${ranked.length}. ` +
          (ranked.length ? "" : "Aucun résultat pour ces filtres et cet indicateur."));
      const knownColumn = {
        attacks: "attacks", deaths: "knownDeathIncidents", averageDeaths: "knownDeathIncidents",
        injuries: "knownInjuryIncidents", averageInjuries: "knownInjuryIncidents",
        casualties: "knownCasualtyIncidents", averageCasualties: "knownCasualtyIncidents",
        suicideAttacks: "knownSuicideIncidents", successRate: "knownSuccessIncidents",
      }[metric] as keyof Omit<RankingRow, "category">;
      const displayColumns: [keyof Omit<RankingRow, "category">, string][] = [
        [metric, metrics[metric]], [knownColumn, "Incidents renseignés pour l'indicateur"],
        ["attacks", "Attaques"], ["deaths", "Morts connus"], ["injuries", "Blessés connus"],
        ["averageDeaths", "Morts moyens"], ["averageInjuries", "Blessés moyens"],
        ["unknownDeathIncidents", "Incidents avec morts inconnus"],
        ["unknownInjuryIncidents", "Incidents avec blessés inconnus"],
      ];
      const uniqueColumns = displayColumns.filter(([key], index, all) => all.findIndex(([other]) => other === key) === index);
      rankingHead.selectAll("th").data(["Catégorie", ...uniqueColumns.map(([, label]) => label)])
        .join("th").text((label) => label);
      const format = (value: number | null): string => value === null ? "—" : numberFormat.format(value);
      rankingBody.selectAll<HTMLTableRowElement, RankingRow>("tr")
        .data(displayed, (row) => row.category).join("tr").selectAll("td")
        .data((row) => [row.category, ...uniqueColumns.map(([key]) => format(row[key]))])
        .join("td").text((value) => value);
      previewBody.selectAll("tr").data(selected.slice(0, 10)).join("tr").selectAll("td")
        .data((incident) => columns.map((column) => incident.values[column]?.trim() || "—"))
        .join("td").text((value) => value);
    }

    content.selectAll("select, input").on("change", update);
    resetButton.on("click", () => {
      startYear.property("value", years.at(-1));
      endYear.property("value", years.at(-1));
      for (const { control } of [...categoryControls, ...flagControls]) control.property("value", "");
      knownDeaths.property("checked", false);
      knownInjuries.property("checked", false);
      update();
    });
    update();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    status.text(`Erreur de chargement : ${message}. Relancer npm run data:prepare si nécessaire.`);
  }
}

void displayData();
