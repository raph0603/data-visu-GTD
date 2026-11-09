import type { FlowDataset } from './engine.js';
import type { PaletteApi } from '../../core/palette';
export interface FlowSelection {
  period: number[];
  compare: number[] | null;
  /** Thickness of the ribbons: count, killed or wounded; unchanged when absent. */
  metric?: string;
  filters: Record<string, string[]>;
  countryGroups: Array<{ label: string; values: string[] }>;
  warning: string;
}
export interface FlowController {
  applyShared(selection: FlowSelection): boolean;
  dispose(): void;
  getState(): unknown;
  getGraph(): unknown;
}
export function mountRenderer(root: HTMLElement, data: FlowDataset, palette: PaletteApi, onStatus: (text: string) => void): FlowController;
