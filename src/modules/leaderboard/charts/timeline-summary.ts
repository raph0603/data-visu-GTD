import type { PaletteApi } from "../../../core/palette";
import { area, axisBottom, curveMonotoneX, line, pointer, scaleLinear, select } from "d3";
import { interpolateSummaryPoint, type SummaryPoint } from "../data/timeline-summary";

let gradientCounter = 0;

export class TimelineSummaryChart {
  private svg;
  private fill;
  private curve;
  private axis;
  private marker;
  private dot;
  private caption;
  private hover;
  private hoverLine;
  private hoverDot;
  private hoverTooltip;
  private hoverYear;
  private hoverValue;
  private hoveredYear: number | undefined;
  private width = 520;
  private curveLength = 0;
  private points: SummaryPoint[] = [];
  private currentYear: number | undefined;
  private x = scaleLinear();
  private y = scaleLinear();
  private format = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
  private observer: ResizeObserver;
  private observedWidth: number;

  constructor(private container: HTMLElement, onSelect: (year: number) => void, private palette: PaletteApi) {
    this.observedWidth = container.clientWidth;
    select(container).append("p").attr("class", "timeline-summary-heading").text("Somme des valeurs affichées par période");
    this.svg = select(container).append("svg").attr("role", "img")
      .attr("aria-label", "Courbe temporelle de la somme des valeurs des barres affichées par période")
      .attr("class", "timeline-summary-chart").attr("width", "100%").attr("height", 72)
      .attr("tabindex", 0).attr("aria-controls", "timeline");
    const gradientId = `timeline-gradient-${++gradientCounter}`;
    const gradient = this.svg.append("defs").append("linearGradient").attr("id", gradientId)
      .attr("x1", "0%").attr("x2", "0%").attr("y1", "0%").attr("y2", "100%");
    gradient.append("stop").attr("offset", "0%").attr("stop-color", this.palette.categorical[0]!).attr("stop-opacity", 0.2);
    gradient.append("stop").attr("offset", "60%").attr("stop-color", this.palette.categorical[0]!).attr("stop-opacity", 0.06);
    gradient.append("stop").attr("offset", "100%").attr("stop-color", this.palette.categorical[0]!).attr("stop-opacity", 0);
    this.fill = this.svg.append("path").attr("fill", `url(#${gradientId})`);
    this.curve = this.svg.append("path").attr("class", "timeline-curve").attr("fill", "none")
      .attr("stroke", this.palette.categorical[0]!).attr("stroke-width", 1.2).attr("stroke-linecap", "round").attr("stroke-linejoin", "round");
    this.axis = this.svg.append("g").attr("class", "timeline-axis");
    this.marker = this.svg.append("line").attr("stroke", this.palette.categorical[0]!).attr("stroke-opacity", 0.3).attr("stroke-width", 1).attr("y1", 4).attr("y2", 44);
    this.dot = this.svg.append("circle").attr("r", 2.5).attr("fill", this.palette.categorical[0]!);
    this.hover = this.svg.append("g").attr("class", "timeline-hover").attr("visibility", "hidden").attr("pointer-events", "none");
    this.hoverLine = this.hover.append("line").attr("y1", 4).attr("y2", 44)
      .attr("stroke", this.palette.categorical[0]!).attr("stroke-opacity", 0.6).attr("stroke-dasharray", "3 3");
    this.hoverDot = this.hover.append("circle").attr("r", 4).attr("fill", this.palette.categorical[0]!).attr("stroke", "var(--paper)").attr("stroke-width", 2);
    this.hoverTooltip = this.hover.append("g");
    this.hoverTooltip.append("rect").attr("width", 230).attr("height", 74).attr("rx", 2)
      .attr("fill", "var(--paper)").attr("fill-opacity", 0.97).attr("stroke", "var(--rule)");
    this.hoverYear = this.hoverTooltip.append("text").attr("x", 16).attr("y", 20).attr("font-size", 11).attr("font-weight", 500).attr("fill", "var(--muted)");
    this.hoverValue = this.hoverTooltip.append("text").attr("x", 16).attr("y", 48).attr("font-size", 25).attr("font-weight", 500).attr("fill", "var(--ink)");
    this.hoverTooltip.append("text").attr("x", 16).attr("y", 64).attr("font-size", 9).attr("fill", "var(--muted)").text("Somme des valeurs affichées");
    this.caption = select(container).append("p").attr("class", "timeline-summary-value").attr("aria-live", "polite");
    this.svg.on("click", (event) => {
      if (this.points.length) onSelect(this.resolveHoverYear(Math.round(this.x.invert(pointer(event, this.svg.node())[0]))));
    }).on("pointermove", (event) => {
      if (!this.points.length) return;
      const year = Math.max(this.points[0]!.year, Math.min(this.points.at(-1)!.year,
        Math.round(this.x.invert(pointer(event, this.svg.node())[0]))));
      this.showHover(year);
    }).on("pointerleave blur", () => this.hideHover())
      .on("focus", () => { if (this.points.length) this.showHover(this.currentYear ?? this.points[0]!.year); })
      .on("keydown", (event: KeyboardEvent) => {
        if (!this.points.length) return;
        const year = this.hoveredYear ?? this.currentYear ?? this.points[0]!.year;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          const direction = event.key === "ArrowRight" ? 1 : -1;
          const next = this.points.some((point) => point.label)
            ? this.points[Math.max(0, Math.min(this.points.length - 1,
              this.points.findIndex((point) => point.year === this.resolveHoverYear(year)) + direction))]!.year
            : Math.max(this.points[0]!.year, Math.min(this.points.at(-1)!.year, year + direction));
          this.showHover(next);
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(year);
        }
      });
    this.observer = new ResizeObserver(() => {
      if (this.observedWidth !== container.clientWidth) {
        this.observedWidth = container.clientWidth;
        this.render(this.points);
      }
    });
    this.observer.observe(container);
  }

  render(points: SummaryPoint[]): void {
    this.points = points;
    const width = Math.max(1, this.container.clientWidth);
    this.width = width;
    const first = points[0]?.year ?? 0;
    const last = points.at(-1)?.year ?? 1;
    this.x.domain(first === last ? [first - 0.5, last + 0.5] : [first, last]).range([12, width - 12]);
    this.y.domain([0, Math.max(1, ...points.map((point) => point.value ?? 0))]).range([44, 4]);
    this.svg.attr("viewBox", `0 0 ${width} 72`);
    const knownPoints = points.filter((point) => point.value !== null);
    this.fill.attr("d", area<SummaryPoint>()
      .x((point) => this.x(point.year)).y0(44).y1((point) => this.y(point.value!)).curve(curveMonotoneX)(knownPoints));
    this.curve.attr("d", line<SummaryPoint>()
      .x((point) => this.x(point.year)).y((point) => this.y(point.value!)).curve(curveMonotoneX)(knownPoints));
    this.curveLength = knownPoints.length > 1 ? this.curve.node()!.getTotalLength() : 0;
    this.svg.selectAll<SVGCircleElement, SummaryPoint>("circle.timeline-summary-point")
      .data(points.filter((point) => point.value !== null), (point) => point.year).join("circle")
      .attr("class", "timeline-summary-point").attr("cx", (point) => this.x(point.year))
      .attr("cy", (point) => this.y(point.value!)).attr("r", points.length === 1 ? 3 : 0)
      .attr("fill", this.palette.categorical[0]!).attr("data-year", (point) => point.year).attr("data-value", (point) => point.value);
    const innerTicks = this.x.ticks(Math.max(2, Math.floor(width / 85)))
      .filter((year) => Number.isInteger(year) && this.x(year) - this.x(first) >= 45 && this.x(last) - this.x(year) >= 45);
    const ticks = first === last ? [first] : [first, ...innerTicks, last];
    this.axis.attr("transform", "translate(0,44)").call(axisBottom(this.x).tickValues(ticks).tickSize(0).tickPadding(10).tickFormat((value) => String(value)));
    this.marker.attr("visibility", points.length ? "visible" : "hidden");
    this.hideHover();
    if (this.currentYear !== undefined) this.selectYear(this.currentYear);
    else this.describe(points[0]);
  }

  selectYear(year: number): void {
    this.currentYear = year;
    this.selectPosition(year);
    if (this.hoveredYear === undefined) this.describe(this.points.find((point) => point.year === year));
  }

  selectPosition(year: number): void {
    const point = interpolateSummaryPoint(this.points, year);
    this.marker.attr("x1", this.x(year)).attr("x2", this.x(year));
    this.dot.attr("visibility", point?.value != null ? "visible" : "hidden")
      .attr("cx", this.x(year)).attr("cy", this.curveY(year, point.value));
  }

  destroy(): void {
    this.observer.disconnect();
    select(this.container).selectAll("*").remove();
  }

  private describe(point: SummaryPoint | undefined): void {
    this.caption.text(!point ? "Aucune année disponible."
      : `Somme : ${point.value === null ? "non disponible" : this.format.format(point.value)}`)
      .attr("aria-label", !point ? "Aucune année disponible."
        : `${point.label ?? point.year} — somme des valeurs affichées : ${point.value === null ? "non disponible" : this.format.format(point.value)}`);
  }

  private curveY(year: number, value: number | null): number {
    if (!this.curveLength || value === null) return this.y(value ?? 0);
    const path = this.curve.node()!;
    let left = 0;
    let right = this.curveLength;
    for (let index = 0; index < 18; index += 1) {
      const middle = (left + right) / 2;
      if (path.getPointAtLength(middle).x < this.x(year)) left = middle;
      else right = middle;
    }
    return path.getPointAtLength((left + right) / 2).y;
  }

  private showHover(year: number): void {
    year = this.resolveHoverYear(year);
    this.hoveredYear = year;
    const point = interpolateSummaryPoint(this.points, year);
    const y = this.curveY(year, point.value);
    const value = point.interpolated && point.value !== null ? this.y.invert(y) : point.value;
    this.hover.attr("visibility", "visible");
    this.hoverLine.attr("x1", this.x(year)).attr("x2", this.x(year));
    this.hoverDot.attr("cx", this.x(year)).attr("cy", y).attr("visibility", value === null ? "hidden" : "visible");
    this.hoverTooltip.attr("transform", `translate(${Math.max(8, Math.min(this.width - 238, this.x(year) + 10))},${y - 82})`);
    this.hoverYear.text(`${point.label ?? year}${point.interpolated ? " · interpolé" : ""}`);
    this.hoverValue.text(value === null ? "—" : this.format.format(value));
    this.caption.text(`Somme ${point.interpolated ? "interpolée " : ""}: ${value === null ? "non disponible" : this.format.format(value)}`)
      .attr("aria-label", `${point.label ?? year} — somme ${point.interpolated ? "interpolée" : "des valeurs affichées"} : ${value === null ? "non disponible" : this.format.format(value)}`);
  }

  private resolveHoverYear(year: number): number {
    if (!this.points.some((point) => point.label)) return year;
    return this.points.reduce((nearest, point) => Math.abs(point.year - year) < Math.abs(nearest.year - year) ? point : nearest).year;
  }

  private hideHover(): void {
    this.hoveredYear = undefined;
    this.hover.attr("visibility", "hidden");
    this.describe(this.points.find((point) => point.year === this.currentYear));
  }
}
