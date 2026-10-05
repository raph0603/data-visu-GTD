import { select } from "d3";
import { loadData, type DataRow } from "./data/loadData";
import "./style.css";

const app = select<HTMLDivElement, unknown>("#app");

app.append("h1").text("GTD data visualisation");

const status = app.append("p").text("Chargement des données...");
const content = app.append("section");

async function displayData(): Promise<void> {
  try {
    const rows = await loadData<DataRow>(
      "data/globalterrorismdb_0718dist.csv",
    );

    status.text(`${rows.length.toLocaleString("fr-FR")} événements chargés.`);

    content
      .append("h2")
      .text("Aperçu des 10 premières lignes");

    const table = content.append("table");
    const columns = ["iyear", "country_txt", "region_txt", "attacktype1_txt"];
    const labels = {
      iyear: "Année",
      country_txt: "Pays",
      region_txt: "Région",
      attacktype1_txt: "Type d'attaque",
    };

    table
      .append("thead")
      .append("tr")
      .selectAll("th")
      .data(columns)
      .join("th")
      .text((column) => labels[column as keyof typeof labels]);

    table
      .append("tbody")
      .selectAll("tr")
      .data(rows.slice(0, 10))
      .join("tr")
      .selectAll("td")
      .data((row) => columns.map((column) => row[column] ?? "—"))
      .join("td")
      .text((value) => value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    status.text(`Erreur de chargement : ${message}`);
  }
}

void displayData();
