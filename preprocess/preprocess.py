"""Builds public/data/gtd/ from the raw GTD CSV, in the formats of
src/core/contracts.ts: meta.json, agg/country_year.json, agg/region_year.json,
agg/group_year.json, top_events.json, flow.json, incidents/<iso3>.json and
summaries/<iso3>.json.

The output is deterministic (sorted keys, stable row order, no timestamp), so
two runs on the same CSV write byte-identical files.

Run: python preprocess/preprocess.py [--source data/raw/....csv] [--out public/data/gtd]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path
from typing import Any

import pandas as pd
import pycountry

from country_geometry import drawable_iso3
from country_mapping import load_mapping
from gtd_source import (
    DATASET_CITATION,
    DATASET_ID,
    DATASET_LICENSE,
    DATASET_TITLE,
    ENCODING,
    RAW_CSV,
    REPO_ROOT,
    UNKNOWN_GROUP,
    read_gtd,
)

SCHEMA_VERSION = 1
DEFAULT_OUT = REPO_ROOT / "public" / "data" / DATASET_ID
TOP_EVENTS_PER_YEAR = 5
NOT_REPRESENTABLE_LABEL = "Not representable"
FIELDS = [
    "event_id", "year", "month", "day", "country", "region", "city", "latitude", "longitude",
    "killed", "wounded", "group", "attack_type", "target_type", "weapon_type", "suicide", "summary",
]
# Categorical dimensions of flow.json: contract name -> row field.
FLOW_DIMENSIONS = (
    ("country", "iso3"),
    ("attackType", "attack_type"),
    ("targetType", "target_type"),
    ("weaponType", "weapon_type"),
)


def number(value: float) -> int | float:
    """Writes integral values without a trailing .0, keeps fractions (e.g. 8.5 wounded)."""
    return int(value) if float(value).is_integer() else float(value)


def optional(value: Any) -> Any:
    return None if pd.isna(value) else value


def optional_date_part(value: Any) -> int | None:
    """Month and day use 0 for unknown in the source."""
    return None if pd.isna(value) or int(value) == 0 else int(value)


def load_rows(source: Path) -> pd.DataFrame:
    rows = read_gtd(FIELDS, source)
    rules = load_mapping()
    unmapped = sorted(set(rows["country"]) - rules.keys())
    if unmapped:
        raise ValueError(f"Countries missing from mapping_pays.csv: {unmapped}")
    drawable = drawable_iso3()
    undrawable = sorted({rules[name].iso3 for name in set(rows["country"])} - drawable - {""})
    if undrawable:
        raise ValueError(f"Codes without shape on the map: {undrawable}")

    rows["iso3"] = rows["country"].map(lambda name: rules[name].iso3)
    rows["has_coordinates"] = (
        rows["latitude"].between(-90, 90) & rows["longitude"].between(-180, 180)
    )
    rows["event_id"] = rows["event_id"].astype("int64").astype(str)
    return rows.sort_values("event_id", kind="stable").reset_index(drop=True)


class YearAxis:
    def __init__(self, years: pd.Series):
        self.first, self.last = int(years.min()), int(years.max())
        present = set(int(year) for year in years.unique())
        self.gaps = [year for year in range(self.first, self.last + 1) if year not in present]

    def series(self, values: dict[int, float]) -> list[int | float | None]:
        """One value per covered year: null on gaps, a measured 0 when absent."""
        return [
            None if year in self.gaps else number(values.get(year, 0))
            for year in range(self.first, self.last + 1)
        ]


def yearly_aggregates(rows: pd.DataFrame, key: str) -> pd.DataFrame:
    return rows.groupby([key, "year"]).agg(
        incidents=("event_id", "size"),
        killed_sum=("killed", "sum"),
        killed_known=("killed", "count"),
        wounded_sum=("wounded", "sum"),
        wounded_known=("wounded", "count"),
        without_coordinates=("has_coordinates", lambda flags: int((~flags).sum())),
    )


def entity_years(aggregates: pd.DataFrame, key: str, axis: YearAxis, label: str) -> dict:
    table = aggregates.loc[key] if key in aggregates.index.get_level_values(0) else None

    def series(column: str) -> list:
        return axis.series({} if table is None else table[column].to_dict())

    return {
        "label": label,
        "incidents": series("incidents"),
        "killed": {"sum": series("killed_sum"), "known": series("killed_known")},
        "wounded": {"sum": series("wounded_sum"), "known": series("wounded_known")},
    }


def country_label(iso3: str, rows: pd.DataFrame) -> str:
    """The source name of a direct row if any, else the ISO short name."""
    rules = load_mapping()
    direct = sorted(r.gtd_country for r in rules.values() if r.iso3 == iso3 and r.policy == "direct")
    if direct:
        return direct[0]
    country = pycountry.countries.get(alpha_3=iso3)
    return getattr(country, "common_name", None) or country.name


def main_region(regions: pd.Series) -> str | None:
    """Most frequent region; ties broken by name so that the result is stable."""
    if regions.empty:
        return None
    counts = regions.value_counts()
    return min(counts[counts == counts.max()].index)


def country_year(rows: pd.DataFrame, axis: YearAxis) -> dict:
    mapped = rows[rows["iso3"] != ""]
    aggregates = yearly_aggregates(mapped, "iso3")
    entities = {}
    for iso3 in sorted(drawable_iso3()):
        own = mapped[mapped["iso3"] == iso3]
        entity = entity_years(aggregates, iso3, axis, country_label(iso3, own))
        entity["region"] = main_region(own["region"])
        entity["withoutCoordinates"] = axis.series(
            aggregates.loc[iso3]["without_coordinates"].to_dict() if not own.empty else {}
        )
        entities[iso3] = entity

    rest = rows[rows["iso3"] == ""].assign(group_key="rest")
    rest_aggregates = yearly_aggregates(rest, "group_key")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "years": {"first": axis.first, "last": axis.last},
        "entities": entities,
        "notRepresentable": entity_years(rest_aggregates, "rest", axis, NOT_REPRESENTABLE_LABEL),
    }


def region_year(rows: pd.DataFrame, axis: YearAxis) -> dict:
    aggregates = yearly_aggregates(rows, "region")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "years": {"first": axis.first, "last": axis.last},
        "entities": {
            region: entity_years(aggregates, region, axis, region)
            for region in sorted(rows["region"].unique())
        },
    }


def group_year(rows: pd.DataFrame, axis: YearAxis) -> dict:
    """Every perpetrator group, keyed by its source name; "Unknown" is kept as an entity."""
    aggregates = yearly_aggregates(rows, "group")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "years": {"first": axis.first, "last": axis.last},
        "entities": {
            group: entity_years(aggregates, group, axis, group)
            for group in sorted(rows["group"].unique())
        },
    }


def flow(rows: pd.DataFrame, axis: YearAxis) -> dict:
    """Sparse cube year x country x attack x target x weapon, column by column.

    Rows without a representable country have the country code "" so that the
    cube still sums to every incident.
    """
    keys = ["year", *(field for _, field in FLOW_DIMENSIONS)]
    cube = (
        rows.groupby(keys, sort=True)
        .agg(
            incidents=("event_id", "size"),
            killed_sum=("killed", "sum"),
            killed_known=("killed", "count"),
            wounded_sum=("wounded", "sum"),
            wounded_known=("wounded", "count"),
        )
        .reset_index()
    )
    dictionaries = {name: sorted(cube[field].unique().tolist()) for name, field in FLOW_DIMENSIONS}
    positions = {name: {value: i for i, value in enumerate(values)} for name, values in dictionaries.items()}
    columns: dict[str, list] = {"year": [int(year) for year in cube["year"]]}
    for name, field in FLOW_DIMENSIONS:
        columns[name] = [positions[name][value] for value in cube[field]]
    columns["incidents"] = [int(n) for n in cube["incidents"]]
    for metric in ("killed", "wounded"):
        columns[f"{metric}Sum"] = [number(value) for value in cube[f"{metric}_sum"]]
        columns[f"{metric}Known"] = [int(n) for n in cube[f"{metric}_known"]]
    return {
        "schemaVersion": SCHEMA_VERSION,
        "years": {"first": axis.first, "last": axis.last},
        "count": len(cube),
        "dictionaries": dictionaries,
        "columns": columns,
    }


def by_deadliness(rows: pd.DataFrame) -> pd.DataFrame:
    """Known deaths first, most first; then wounded; then event id for ties."""
    return rows.sort_values(
        ["killed", "wounded", "event_id"],
        ascending=[False, False, True],
        na_position="last",
        kind="stable",
    )


def top_events(rows: pd.DataFrame) -> dict:
    mapped = by_deadliness(rows[rows["iso3"] != ""])
    top = mapped.groupby(["iso3", "year"], sort=False).head(TOP_EVENTS_PER_YEAR)
    countries: dict[str, list] = {}
    for iso3, events in top.groupby("iso3", sort=True):
        ordered = by_deadliness(events).sort_values("year", kind="stable")
        countries[iso3] = [
            {
                "eventId": event.event_id,
                "year": int(event.year),
                "month": optional_date_part(event.month),
                "day": optional_date_part(event.day),
                "city": optional(event.city),
                "killed": None if pd.isna(event.killed) else number(event.killed),
                "wounded": None if pd.isna(event.wounded) else number(event.wounded),
                "attackType": event.attack_type,
                "group": event.group,
            }
            for event in ordered.itertuples(index=False)
        ]
    return {"schemaVersion": SCHEMA_VERSION, "perYear": TOP_EVENTS_PER_YEAR, "countries": countries}


def country_incidents(iso3: str, own: pd.DataFrame) -> dict:
    located = own[own["has_coordinates"]]
    dictionaries = {
        name: sorted(located[column].unique().tolist())
        for name, column in (("attackType", "attack_type"), ("targetType", "target_type"), ("group", "group"))
    }
    positions = {name: {value: i for i, value in enumerate(values)} for name, values in dictionaries.items()}
    return {
        "schemaVersion": SCHEMA_VERSION,
        "iso3": iso3,
        "count": len(located),
        "withoutCoordinates": int((~own["has_coordinates"]).sum()),
        "dictionaries": dictionaries,
        "columns": {
            "eventId": located["event_id"].tolist(),
            "year": [int(year) for year in located["year"]],
            "month": [optional_date_part(value) for value in located["month"]],
            "day": [optional_date_part(value) for value in located["day"]],
            "latitude": [float(value) for value in located["latitude"]],
            "longitude": [float(value) for value in located["longitude"]],
            "city": [optional(value) for value in located["city"]],
            "attackType": [positions["attackType"][value] for value in located["attack_type"]],
            "targetType": [positions["targetType"][value] for value in located["target_type"]],
            "group": [positions["group"][value] for value in located["group"]],
            "killed": [None if pd.isna(value) else number(value) for value in located["killed"]],
            "wounded": [None if pd.isna(value) else number(value) for value in located["wounded"]],
            "suicide": [int(value) for value in located["suicide"]],
        },
    }


def country_summaries(iso3: str, own: pd.DataFrame) -> dict:
    """Free-text summaries of every incident of the country that has one, with or
    without coordinates, loaded only when an incident sheet is opened (D12)."""
    described = own[own["summary"].notna()]
    return {
        "schemaVersion": SCHEMA_VERSION,
        "iso3": iso3,
        "summaries": dict(zip(described["event_id"], described["summary"])),
    }


def share(part: int, whole: int) -> float:
    return round(part / whole, 6) if whole else 0.0


def meta(rows: pd.DataFrame, axis: YearAxis, source: Path) -> dict:
    total = len(rows)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "dataset": {
            "id": DATASET_ID,
            "title": DATASET_TITLE,
            "citation": DATASET_CITATION,
            "license": DATASET_LICENSE,
        },
        "build": {
            "kind": "preprocessed",
            "sourceFile": source.name,
            "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "sourceEncoding": ENCODING,
        },
        "years": {"first": axis.first, "last": axis.last, "gaps": axis.gaps},
        "rows": {
            "total": total,
            "withoutGeo": int((rows["iso3"] == "").sum()),
            "withoutCoordinates": int((~rows["has_coordinates"]).sum()),
        },
        "quality": {
            "killedKnownShare": share(int(rows["killed"].count()), total),
            "woundedKnownShare": share(int(rows["wounded"].count()), total),
            "unknownGroupShare": share(int((rows["group"] == UNKNOWN_GROUP).sum()), total),
            "withoutCoordinatesShare": share(int((~rows["has_coordinates"]).sum()), total),
        },
    }


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    path.write_text(text + "\n", encoding="utf-8", newline="\n")


def prepare_output(out: Path) -> None:
    """Clears a previous build; refuses to clear a folder this script did not write."""
    if out.exists() and any(out.iterdir()):
        if not (out / "meta.json").exists():
            raise FileExistsError(f"{out} is not empty and holds no meta.json; refusing to clear it.")
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)


def build(source: Path = RAW_CSV, out: Path = DEFAULT_OUT) -> None:
    prepare_output(out)
    rows = load_rows(source)
    axis = YearAxis(rows["year"])
    write_json(out / "meta.json", meta(rows, axis, source))
    write_json(out / "agg" / "country_year.json", country_year(rows, axis))
    write_json(out / "agg" / "region_year.json", region_year(rows, axis))
    write_json(out / "agg" / "group_year.json", group_year(rows, axis))
    write_json(out / "top_events.json", top_events(rows))
    write_json(out / "flow.json", flow(rows, axis))
    mapped = rows[rows["iso3"] != ""]
    by_country = dict(tuple(mapped.groupby("iso3")))
    for iso3 in sorted(drawable_iso3()):
        own = by_country.get(iso3, mapped.iloc[0:0])
        write_json(out / "incidents" / f"{iso3}.json", country_incidents(iso3, own))
        write_json(out / "summaries" / f"{iso3}.json", country_summaries(iso3, own))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source", type=Path, default=RAW_CSV)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    arguments = parser.parse_args()
    build(arguments.source, arguments.out)
    print(f"Wrote {arguments.out}")


if __name__ == "__main__":
    main()
