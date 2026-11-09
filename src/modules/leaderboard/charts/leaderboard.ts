import type { PaletteApi } from "../../../core/palette";
import { axisTop, easeLinear, interpolateNumber, scaleLinear, select, type Transition } from "d3";
import { metrics, type Metric, type RankingRow } from "../data/rankings";
import { ValueRankingAnimation, type RankedValue } from "../animation/value-ranking";

type ChartRow = RankingRow & { rank: number; value: number };
type ChartFrame = {
  rows: RankingRow[];
  year: number | null;
  periodLabel?: string;
  metric: Metric;
  dimensionLabel: string;
  slotCount?: number;
  allRows?: RankingRow[];
  limit?: number;
};


/** Up to this many rows the chart fits its box by thinning its bars; beyond, its box scrolls. */
const MAX_UNSCROLLED_ROWS = 20;

export class LeaderboardChart {
  private svg;
  private axis;
  private ranks;
  private bars;
  private yearLabel;
  private metricLabel;
  private emptyLabel;
  private lastFrame: ChartFrame | undefined;
  private format = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
  private observer: ResizeObserver;
  private observedWidth: number;
  private observedHeight: number;
  private currentMaximum = 1;
  private currentMetric: Metric | undefined;
  private currentValues = new Map<string, number>();
  private currentOrder: string[] = [];
  private currentMetadata = new Map<string, RankingRow>();
  private tooltip;
  private hoveredCategory: string | undefined;

