import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const dataset = process.env.KAGGLE_DATASET;
const file = process.env.KAGGLE_FILE;

if (!dataset) {
  console.error(
    "KAGGLE_DATASET is required. Copy .env.example to .env and set it to owner/dataset-name.",
  );
  process.exit(1);
}

if (!/^[^/]+\/[^/]+$/.test(dataset)) {
  console.error(`Invalid KAGGLE_DATASET "${dataset}". Expected owner/dataset-name.`);
  process.exit(1);
}

const outputDirectory = join(process.cwd(), "public", "data");
mkdirSync(outputDirectory, { recursive: true });

const args = ["datasets", "download", "-d", dataset, "-p", outputDirectory, "--unzip"];
if (file) {
  args.push("-f", file);
}

console.log(`Downloading ${file ? `${file} from ` : ""}${dataset} to public/data ...`);
const command = process.platform === "win32" ? "kaggle.exe" : "kaggle";
const result = spawnSync(command, args, { stdio: "inherit" });

if (result.error) {
  console.error(
    `Could not start the Kaggle CLI: ${result.error.message}\n` +
      "Install it with: python -m pip install kaggle",
  );
  process.exit(1);
}

if (result.status !== 0) {
  console.error(
    "Kaggle download failed. Check your dataset identifier and authentication.",
  );
  process.exit(result.status ?? 1);
}

const downloadedFiles = readdirSync(outputDirectory).filter((name) =>
  /\.(csv|json|tsv)$/i.test(name),
);
if (downloadedFiles.length === 0) {
  console.warn("Download completed, but no CSV/JSON/TSV file was detected in public/data.");
} else {
  console.log(`Downloaded: ${downloadedFiles.join(", ")}`);
}
