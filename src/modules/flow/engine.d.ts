import type { csvParseRows } from 'd3';
export interface FlowDataset {
  schema: string;
  dicts: Record<string, string[]>;
  rows: number[][];
  meta: { incidents: number; years: number[]; [key: string]: unknown };
}
declare const engine: {
  parseCSV(text: string, d3: { csvParseRows: typeof csvParseRows }, filename?: string): FlowDataset;
};
export default engine;