  constructor(private container: HTMLElement, private palette: PaletteApi) {
    this.observedWidth = container.clientWidth;
    this.observedHeight = container.clientHeight;
    this.svg = select(container).append("svg").attr("role", "img")
      .attr("class", "leaderboard-chart").attr("width", "100%");
    this.svg.append("title").text("Classement temporel sous forme de barres horizontales");
    this.metricLabel = this.svg.append("text").attr("class", "leaderboard-metric")
      .attr("x", 12).attr("y", 24).attr("font-size", 12).attr("fill", "var(--muted)");
    this.yearLabel = this.svg.append("text").attr("class", "leaderboard-year")
      .attr("text-anchor", "end").attr("font-size", 40).attr("font-weight", 500)
      .attr("fill", "var(--muted)").attr("y", 58);
    this.axis = this.svg.append("g").attr("class", "leaderboard-axis");
    this.ranks = this.svg.append("g").attr("class", "leaderboard-ranks");
    this.bars = this.svg.append("g").attr("class", "leaderboard-bars");
    this.emptyLabel = this.svg.append("text").attr("class", "leaderboard-empty")
      .attr("text-anchor", "middle").attr("fill", "var(--muted)").attr("font-size", 12);
    this.tooltip = select(container).append("div").attr("class", "chart-tooltip").attr("hidden", "")
      .attr("role", "tooltip");
    this.tooltip.append("p").attr("class", "eyebrow");
    this.tooltip.append("p").attr("class", "tooltip-category");
    this.tooltip.append("p").attr("class", "tooltip-value");
    this.tooltip.append("p").attr("class", "tooltip-detail");
    this.observer = new ResizeObserver(() => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      // In a box of its own height (class is-fit) the rows follow the height as well as the width.
      const fitted = container.classList.contains("is-fit") && height !== this.observedHeight;
      if (width !== this.observedWidth || fitted) {
        this.observedWidth = width;
        this.observedHeight = height;
        if (this.lastFrame) this.render(this.lastFrame, 0);
      }
    });
    this.observer.observe(container);
  }

  render(frame: ChartFrame, duration = 600): void {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) duration = 0;
    const previousFrame = this.lastFrame;
    const previousValues = new Map(this.currentValues);
    const previousOrder = [...this.currentOrder];
    const oldRows = this.bars.selectAll<SVGGElement, ChartRow>("g.leaderboard-row");
    const positions = new Map<string, number>();
    const opacities = new Map<string, number>();
    oldRows.each(function (row) {
      positions.set(row.category, Number(this.getAttribute("data-position") ?? row.rank));
      opacities.set(row.category, Number(this.getAttribute("opacity") ?? 1));
    });
    const metadata = new Map([...this.currentMetadata.values(), ...oldRows.data(), ...(previousFrame?.allRows ?? previousFrame?.rows ?? []),
      ...(frame.allRows ?? frame.rows)].map((row) => [row.category, row]));
    this.currentMetadata = metadata;
    this.lastFrame = frame;
    this.svg.interrupt("leaderboard").selectAll("*").interrupt("leaderboard");
    const width = Math.max(240, this.container.clientWidth - 24);
    const left = Math.max(112, Math.min(220, width * 0.24));
    const right = 88;
    const top = 96;
    const slots = Math.max(3, frame.slotCount ?? frame.rows.length);
    // Alone in its page the chart has 38 px rows and leaves 92 px under them for the summary curve. In
    // a box of its own height (is-fit) the curve sits under the rows, and the rows take what is left:
    // thick bars (up to 64 px) when there is room. Up to 20 rows the box never changes and never
    // scrolls: the bars get thinner instead (down to 10 px rows). Beyond 20 the rows keep 16 px and
    // the box scrolls.
    const fit = this.container.classList.contains("is-fit");
    const bottom = fit ? 8 : 92;
    const panelHeight = fit ? this.container.querySelector<HTMLElement>(".timeline-summary-panel")?.offsetHeight || 96 : 0;
    const fitsWithoutScroll = fit && slots <= MAX_UNSCROLLED_ROWS;
    const free = this.container.clientHeight - 12 - top - bottom - panelHeight - 1;
    const rowHeight = fit ? Math.max(fitsWithoutScroll ? 10 : 16, Math.min(64, Math.floor((free / slots) * 10) / 10)) : 38;
    if (fit) this.container.style.overflowY = fitsWithoutScroll ? "hidden" : "";
    const barHeight = fit ? Math.max(6, Math.round(rowHeight - 8)) : 28;
    const barY = fit ? Math.round((rowHeight - barHeight) / 2) : 3;
    // Labels grow with thick bars; the legacy chart keeps its 12 px.
    const fontSize = fit ? Math.max(rowHeight < 14 ? 10 : 12, Math.min(17, Math.round(rowHeight * 0.32))) : 12;
    const textY = fit ? Math.round(rowHeight / 2 + fontSize / 3) : 21;
    const height = top + slots * rowHeight + bottom;
    select(this.container).style("--plot-left", `${left}px`).style("--plot-right", `${right}px`);
    const data: ChartRow[] = frame.rows.map((row, rank) => ({ ...row, rank, value: row[frame.metric] ?? 0 }));
    const largest = Math.max(0, ...data.map((row) => row.value));
    const scale = scaleLinear().domain([0, frame.metric === "successRate" ? 100 : largest || 1])
      .range([0, width - left - right]).nice();
    const targetMaximum = scale.domain()[1]!;
    const startMaximum = duration && this.currentMetric === frame.metric ? this.currentMaximum : targetMaximum;
    const interpolateMaximum = interpolateNumber(startMaximum, targetMaximum);
    const widthAt = (value: number, time: number) => (width - left - right) * value / interpolateMaximum(time);
    this.currentMetric = frame.metric;
    const axis = axisTop(scale).ticks(Math.max(2, Math.floor((width - left - right) / 100)))
      .tickSizeOuter(0).tickFormat((value) => this.format.format(Number(value)));
    let animation: Transition<SVGSVGElement, unknown, null, undefined> | undefined;
    this.svg.attr("viewBox", `0 0 ${width} ${height}`).attr("height", height)
      .attr("aria-label", `${frame.dimensionLabel}, ${metrics[frame.metric]}, période ${frame.periodLabel ?? frame.year ?? "indisponible"}, ${data.length} catégories`);
    this.yearLabel.attr("x", width - 12).attr("font-size", frame.periodLabel?.includes("–") ? 28 : 40)
      .text(frame.periodLabel ?? frame.year ?? "—");
    this.metricLabel.text(metrics[frame.metric]);
    this.axis.attr("transform", `translate(${left},${top - 12})`);
    if (duration) {
      const oldTicks = new Map<number, number>();
      this.axis.selectAll<SVGGElement, number>("g.tick").each(function (value) {
        oldTicks.set(value, Number(this.getAttribute("opacity") ?? 1));
      });
      const targetTicks = scale.ticks(Math.max(2, Math.floor((width - left - right) / 100)));
      const ticks = [...new Set([...oldTicks.keys(), ...targetTicks])].sort((a, b) => a - b);
      const initialScale = scale.copy().domain([0, startMaximum]);
      this.axis.call(axisTop(initialScale).tickValues(ticks).tickSizeOuter(0)
        .tickFormat((value) => this.format.format(Number(value))));
      this.axis.selectAll<SVGGElement, number>("g.tick")
        .attr("opacity", (value) => oldTicks.get(value) ?? 0)
        .transition("leaderboard").duration(duration).ease(easeLinear)
        .attrTween("transform", (value) => (time) => `translate(${widthAt(value, time) + 0.5},0)`)
        .attr("opacity", (value) => targetTicks.includes(value) ? 1 : 0);
      animation = this.svg.transition("leaderboard").duration(duration).ease(easeLinear)
        .tween("domain", () => (time) => { this.currentMaximum = interpolateMaximum(time); })
        .on("end", () => { this.axis.call(axis); });
    } else {
      this.currentMaximum = targetMaximum;
      this.axis.call(axis);
    }
    this.emptyLabel.attr("x", width / 2).attr("y", top + 54)
      .text(data.length ? "" : "Aucun résultat pour cette année et ces filtres.");
    this.ranks.selectAll<SVGTextElement, number>("text.leaderboard-rank")
      .data(data.length ? Array.from({ length: slots }, (_, index) => index + 1) : [])
      .join("text").attr("class", "leaderboard-rank")
      .attr("x", 10).attr("y", (rank) => top + (rank - 1) * rowHeight + textY)
      .attr("font-size", Math.max(11, fontSize - 1)).attr("fill", "var(--muted)").text((rank) => rank);

    const targetValues = new Map((frame.allRows ?? frame.rows).map((row) => [row.category, row[frame.metric] ?? 0]));
    const tracks = [...new Set([...previousValues.keys(), ...targetValues.keys()])].map((category) => ({
      category, start: previousValues.get(category) ?? 0, end: targetValues.get(category) ?? 0,
      presentAtEnd: targetValues.has(category),
    }));
    const displayLimit = Math.min(slots, frame.limit ?? frame.rows.length);
    const precision = frame.metric.startsWith("average") || frame.metric === "successRate" ? 2 : 0;
    const motion = new ValueRankingAnimation(tracks, duration, displayLimit, previousOrder, positions, opacities, precision);

    const draw = (values: RankedValue[], time: number) => {
      this.currentValues = new Map(values.map((row) => [row.category, row.value]));
      this.currentOrder = values.filter((row) => time < 1 || targetValues.has(row.category)).map((row) => row.category);
      const visible = values.filter((row) => row.opacity > 0.001 || row.rank < displayLimit)
        .map((row) => ({ ...metadata.get(row.category)!, ...row }));
      const rows = this.bars.selectAll<SVGGElement, ChartRow>("g.leaderboard-row")
        .data(visible, (row) => row.category).join((enter) => {
          const group = enter.append("g").attr("class", "leaderboard-row").attr("tabindex", 0)
            .attr("role", "graphics-symbol")
            .on("pointerenter pointermove focus", (event: PointerEvent | FocusEvent, row) => {
              this.hoveredCategory = row.category;
              this.updateTooltip(row);
              const bounds = this.container.getBoundingClientRect();
              const position = event.currentTarget instanceof SVGElement ? event.currentTarget.getBoundingClientRect() : bounds;
              const x = "clientX" in event ? event.clientX - bounds.left + 16 : position.right - bounds.left - 280;
              const y = "clientY" in event ? event.clientY - bounds.top + 16 : position.top - bounds.top + 34;
              this.tooltip.style("left", `${Math.max(12, Math.min(this.container.clientWidth - 292, x))}px`)
                .style("top", `${Math.max(12, Math.min(this.container.clientHeight - 160, y))}px`);
            }).on("pointerleave blur", () => {
              this.hoveredCategory = undefined;
              this.tooltip.attr("hidden", "");
            });
          group.append("rect").attr("y", 3).attr("height", 28).attr("rx", 1);
          group.append("text").attr("class", "leaderboard-category").attr("y", 21)
            .attr("text-anchor", "end").attr("font-size", 12);
          group.append("text").attr("class", "leaderboard-value").attr("y", 21)
            .attr("font-size", 12).attr("font-weight", 500);
          group.append("title");
          return group;
        }).order();
      rows.attr("data-category", (row) => row.category).attr("data-rank", (row) => row.rank + 1)
        .attr("aria-label", (row) => `${row.category}, ${metrics[frame.metric]} : ${this.value(row.value, frame.metric)}, ${frame.periodLabel ?? frame.year}`)
        .attr("data-value", (row) => row.value).attr("data-position", (row) => row.position)
        .attr("opacity", (row) => row.opacity).attr("transform", (row) => `translate(0,${top + row.position * rowHeight})`);
      rows.select("rect").attr("x", left).attr("y", barY).attr("height", barHeight).attr("width", (row) => widthAt(row.value, time))
        .attr("fill", (row) => this.color(row.category));
      rows.select("text.leaderboard-category").attr("x", left - 12).attr("y", textY).attr("font-size", fontSize).text((row) => {
        const length = Math.floor((left - 42) / (fontSize * 0.54));
        return row.category.length > length ? `${row.category.slice(0, length - 1)}…` : row.category;
      });
      rows.select("text.leaderboard-value").attr("y", textY).attr("font-size", fontSize).attr("x", (row) => left + widthAt(row.value, time) + 8)
        .attr("data-value", (row) => row.value).text((row) => this.value(row.value, frame.metric));
      rows.select("title").text((row) => {
        const known = frame.metric === "attacks" ? row.attacks
          : frame.metric === "deaths" || frame.metric === "averageDeaths" ? row.knownDeathIncidents
          : frame.metric === "injuries" || frame.metric === "averageInjuries" ? row.knownInjuryIncidents
          : frame.metric === "casualties" || frame.metric === "averageCasualties" ? row.knownCasualtyIncidents
          : frame.metric === "suicideAttacks" ? row.knownSuicideIncidents : row.knownSuccessIncidents;
        return `${row.category}\n${metrics[frame.metric]} : ${this.value(row.value, frame.metric)}\n` +
          `${known} incidents renseignés pour cet indicateur.\n` +
          `${row.attacks} incidents ; ${row.unknownDeathIncidents} avec morts inconnus ; ${row.unknownInjuryIncidents} avec blessés inconnus.`;
      });
      if (this.hoveredCategory !== undefined) {
        const hovered = visible.find((row) => row.category === this.hoveredCategory);
        if (hovered) this.updateTooltip(hovered);
        else this.tooltip.attr("hidden", "");
      }
    };
    if (animation) {
      draw(motion.sample(0), 0);
      animation.tween("bars", () => (time) => draw(motion.sample(time), time));
    } else {
      draw(motion.sample(1), 1);
      this.currentValues = targetValues;
    }
  }

  destroy(): void {
    this.observer.disconnect();
    this.pauseMotion();
    this.svg.remove();
    this.tooltip.remove();
  }

  pauseMotion(): void {
    this.svg.interrupt("leaderboard").selectAll("*").interrupt("leaderboard");
  }

  private value(value: number, metric: Metric): string {
    const average = metric.startsWith("average") || metric === "successRate";
    return this.format.format(average ? value : Math.round(value)) + (metric === "successRate" ? " %" : "");
  }

  private color(category: string): string {
    if (/^(unknown|inconnu|non renseigné)(?:$|[ (,])/i.test(category)) return this.palette.other;
    if (/^(others|autres)$/i.test(category)) return this.palette.other;
    let hash = 0;
    for (const character of category) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
    return this.palette.categorical[hash % this.palette.categorical.length]!;
  }

  private updateTooltip(row: ChartRow): void {
    const frame = this.lastFrame;
    if (!frame) return;
    const known = frame.metric === "attacks" ? row.attacks
      : frame.metric === "deaths" || frame.metric === "averageDeaths" ? row.knownDeathIncidents
      : frame.metric === "injuries" || frame.metric === "averageInjuries" ? row.knownInjuryIncidents
      : frame.metric === "casualties" || frame.metric === "averageCasualties" ? row.knownCasualtyIncidents
      : frame.metric === "suicideAttacks" ? row.knownSuicideIncidents : row.knownSuccessIncidents;
    this.tooltip.attr("hidden", null);
    this.tooltip.select(".eyebrow").text(`${frame.dimensionLabel} · ${frame.periodLabel ?? frame.year}`);
    this.tooltip.select(".tooltip-category").text(row.category);
    this.tooltip.select(".tooltip-value").text(this.value(row.value, frame.metric));
    this.tooltip.select(".tooltip-detail").text(`${metrics[frame.metric]} · ${this.format.format(known)} / ${this.format.format(row.attacks)} incidents renseignés`);
  }
}
