import { csv, json, tsv } from "d3-fetch";

export type DataRow = Record<string, string>;

export type DataFormat = "csv" | "json" | "tsv";

function formatFromPath(path: string): DataFormat {
  const extension = path.split("?")[0].split(".").pop()?.toLowerCase();

  if (extension === "json" || extension === "tsv" || extension === "csv") {
    return extension;
  }

  throw new Error(
    `Unsupported data format for "${path}". Use a .csv, .tsv, or .json file.`,
  );
}

/**
 * Loads a Kaggle-exported file copied to public/data.
 *
 * Relative paths are resolved by Vite from the public directory:
 * loadData<DataRow>("data/my-dataset.csv")
 */
export async function loadData<T extends object = DataRow>(
  path: string,
  format = formatFromPath(path),
): Promise<T[]> {
  try {
    if (format === "json") {
      const value = await json<T[] | { data: T[] }>(path);
      if (value === undefined) {
        throw new Error("The JSON response is empty.");
      }
      return Array.isArray(value) ? value : value.data;
    }

    const parseRow = (row: DataRow): T => row as unknown as T;
    return format === "tsv"
      ? await tsv(path, {}, parseRow)
      : await csv(path, {}, parseRow);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load data from "${path}": ${reason}`, {
      cause: error,
    });
  }
}
