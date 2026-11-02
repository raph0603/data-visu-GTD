import { easeCubicOut } from "d3";

export type ValueTrack = {
  category: string;
  start: number;
  end: number;
  presentAtEnd: boolean;
};

export type RankedValue = {
  category: string;
  value: number;
  rank: number;
  position: number;
  opacity: number;
};

type Motion = { from: number; to: number; started: number; duration: number };

export class ValueRankingAnimation {
  private order: string[];
  private positions = new Map<string, Motion>();
  private opacities = new Map<string, Motion>();

  constructor(
    private tracks: ValueTrack[], private duration: number, private limit: number,
    previousOrder: string[], initialPositions: Map<string, number>, initialOpacities: Map<string, number>,
    private precision = 0,
  ) {
    const previousRanks = new Map(previousOrder.map((category, rank) => [category, rank]));
    const factor = 10 ** precision;
    this.order = [...tracks].sort((a, b) => Math.round(b.start * factor) - Math.round(a.start * factor)
      || (previousRanks.get(a.category) ?? Infinity) - (previousRanks.get(b.category) ?? Infinity))
      .map((track) => track.category);
    this.order.forEach((category, rank) => {
      const position = initialPositions.get(category) ?? limit;
      const target = Math.min(rank, limit);
      this.positions.set(category, { from: position, to: target, started: 0,
        duration: position === target ? 0 : Math.min(160, duration) });
      const opacity = initialOpacities.get(category) ?? 0;
      this.opacities.set(category, { from: opacity, to: opacity, started: 0, duration: 0 });
    });
  }

  sample(progress: number): RankedValue[] {
    const fraction = Math.max(0, Math.min(1, progress));
    const elapsed = fraction * this.duration;
    const oldRanks = new Map(this.order.map((category, rank) => [category, rank]));
    const factor = 10 ** this.precision;
    const values = this.tracks.map((track) => ({
      ...track, value: track.start + fraction * (track.end - track.start),
    })).filter((track) => fraction < 1 || track.presentAtEnd);
    values.sort((a, b) => Math.round(b.value * factor) - Math.round(a.value * factor)
      || (oldRanks.get(a.category) ?? Infinity) - (oldRanks.get(b.category) ?? Infinity));
    this.order = values.map((track) => track.category);
    const ranked = values.map((track, rank) => ({
      category: track.category, value: track.value, rank,
      position: this.move(this.positions, track.category, Math.min(rank, this.limit), elapsed),
      opacity: this.move(this.opacities, track.category, rank < this.limit ? 1 : 0, elapsed),
    }));
    if (fraction === 1) {
      for (const track of this.tracks.filter((track) => !track.presentAtEnd)) {
        ranked.push({ category: track.category, value: track.end, rank: this.limit,
          position: this.limit, opacity: 0 });
      }
    }
    return ranked;
  }

  private move(states: Map<string, Motion>, category: string, target: number, elapsed: number): number {
    const state = states.get(category)!;
    const current = this.current(state, elapsed);
    if (state.to !== target) {
      state.from = current;
      state.to = target;
      state.started = elapsed;
      state.duration = Math.min(160, Math.max(0, this.duration - elapsed));
    }
    return this.current(state, elapsed);
  }

  private current(state: Motion, elapsed: number): number {
    const fraction = state.duration ? Math.min(1, Math.max(0, (elapsed - state.started) / state.duration)) : 1;
    return state.from + easeCubicOut(fraction) * (state.to - state.from);
  }
}
