import type { AnnualFrame } from "./timeline";
import type { Metric } from "./rankings";

export type SummaryPoint = { year: number; value: number | null; label?: string };

export function interpolateSummaryPoint(points: SummaryPoint[], year: number): SummaryPoint & { interpolated: boolean } {
  const exact = points.find((point) => point.year === year);
  if (exact?.value != null) return { ...exact, interpolated: false };
  const before = points.filter((point) => point.year < year && point.value !== null).at(-1);
  const after = points.find((point) => point.year > year && point.value !== null);
  if (!before || !after) return { year, value: null, interpolated: false };
  const fraction = (year - before.year) / (after.year - before.year);
  return { year, value: before.value! + fraction * (after.value! - before.value!), interpolated: true };
}

export function summarizeFrames(frames: AnnualFrame[], metric: Metric, limit: number): SummaryPoint[] {
  if (!frames.length) return [];
  const points = frames.map((frame): SummaryPoint => {
    const displayed = frame.ranking.slice(0, limit);
    const value = !displayed.length && frame.incidents.length ? null
      : displayed.reduce((total, row) => total + (row[metric] ?? 0), 0);
    return { year: frame.year, value,
      ...("periodLabel" in frame && frame.periodLabel !== String(frame.year) ? { label: String(frame.periodLabel) } : {}),
    };
  });
  if (points.some((point) => point.label)) return points;
  const values = new Map(points.map((point) => [point.year, point.value]));
  return Array.from({ length: frames.at(-1)!.year - frames[0]!.year + 1 }, (_, index) => {
    const year = frames[0]!.year + index;
    return { year, value: values.has(year) ? values.get(year)! : null };
  });
}

export function closestFrameIndex(frames: AnnualFrame[], year: number, previousYear?: number): number {
  let nearest = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const distance = Math.abs(frames[index]!.year - year);
    const closestDistance = Math.abs(frames[nearest]!.year - year);
    if (distance < closestDistance || (distance === closestDistance && previousYear !== undefined && year > previousYear)) nearest = index;
  }
  return nearest;
}
