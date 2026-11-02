export class TimelinePlayer {
  index = 0;
  position = 0;
  playing = false;
  length = 0;
  interval = 1500;
  private positions: number[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private animationFrame: number | undefined;
  private fallbackFrame: ReturnType<typeof setTimeout> | undefined;
  private segmentStart = 0;
  private segmentEnd = 0;
  private segmentStartedAt = 0;
  private segmentDuration = 0;

  constructor(
    private onFrame: (index: number, animate: boolean, duration?: number) => void,
    private onState: () => void,
    private onProgress: (position: number) => void = () => {},
  ) {}

  setLength(length: number, index = 0, positions?: number[]): void {
    this.pause();
    this.length = Math.max(0, length);
    this.positions = positions ?? Array.from({ length: this.length }, (_, value) => value);
    this.index = Math.max(0, Math.min(index, this.length - 1));
    this.position = this.positions[this.index]! ?? 0;
    this.onState();
    if (this.length) this.onFrame(this.index, false);
    this.onProgress(this.position);
  }

  play(position = this.position): void {
    if (this.playing || this.length <= 1) return;
    this.position = Math.max(this.positions[0]!, Math.min(position, this.positions.at(-1)!));
    if (this.position >= this.positions.at(-1)!) {
      this.index = 0;
      this.position = this.positions[0]!;
      this.onFrame(this.index, false);
      this.onProgress(this.position);
    }
    this.playing = true;
    this.onState();
    this.startSegment();
  }

  pause(): void {
    if (this.playing) this.updatePosition();
    this.cancelScheduled();
    this.playing = false;
    this.onState();
  }

  seek(index: number, animate = false): void {
    this.pause();
    if (!this.length) return;
    this.index = Math.max(0, Math.min(Math.round(index), this.length - 1));
    this.position = this.positions[this.index]!;
    this.onFrame(this.index, animate);
    if (!animate) this.onProgress(this.position);
    this.onState();
  }

  setInterval(interval: number): void {
    if (!Number.isFinite(interval)) return;
    if (this.playing) this.updatePosition();
    this.interval = Math.max(200, interval);
    if (this.playing) {
      this.cancelScheduled();
      this.startSegment();
    }
  }

  private startSegment(): void {
    const next = this.positions.findIndex((position) => position > this.position);
    if (next < 0) {
      this.pause();
      return;
    }
    this.index = next;
    this.segmentStart = this.position;
    this.segmentEnd = this.positions[next]!;
    this.segmentDuration = (this.segmentEnd - this.segmentStart) * this.interval;
    this.segmentStartedAt = Date.now();
    this.onFrame(this.index, true, this.segmentDuration);
    this.onProgress(this.position);
    this.scheduleProgress();
    this.timer = setTimeout(() => {
      if (!this.playing) return;
      this.cancelScheduled();
      this.position = this.segmentEnd;
      this.onFrame(this.index, false);
      this.onProgress(this.position);
      if (this.index === this.length - 1) this.pause();
      else this.startSegment();
    }, this.segmentDuration);
  }

  private updatePosition(): void {
    const fraction = Math.min(1, Math.max(0, (Date.now() - this.segmentStartedAt) / this.segmentDuration));
    this.position = this.segmentStart + fraction * (this.segmentEnd - this.segmentStart);
    this.onProgress(this.position);
  }

  private scheduleProgress(): void {
    const tick = () => {
      if (!this.playing) return;
      this.updatePosition();
      this.scheduleProgress();
    };
    if (typeof requestAnimationFrame === "function") this.animationFrame = requestAnimationFrame(tick);
    else this.fallbackFrame = setTimeout(tick, 16);
  }

  private cancelScheduled(): void {
    clearTimeout(this.timer);
    clearTimeout(this.fallbackFrame);
    if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame);
    this.timer = undefined;
    this.fallbackFrame = undefined;
    this.animationFrame = undefined;
  }
}
