import { easeLinear, interpolateNumber, select } from "d3";
import type { ModuleContext, ModuleHandle, VizModule } from "../../core/module";
import { RANKING_DIMENSIONS } from "../../core/leaderboard-data";
import type { AppState } from "../../core/state";
import { dimensions, incidentCategory, metrics, parseIncident, type CategoryGroup, type Dimension, type Filters, type Flag, type Metric } from "./data/rankings";
import { buildTimelineFrames, temporalAggregations, type TemporalAggregation, type TimelineFrame } from "./data/timeline";
import { TimelinePlayer } from "./animation/player";
import { LeaderboardChart } from "./charts/leaderboard";
import { TimelineSummaryChart } from "./charts/timeline-summary";
import { closestFrameIndex, summarizeFrames } from "./data/timeline-summary";
import "./leaderboard.css";
import "./layout.css";
import { arrangeLayout } from "./layout";
import { countriesPatch, filtersWithCountries, sharedCountryIds } from "./shared-countries";

const sessionGroups = new WeakMap<ModuleContext["store"], Map<Dimension, CategoryGroup[]>>();

export function mountLeaderboard(host: HTMLElement, ctx: ModuleContext): ModuleHandle {
  const app = select(host).append("div").attr("class", "leaderboard-view");
  let disposed = false;
  const layoutAbort = new AbortController();
  let cleanup = () => {};
  let applySharedState = () => {};
  const unsubscribe = ctx.store.subscribe((state) => state, () => applySharedState());
  const topbar = app.append("header").attr("class", "topbar");
  const identity = topbar.append("div").attr("class", "identity");
  identity.append("span").attr("class", "brand").text("Classement temporel");
  identity.append("span").attr("class", "brand-caption").text("Les catégories en mouvement");
  const filterToggle = topbar.append("button").attr("type", "button").attr("class", "filter-toggle")
    .attr("aria-controls", "incident-filters").attr("aria-expanded", "true").text("Masquer les filtres");
  const content = app.append("section").attr("class", "workspace");
  const mainContent = content.append("section").attr("class", "main-view");
  const heading = mainContent.append("header").attr("class", "view-heading");
  heading.append("p").attr("class", "eyebrow").text("Explorer les classements");

  heading.append("p").attr("class", "view-description").text("Les catégories les plus touchées, année après année.");
  const status = heading.append("p").attr("class", "data-status").text("Chargement des données...");
  const matches = (query: string) => window.matchMedia?.(query).matches ?? false;
  let filtersVisible = !matches("(max-width: 900px)");
  function setFiltersVisible(visible: boolean): void {
    filtersVisible = visible;
    content.classed("filters-collapsed", !visible);
    filterToggle.attr("aria-expanded", String(visible)).text(visible ? "Masquer les filtres" : "Afficher les filtres");
    content.select(".filters-panel").attr("inert", visible ? null : "");
  }
  filterToggle.on("click", () => setFiltersVisible(!filtersVisible));
  content.append("button").attr("type", "button").attr("class", "filter-backdrop")
    .attr("tabindex", -1).attr("aria-label", "Fermer les filtres").on("click", () => setFiltersVisible(false));
  content.on("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape" && filtersVisible && matches("(max-width: 900px)")) {
      setFiltersVisible(false);
      filterToggle.node()?.focus();
    }
  });
  setFiltersVisible(filtersVisible);
  const numberFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

  async function displayData(): Promise<void> {
    try {
      const file = await ctx.data.leaderboard();
      if (disposed) return;
      const columns = ["eventId", "year", ...RANKING_DIMENSIONS, "killed", "wounded", "suicide", "success", "doubt"];
      const rows = Array.from({ length: file.count }, (_, index) => {
        const row: Record<string, string> = {};
        for (const dim of RANKING_DIMENSIONS) row[dim] = file.dictionaries[dim][file.columns[dim][index]!]!;
        for (const key of ["eventId", "year", "countryId", "killed", "wounded", "suicide", "success", "doubt"] as const)
          row[key] = file.columns[key][index] == null ? "" : String(file.columns[key][index]);
        return row;
      });
      const incidents = rows.map(parseIncident);
      const metadata = ctx.dataset;
      const calendarYears = Array.from({ length: metadata.years.last - metadata.years.first + 1 }, (_, i) => metadata.years.first + i);
      const years = calendarYears.filter((year) => !metadata.years.gaps.includes(year));
      status.text(`${numberFormat.format(rows.length)} événements · ${metadata.years.first}–${metadata.years.last}`);
      const sourceNotes = mainContent.append("footer").attr("class", "source-notes");
      sourceNotes.append("p").attr("class", "eyebrow").text("Repères de lecture");
      sourceNotes.append("p").attr("class", "data-meta").text(
        `Années absentes : ${metadata.years.gaps.join(", ") || "aucune"}. Les inconnues ne valent pas zéro. ` +
        "La courbe additionne les valeurs des catégories affichées ; cette somme n’est pas un taux ou une moyenne globale.",
      );
      sourceNotes.append("p").attr("class", "data-meta").text(
        "La réussite suit le codage GTD, sans mesurer l’atteinte d’objectifs stratégiques. Le doute est renseigné systématiquement après 1997.",
      );
      const filtersPanel = content.append("aside").attr("id", "incident-filters").attr("class", "filters-panel")
        .attr("aria-label", "Filtres des incidents").attr("inert", filtersVisible ? null : "");
      filtersPanel.append("p").attr("class", "eyebrow").text("Affiner la sélection");
      filtersPanel.append("h2").text("Filtres des incidents");
      function filterGroup(label: string) {
        const group = filtersPanel.append("details").attr("class", "filter-group").attr("open", "");
        group.append("summary").text(label);
        return group.append("div").attr("class", "filter-group-body");
      }
      const periodGroup = filterGroup("Période");
      const periodControls = periodGroup.append("div").attr("class", "control-grid period-grid");
      const startField = periodControls.append("div").attr("class", "control-field");
      startField.append("label").attr("for", "start-year").text("De : ");
      const startYear = startField.append("select").attr("id", "start-year");
      const endField = periodControls.append("div").attr("class", "control-field");
      endField.append("label").attr("for", "end-year").text("À : ");
      const endYear = endField.append("select").attr("id", "end-year");
      for (const control of [startYear, endYear]) {
        control.selectAll("option").data(calendarYears).join("option")
          .attr("value", (year) => year).text((year) => `${year}${metadata.years.gaps.includes(year) ? " · sans données" : ""}`);
        control.property("value", years.at(-1));
      }
      startYear.property("value", years[0]);
      const filterColumns: Dimension[] = [
        "region", "country", "province", "group", "attackType",
        "weaponType", "weaponSubtype", "targetType", "targetSubtype",
      ];
      const locationGroup = filterGroup("Localisation");
      const locationControls = locationGroup.append("div").attr("class", "control-grid");
      const incidentGroup = filterGroup("Acteurs et modes opératoires");
      const incidentControls = incidentGroup.append("div").attr("class", "control-grid");
      const categoryControls = filterColumns.map((column, index) => {
        const line = (index < 3 ? locationControls : incidentControls).append("div").attr("class", "control-field");
        line.append("label").attr("for", `filter-${column}`).text(`${dimensions[column]} : `);
        const control = line.append("select").attr("id", `filter-${column}`);
        const values = [...new Set(rows.map((row) => row[column] ?? "Unknown"))].sort((a, b) => a.localeCompare(b));
        control.selectAll("option").data(["", ...values]).join("option")
          .attr("value", (value) => value).text((value) => value || "Tous");
        return { column, control };
      });
      const flagLabels: Record<Flag, string> = {
        suicide: "Attaque-suicide", success: "Réussite GTD", doubt: "Doute sur la qualification terroriste",
      };
      const flagsGroup = filterGroup("Caractéristiques");
      const flagsGrid = flagsGroup.append("div").attr("class", "control-grid");
      const flagControls = (Object.entries(flagLabels) as [Flag, string][]).map(([flag, label]) => {
        const line = flagsGrid.append("div").attr("class", "control-field");
        line.append("label").attr("for", `filter-${flag}`).text(`${label} : `);
        const control = line.append("select").attr("id", `filter-${flag}`);
        control.selectAll("option").data([
          ["", "Tous"], ["1", "Oui"], ["0", "Non"], ["unknown", "Non renseigné"],
        ]).join("option").attr("value", ([value]) => value!).text(([, value]) => value!);
        return { flag, control };
      });
      const knownControls = filtersPanel.append("div").attr("class", "filter-footer");
      const deathCheck = knownControls.append("div").attr("class", "checkbox-field");
      const knownDeaths = deathCheck.append("input").attr("type", "checkbox").attr("id", "known-deaths");
      deathCheck.append("label").attr("for", "known-deaths").text("Nombre de morts renseigné uniquement");
      const injuryCheck = knownControls.append("div").attr("class", "checkbox-field");
      const knownInjuries = injuryCheck.append("input").attr("type", "checkbox").attr("id", "known-injuries");
      injuryCheck.append("label").attr("for", "known-injuries").text("Nombre de blessés renseigné uniquement");
      const resetButton = knownControls.append("button").attr("type", "button").text("Réinitialiser les filtres");

      const kpis = mainContent.insert("div", ".source-notes").attr("class", "kpis");
      const kpiValues = ["Période affichée", "Incidents sélectionnés", "Catégories affichées"].map((label) => {
        const card = kpis.append("div").attr("class", "kpi");
        card.append("span").attr("class", "kpi-label").text(label);
        return card.append("strong").text("—");
      });
      const leaderboard = mainContent.insert("section", ".source-notes").attr("class", "leaderboard")
        .attr("aria-label", "Classement et animation temporelle");
      const chartHeading = leaderboard.append("div").attr("class", "chart-heading");
      chartHeading.append("p").attr("class", "eyebrow").text("Classement temporel");
      chartHeading.append("h2").text("Évolution du classement");
      const rankingControls = leaderboard.append("div").attr("class", "ranking-options control-grid");
      const dimensionField = rankingControls.append("div").attr("class", "control-field");
      dimensionField.append("label").attr("for", "dimension").text("Catégorie : ");
      const dimensionSelect = dimensionField.append("select").attr("id", "dimension");
      dimensionSelect.selectAll("option").data(Object.entries(dimensions)).join("option")
        .attr("value", ([value]) => value!).text(([, label]) => label!);
      const metricField = rankingControls.append("div").attr("class", "control-field metric-field");
      metricField.append("label").attr("for", "metric").text("Indicateur : ");
      const metricSelect = metricField.append("select").attr("id", "metric");
      metricSelect.selectAll("option").data(Object.entries(metrics).filter(([value]) => !value.startsWith("average"))).join("option")
        .attr("value", ([value]) => value!).text(([, label]) => label!);
      const limitField = rankingControls.append("div").attr("class", "control-field");
      limitField.append("label").attr("for", "limit").text("Résultats : ");
      const limit = limitField.append("select").attr("id", "limit");
      limit.selectAll("option").data([["10", "10"], ["20", "20"], ["50", "50"], ["all", "Tous"]])
        .join("option").attr("value", ([value]) => value!).text(([, label]) => label!);
      const minimumField = rankingControls.append("div").attr("class", "control-field");
      minimumField.append("label").attr("for", "minimum-attacks").text("Minimum d'incidents par catégorie : ");
      const minimumAttacks = minimumField.append("input").attr("id", "minimum-attacks")
        .attr("type", "number").attr("min", "1").attr("step", "1").property("value", 1);
      const aggregationField = rankingControls.append("div").attr("class", "control-field");
      aggregationField.append("label").attr("for", "aggregation").text("Agrégation temporelle : ");
      const aggregation = aggregationField.append("select").attr("id", "aggregation");
      aggregation.selectAll("option").data(Object.entries(temporalAggregations)).join("option")
        .attr("value", ([value]) => value!).text(([, label]) => label!);
      const calculationField = rankingControls.append("div").attr("class", "control-field");
      calculationField.append("label").attr("for", "calculation").text("Calcul : ");
      const calculation = calculationField.append("select").attr("id", "calculation");
      const excludeCheck = rankingControls.append("div").attr("class", "checkbox-field");
      const excludeUnknown = excludeCheck.append("input").attr("type", "checkbox").attr("id", "exclude-unknown");
      excludeCheck.append("label").attr("for", "exclude-unknown").text("Masquer les catégories Unknown");
      const groupsByDimension = sessionGroups.get(ctx.store) ?? new Map<Dimension, CategoryGroup[]>();
      sessionGroups.set(ctx.store, groupsByDimension);
      const categorySources = new Map<Dimension, string[]>();
      const pendingMembers = new Set<string>();
      let groupDimension: Dimension | undefined;
      const groupsPanel = leaderboard.append("details").attr("class", "category-groups-panel");
      groupsPanel.append("summary").text("Regrouper des catégories");
      const groupsBody = groupsPanel.append("div").attr("class", "category-groups-body");
      groupsBody.append("p").attr("class", "group-help").text(
        "Sélectionnez au moins deux catégories pour créer un groupe. Ses sommes et moyennes sont calculées sur leurs incidents. Les autres catégories restent séparées.",
      );
      const groupFields = groupsBody.append("div").attr("class", "group-fields");
      const nameField = groupFields.append("div").attr("class", "control-field");
      nameField.append("label").attr("for", "group-name").text("Nom du groupe");
      const groupName = nameField.append("input").attr("type", "text").attr("id", "group-name")
        .attr("maxlength", 80).attr("placeholder", "Nom du regroupement");
      const searchField = groupFields.append("div").attr("class", "control-field");
      searchField.append("label").attr("for", "group-search").text("Rechercher une catégorie");
      const groupSearch = searchField.append("input").attr("type", "search").attr("id", "group-search")
        .attr("placeholder", "Rechercher...");
      const groupChoices = groupsBody.append("div").attr("class", "group-choices")
        .attr("role", "group").attr("aria-label", "Catégories à regrouper");
      const searchStatus = groupsBody.append("p").attr("class", "group-help");
      const pendingList = groupsBody.append("div").attr("class", "pending-members");
      const groupActions = groupsBody.append("div").attr("class", "group-actions");
      const createGroup = groupActions.append("button").attr("type", "button").attr("class", "primary-button")
        .text("Créer le groupe").property("disabled", true);
      const clearSelection = groupActions.append("button").attr("type", "button").text("Effacer la sélection");
      const groupMessage = groupsBody.append("p").attr("class", "group-message").attr("role", "status");
      const createdGroups = groupsBody.append("ul").attr("class", "created-groups");
      const animationToolbar = leaderboard.append("div").attr("class", "animation-toolbar");
      const playbackControls = animationToolbar.append("p").attr("class", "playback-controls");
      const playButton = playbackControls.append("button").attr("type", "button").attr("class", "primary-button").text("Lancer l'animation");
      const restartButton = playbackControls.append("button").attr("type", "button").text("Revenir au début");
      // Short words in the column; the whole wording stays in the accessible name and the tooltip.
      const previousButton = playbackControls.append("button").attr("type", "button").text("‹ Précédente");
      const nextButton = playbackControls.append("button").attr("type", "button").text("Suivante ›");
      const speedField = playbackControls.append("div").attr("class", "control-inline speed-control");
      speedField.append("label").attr("for", "speed").text("Vitesse : ");
      const speed = speedField.append("input").attr("id", "speed").attr("type", "range")
        .attr("min", 0.25).attr("max", 4).attr("step", 0.25).property("value", 1)
        .attr("aria-valuetext", "1 fois, 1,5 seconde par année");
      const speedValue = speedField.append("output").attr("id", "speed-value").attr("for", "speed")
        .text("1× · 1,5 s / année");
      const timelineControls = animationToolbar.append("p").attr("class", "control-inline");
      timelineControls.append("label").attr("for", "year").text("Période affichée : ");
      const yearSelect = timelineControls.append("select").attr("id", "year");
      const playbackStatus = animationToolbar.append("p").attr("class", "playback-status").attr("aria-live", "polite");
      const visualization = leaderboard.append("div").attr("class", "leaderboard-visualization");
      const chartContainer = visualization.append("div").attr("class", "leaderboard-container");
      const chart = new LeaderboardChart(chartContainer.node()!, ctx.palette);
      const timelinePanel = chartContainer.append("div").attr("class", "timeline-summary-panel");
      const summaryContainer = timelinePanel.append("div");
      const sliderControls = timelinePanel.append("p").attr("class", "timeline-controls");
      sliderControls.append("label").attr("for", "timeline").text("Parcourir les périodes : ");
      const timeline = sliderControls.append("input").attr("id", "timeline")
        .attr("type", "range").attr("step", "any");
      const summaryChart = new TimelineSummaryChart(summaryContainer.node()!,
        (year) => player.seek(closestFrameIndex(frames, year), true), ctx.palette);
      const helpText = sourceNotes.append("p").attr("class", "help-text");
      const selectionSummary = leaderboard.append("p").attr("class", "selection-summary").attr("aria-live", "polite");
      leaderboard.append("p").attr("class", "color-key").text("Couleurs stables par catégorie · Catégories inconnues en gris");
      const previewSection = mainContent.insert("details", ".source-notes").attr("class", "preview-section");
      previewSection.append("summary").text("Données nettoyées : les 10 premiers incidents de la période affichée");
      const previewWrapper = previewSection.append("div").attr("class", "data-preview");
      const preview = previewWrapper.append("table");
      const columnLabels: Record<string, string> = {
        eventId: "Identifiant", year: "Année", killed: "Morts", wounded: "Blessés",
        ...dimensions, ...flagLabels,
      };
      preview.append("thead").append("tr").selectAll("th").data(columns)
        .join("th").text((column) => columnLabels[column] ?? column);
      const previewBody = preview.append("tbody");
      let frames: TimelineFrame[] = [];
      let activeDimension: Dimension = "country";
      let activeMetric: Metric = "attacks";
      let visibleSlots = 10;
      let scrubYear: number | null = null;
      let wasPlaying = false;
      const player = new TimelinePlayer(renderFrame, () => {
        if (wasPlaying && !player.playing) chart.pauseMotion();
        wasPlaying = player.playing;
        playButton.text(player.playing ? "Pause" : "Lancer l'animation").attr("aria-pressed", String(player.playing))
          .property("disabled", player.length <= 1);
        restartButton.property("disabled", !player.length);
        previousButton.property("disabled", !player.length || player.index === 0);
        nextButton.property("disabled", !player.length || player.index === player.length - 1);
        yearSelect.property("disabled", !player.length);
        timeline.property("disabled", player.length <= 1);
        updatePlaybackStatus();
      }, (position) => {
        if (scrubYear === null) updateSlider(position);
      });

      function updatePlaybackStatus(): void {
        const current = frames[player.index] ?? frames[0];
        playbackStatus.text(!current || !player.length ? "Aucune année disponible dans cette période."
          : player.length === 1 ? `Classement de la période ${current.periodLabel}.`
          : player.playing ? `Animation en cours : ${frames[0]!.startYear} → ${frames.at(-1)!.endYear}. Période ${current.periodLabel}.`
          : player.index === player.length - 1 && player.length > 1 ? "Animation terminée. Lancer l'animation pour recommencer."
          : "Animation en pause. Les valeurs regroupent les incidents de la période affichée.");
      }

      function updateSlider(year: number): void {
        const min = Number(timeline.attr("min"));
        const max = Number(timeline.attr("max"));
        timeline.property("value", year).style("--progress", `${max > min ? 100 * (year - min) / (max - min) : 0}%`);
        summaryChart.selectPosition(year);
      }

      function renderGroupChoices(): void {
        const groups = groupsByDimension.get(activeDimension) ?? [];
        const assigned = new Set(groups.flatMap((group) => group.members));
        const query = String(groupSearch.property("value")).trim().toLocaleLowerCase("fr");
        const matches = (categorySources.get(activeDimension) ?? [])
          .filter((category) => category.toLocaleLowerCase("fr").includes(query));
        const choices = groupChoices.selectAll<HTMLLabelElement, string>("label").data(matches.slice(0, 100), (category) => category)
          .join((enter) => {
            const label = enter.append("label").attr("class", "checkbox-field");
            label.append("input").attr("type", "checkbox");
            label.append("span");
            return label;
          });
        choices.classed("assigned-category", (category) => assigned.has(category));
        choices.select("span").text((category) => category);
        choices.select("input").attr("aria-label", (category) => `Regrouper ${category}`)
          .property("checked", (category) => pendingMembers.has(category)).property("disabled", (category) => assigned.has(category))
          .on("change", (event: Event, category) => {
            if ((event.currentTarget as HTMLInputElement).checked) pendingMembers.add(category);
            else pendingMembers.delete(category);
            groupMessage.text("");
            renderPendingMembers();
          });
        searchStatus.text(matches.length > 100 ? `${matches.length} catégories · 100 affichées, affinez la recherche.`
          : matches.length ? `${matches.length} catégories disponibles. Les catégories déjà regroupées sont grisées.` : "Aucune catégorie correspondante.");
      }

      function renderPendingMembers(): void {
        pendingList.selectAll<HTMLButtonElement, string>("button").data([...pendingMembers], (member) => member).join("button")
          .attr("type", "button").attr("aria-label", (member) => `Retirer ${member} de la sélection`).text((member) => `${member} ×`)
          .on("click", (_event, member) => {
            pendingMembers.delete(member);
            renderGroupChoices();
            renderPendingMembers();
          });
        createGroup.property("disabled", pendingMembers.size < 2 || !String(groupName.property("value")).trim());
        clearSelection.property("disabled", !pendingMembers.size);
      }

      function refreshGroups(): void {
        if (groupDimension !== activeDimension) {
          groupDimension = activeDimension;
          pendingMembers.clear();
          groupSearch.property("value", "");
          groupName.property("value", "");
          groupMessage.text("");
        }
        if (!categorySources.has(activeDimension)) categorySources.set(activeDimension,
          [...new Set(incidents.map((incident) => incidentCategory(incident, activeDimension)))].sort((a, b) => a.localeCompare(b, "fr")));
        const groups = groupsByDimension.get(activeDimension) ?? [];
        const items = createdGroups.selectAll<HTMLLIElement, CategoryGroup>("li").data(groups, (group) => group.name)
          .join((enter) => {
            const item = enter.append("li");
            item.append("span");
            item.append("button").attr("type", "button").text("Supprimer");
            return item;
          });
        items.select("span").text((group) => `${group.name} · ${group.members.length} catégories`).attr("title", (group) => group.members.join(", "));
        items.select("button").attr("aria-label", (group) => `Supprimer le groupe ${group.name}`)
          .on("click", (_event, group) => {
            groupsByDimension.set(activeDimension, groups.filter((entry) => entry.name !== group.name));
            groupMessage.text(`Le groupe ${group.name} a été supprimé.`);
            update();
          });
        groupsPanel.select("summary").text(`Regrouper des catégories${groups.length ? ` · ${groups.length} groupe${groups.length > 1 ? "s" : ""}` : ""}`);
        renderGroupChoices();
        renderPendingMembers();
      }

      function renderFrame(index: number, animate: boolean, requestedDuration?: number): void {
        const frame = frames[index];
        if (!frame) return;
        const displayed = limit.property("value") === "all" ? frame.ranking
          : frame.ranking.slice(0, Number(limit.property("value")));
        yearSelect.property("value", frame.year);
        const duration = matches("(prefers-reduced-motion: reduce)") ? 0
          : requestedDuration ?? (scrubYear === null ? player.interval : 180);
        timeline.attr("aria-valuetext", frame.periodLabel);
        summaryChart.selectYear(frame.year);
        if (scrubYear !== null) updateSlider(scrubYear);
        else if (player.playing) {
          timeline.interrupt("timeline");
          updateSlider(player.position);
        }
        else if (animate) {
          const from = Number(timeline.property("value"));
          timeline.interrupt("timeline").transition("timeline").duration(duration).ease(easeLinear)
            .tween("progress", () => {
              const interpolate = interpolateNumber(from, frame.year);
              return (time) => updateSlider(interpolate(time));
            });
        } else {
          timeline.interrupt("timeline");
          updateSlider(frame.year);
        }
        updatePlaybackStatus();
        kpiValues[0]!.text(frame.periodLabel).classed("period-value", frame.startYear !== frame.endYear);
        kpiValues[1]!.text(numberFormat.format(frame.incidents.length));
        kpiValues[2]!.text(`${displayed.length} / ${frame.ranking.length}`);
        selectionSummary.text(`${frame.periodLabel} : ${numberFormat.format(frame.incidents.length)} incidents sélectionnés ; ` +
          `${numberFormat.format(frame.unknownDeaths)} avec morts inconnus, ${numberFormat.format(frame.unknownInjuries)} avec blessés inconnus. ` +
          `${displayed.length} catégories affichées sur ${frame.ranking.length}. ` +
          (frame.missingYears.length ? `Années absentes de la source : ${frame.missingYears.join(", ")}. ` : "") +
          (frame.ranking.length ? "" : "Aucun résultat pour cette année et ces filtres."));
        chart.render({ rows: displayed, year: frame.year, periodLabel: frame.periodLabel, metric: activeMetric,
          dimensionLabel: dimensions[activeDimension], slotCount: visibleSlots, allRows: frame.ranking,
          limit: limit.property("value") === "all" ? visibleSlots : Number(limit.property("value")) },
          animate ? duration : 0);
        previewBody.selectAll("tr").data(frame.incidents.slice(0, 10)).join("tr").selectAll("td")
          .data((incident) => columns.map((column) => incident.values[column]?.trim() || "—"))
          .join("td").text((value) => value);
      }

      let syncing = false;
      const lastCategoryValues = new Map<Dimension, string>();
      let lastShared: AppState | undefined;
      const metricToShared: Partial<Record<Metric, string>> = { attacks: "incidents", deaths: "killed", injuries: "wounded", averageDeaths: "lethality" };
      const metricFromShared: Record<string, Metric> = { incidents: "attacks", killed: "deaths", wounded: "injuries", lethality: "averageDeaths" };
      function syncFromStore(): void {
        const state = ctx.store.get();
        if (syncing) { lastShared = state; return; }
        if (lastShared && state.range === lastShared.range && state.filters === lastShared.filters && state.pinned === lastShared.pinned && state.metric === lastShared.metric && state.ext === lastShared.ext) return;
        lastShared = state;
        syncing = true;
        startYear.property("value", state.range.from);
        endYear.property("value", state.range.to);
        for (const { column, control } of categoryControls) {
          // Countries are the pinned ones (the map and the context bar write them); one country shows by its name.
          const shared = column === "country" ? sharedCountryIds(state) : state.filters[column] ?? [];
          const single = column === "country" && shared.length === 1 ? rows.find((row) => row.countryId === shared[0])?.country : undefined;
          control.selectAll("option.linked-selection").remove();
          let value = column === "country" ? single ?? "" : shared[0] ?? state.ext[`leaderboard.filter-${column}`] ?? "";
          if (shared.length > 1 || (column === "country" && shared.length && single === undefined)) {
            value = "__shared__";
            control.append("option").attr("class", "linked-selection").attr("value", value)
              .text(`${shared.length} ${column === "country" ? "pays" : "catégories"} sélectionné${shared.length > 1 ? "s" : ""}`);
          }
          control.property("value", value);
          lastCategoryValues.set(column, value);
        }
        for (const { flag, control } of flagControls) control.property("value", state.filters[flag]?.[0] ?? state.ext[`leaderboard.flag-${flag}`] ?? "");
        const selected = state.ext["leaderboard.metric"] as Metric | undefined;
        const metric = selected && selected in metrics && (metricToShared[selected] ?? state.ext["leaderboard.sharedMetric"]) === state.metric ? selected : metricFromShared[state.metric] ?? "attacks";
        metricSelect.property("value", metric === "averageDeaths" ? "deaths" : metric === "averageInjuries" ? "injuries" : metric === "averageCasualties" ? "casualties" : metric);
        calculation.selectAll("option").data(["sum", "mean"]).join("option").attr("value", (v) => v);
        calculation.property("value", metric.startsWith("average") ? "mean" : "sum");
        const defaults = { dimension: "country", limit: "10", aggregation: "year", minimum: "1" };
        for (const [key, control] of [["dimension", dimensionSelect], ["limit", limit], ["aggregation", aggregation], ["minimum", minimumAttacks]] as const) {
          const value = state.ext[`leaderboard.${key}`] ?? defaults[key];
          control.property("value", key === "minimum" || control.selectAll<HTMLOptionElement, unknown>("option").nodes()
            .some((option) => option.value === value) ? value : defaults[key]);
        }
        knownDeaths.property("checked", state.ext["leaderboard.knownDeaths"] === "true");
        knownInjuries.property("checked", state.ext["leaderboard.knownInjuries"] === "true");
        excludeUnknown.property("checked", state.ext["leaderboard.excludeUnknown"] === "true");
        update();
        syncing = false;
      }
      function publishControls(): void {
        if (syncing) return;
        const state = ctx.store.get();
        const filters: Record<string, readonly string[]> = { ...state.filters };
        // The countries live in pinned, not in a filter: an old « country » filter moves there.
        delete filters.country;
        let countryIds = sharedCountryIds(state);
        const ext = { ...state.ext, "leaderboard.metric": activeMetric, "leaderboard.sharedMetric": metricToShared[activeMetric] ?? state.metric,
          "leaderboard.dimension": String(dimensionSelect.property("value")), "leaderboard.limit": String(limit.property("value")),
          "leaderboard.aggregation": String(aggregation.property("value")), "leaderboard.minimum": String(minimumAttacks.property("value")),
          "leaderboard.knownDeaths": String(knownDeaths.property("checked")), "leaderboard.knownInjuries": String(knownInjuries.property("checked")),
          "leaderboard.excludeUnknown": String(excludeUnknown.property("checked")) } as Record<string, string>;
        for (const { column, control } of categoryControls) {
          const value = String(control.property("value"));
          if (value === "__shared__" || value === lastCategoryValues.get(column)) continue;
          if (column === "country") {
            countryIds = value ? [...new Set(rows.filter((row) => row.country === value).map((row) => row.countryId!).filter(Boolean))] : [];
          } else if (ctx.dataset.dimensions.some((dim) => dim.id === column)) filters[column] = value ? [value] : [];
          else ext[`leaderboard.filter-${column}`] = value;
          lastCategoryValues.set(column, value);
        }
        for (const { flag, control } of flagControls) {
          const value = String(control.property("value"));
          if (flag === "suicide") filters.suicide = value ? [value] : [];
          else ext[`leaderboard.flag-${flag}`] = value;
        }
        syncing = true;
        ctx.store.set({ filters, ext, metric: metricToShared[activeMetric] ?? state.metric,
          range: { from: Number(startYear.property("value")), to: Number(endYear.property("value")) },
          ...countriesPatch(state, countryIds) });
        lastShared = ctx.store.get();
        syncing = false;
      }
      function update(): void {
        if (Number(startYear.property("value")) > Number(endYear.property("value"))) {
          const from = startYear.property("value");
          startYear.property("value", endYear.property("value"));
          endYear.property("value", from);
        }
        const previousYear = frames[player.index]?.year;
        scrubYear = null;
        timeline.interrupt("timeline");
        player.pause();
        const filters: Filters = {
          startYear: Number(startYear.property("value")), endYear: Number(endYear.property("value")),
          categories: Object.fromEntries(categoryControls.map(({ column, control }) => [column, control.property("value") === "__shared__" ? "" : control.property("value")])),
          flags: Object.fromEntries(flagControls.map(({ flag, control }) => [flag, control.property("value")])),
          knownDeathsOnly: Boolean(knownDeaths.property("checked")),
          knownInjuriesOnly: Boolean(knownInjuries.property("checked")),
        };
        activeDimension = String(dimensionSelect.property("value")) as Dimension;
        const selectedMetric = String(metricSelect.property("value")) as Metric;
        const previousCalculation = String(calculation.property("value"));
        const averageMetrics: Partial<Record<Metric, Metric>> = { deaths: "averageDeaths", injuries: "averageInjuries", casualties: "averageCasualties" };
        const calculationOptions = averageMetrics[selectedMetric] ? [["sum", "Somme"], ["mean", "Moyenne par incident renseigné"]]
          : [["sum", selectedMetric === "successRate" ? "Taux de réussite (%)" : "Somme"]];
        calculation.selectAll("option").data(calculationOptions).join("option")
          .attr("value", ([value]) => value!).text(([, label]) => label!);
        calculation.property("value", calculationOptions.some(([value]) => value === previousCalculation) ? previousCalculation : "sum")
          .property("disabled", calculationOptions.length === 1);
        activeMetric = calculation.property("value") === "mean" ? averageMetrics[selectedMetric]! : selectedMetric;
        refreshGroups();
        const inputMinimum = Number(minimumAttacks.property("value"));
        const minimum = Number.isFinite(inputMinimum) ? Math.max(1, Math.ceil(inputMinimum)) : 1;
        minimumAttacks.property("value", minimum);
        const aggregationMode = String(aggregation.property("value")) as TemporalAggregation;
        publishControls();
        const sharedFilters = filtersWithCountries(ctx.store.get());
        const linked = incidents.filter((incident) => Object.entries(sharedFilters).every(([dim, values]) => {
          if (!values.length) return true;
          const value = dim === "country" ? incident.values.countryId : incident.values[dim];
          return value !== undefined && values.includes(value);
        }));
        // Shared multi-select filters have already been applied above.
        for (const key of Object.keys(filters.categories) as Dimension[]) if (sharedFilters[key]?.length) delete filters.categories[key];
        frames = buildTimelineFrames(linked, years, filters, activeDimension, activeMetric, minimum,
          Boolean(excludeUnknown.property("checked")), aggregationMode, groupsByDimension.get(activeDimension) ?? []);
        const annual = aggregationMode === "year";
        const previousName = annual ? "Année précédente" : "Période précédente";
        const nextName = annual ? "Année suivante" : "Période suivante";
        previousButton.attr("aria-label", previousName).attr("title", previousName);
        nextButton.attr("aria-label", nextName).attr("title", nextName);
        helpText.text(`${temporalAggregations[aggregationMode]}. Les périodes de 5 ans et les décennies suivent les bornes calendaires et sont limitées aux dates sélectionnées. ` +
          "Les filtres se combinent avant l'agrégation. Les groupes remplacent leurs catégories individuelles. Les sommes, moyennes et taux sont recalculés sur leurs incidents renseignés ; morts + blessés nécessite les deux valeurs. Les années absentes ne sont pas remplacées par des zéros. La vitesse est exprimée par année parcourue.");
        const limitValue = limit.property("value") === "all" ? Infinity : Number(limit.property("value"));
        visibleSlots = Math.max(3, ...frames.map((frame) => Math.min(limitValue, frame.ranking.length)));
        yearSelect.selectAll("option").data(frames).join("option")
          .attr("value", (frame) => frame.year).text((frame) => frame.periodLabel);
        timeline.attr("min", frames[0]?.year ?? 0).attr("max", frames.at(-1)?.year ?? 0);
        summaryChart.render(summarizeFrames(frames, activeMetric, limitValue));
        const index = Math.max(0, frames.findIndex((frame) => previousYear !== undefined
          && frame.startYear <= previousYear && frame.endYear >= previousYear));
        player.setLength(frames.length, index, frames.map((frame) => frame.year));
        if (!frames.length) {
          kpiValues.forEach((value) => value.text("—"));
          chart.render({ rows: [], year: null, metric: activeMetric, dimensionLabel: dimensions[activeDimension] }, 0);
          previewBody.selectAll("tr").remove();
          selectionSummary.text("Aucune donnée disponible pour cette période. Les années absentes ne représentent pas des années sans attaque.");
        }
      }

      content.selectAll("select:not(#year), .filters-panel input, #minimum-attacks, #exclude-unknown").on("change", update);
      groupSearch.on("input", renderGroupChoices);
      groupName.on("input", () => { groupMessage.text(""); renderPendingMembers(); });
      clearSelection.on("click", () => { pendingMembers.clear(); renderGroupChoices(); renderPendingMembers(); });
      createGroup.on("click", () => {
        const name = String(groupName.property("value")).trim();
        const groups = groupsByDimension.get(activeDimension) ?? [];
        if (pendingMembers.size < 2 || !name) return;
        if ((categorySources.get(activeDimension) ?? []).some((category) => category.toLocaleLowerCase("fr") === name.toLocaleLowerCase("fr"))
          || groups.some((group) => group.name.toLocaleLowerCase("fr") === name.toLocaleLowerCase("fr"))) {
          groupMessage.text("Ce nom est déjà utilisé par une catégorie ou un groupe. Choisissez un autre nom.");
          return;
        }
        if (groups.some((group) => group.members.some((member) => pendingMembers.has(member)))) {
          groupMessage.text("Une catégorie ne peut appartenir qu'à un seul groupe.");
          return;
        }
        groupsByDimension.set(activeDimension, [...groups, { name, members: [...pendingMembers] }]);
        pendingMembers.clear();
        groupName.property("value", "");
        groupSearch.property("value", "");
        groupMessage.text(`Le groupe ${name} est ajouté au classement.`);
        update();
      });
      playButton.on("click", () => {
        if (player.playing) {
          player.pause();
        } else {
          timeline.interrupt("timeline");
          player.play(Number(timeline.property("value")));
        }
      });
      restartButton.on("click", () => player.seek(0));
      previousButton.on("click", () => player.seek(player.index - 1, true));
      nextButton.on("click", () => player.seek(player.index + 1, true));
      yearSelect.on("change", () => player.seek(frames.findIndex((frame) => frame.year === Number(yearSelect.property("value")))));
      timeline.on("input", () => {
        timeline.interrupt("timeline");
        scrubYear = Number(timeline.property("value"));
        const index = closestFrameIndex(frames, scrubYear, frames[player.index]?.year);
        if (index !== player.index) player.seek(index, true);
        else {
          player.pause();
          updateSlider(scrubYear);
        }
      }).on("change", () => {
        if (scrubYear === null) return;
        scrubYear = null;
        renderFrame(player.index, true, 180);
      }).on("keydown", (event: KeyboardEvent) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        scrubYear = null;
        const index = event.key === "Home" ? 0 : event.key === "End" ? frames.length - 1
          : player.index + (event.key === "ArrowRight" ? 1 : -1);
        player.seek(index, true);
      });
      speed.on("input change", () => {
        const multiplier = Number(speed.property("value"));
        const interval = 1500 / multiplier;
        speedValue.text(`${numberFormat.format(multiplier)}× · ${numberFormat.format(interval / 1000)} s / année`);
        speed.attr("aria-valuetext", `${numberFormat.format(multiplier)} fois, ${numberFormat.format(interval / 1000)} seconde par année`);
        player.setInterval(interval);
      });
      resetButton.on("click", () => {
        frames = [];
        startYear.property("value", years[0]);
        endYear.property("value", years.at(-1));
        for (const { control } of [...categoryControls, ...flagControls]) control.property("value", "");
        knownDeaths.property("checked", false);
        knownInjuries.property("checked", false);
        syncing = true;
        const ext: Record<string, string> = { ...ctx.store.get().ext, "leaderboard.knownDeaths": "false", "leaderboard.knownInjuries": "false" };
        for (const key of Object.keys(ext)) if (key.startsWith("leaderboard.filter-") || key.startsWith("leaderboard.flag-")) delete ext[key];
        ctx.store.set({ filters: {}, range: { from: years[0]!, to: years.at(-1)! }, ext });
        syncing = false;
        lastShared = undefined;
        syncFromStore();
      });
      const pauseWhenHidden = () => { if (document.hidden) player.pause(); };
      document.addEventListener("visibilitychange", pauseWhenHidden);
      cleanup = () => {
        player.pause();
        timeline.interrupt("timeline");
        chart.destroy();
        summaryChart.destroy();
        document.removeEventListener("visibilitychange", pauseWhenHidden);
      };
      applySharedState = () => syncFromStore();
      syncFromStore();
      // The controls are all built and wired: set them out in the plate's box.
      arrangeLayout(app.node()!, layoutAbort.signal);
      update();

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (disposed) return;
      status.text(`Erreur de chargement : ${message}. Relancer npm run data:prepare si nécessaire.`);
    }
  }

  void displayData();
  return { destroy() {
    disposed = true;
    layoutAbort.abort();
    unsubscribe();
    cleanup();
    app.remove();
  } };
}

const module: VizModule = {
  id: "leaderboard",
  title: "Classement temporel",
  tasks: ["T1", "T2", "T4", "T7", "T11"],
  mount: mountLeaderboard,
};
export default module;
