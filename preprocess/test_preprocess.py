from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pandas as pd
import pytest

from gtd_source import COLUMNS, ENCODING, RAW_CSV, read_gtd
from preprocess import build

# Five hand-written rows, in the source column layout. Expected values below
# are derived by hand from these rows, not by the code under test.
SYNTHETIC_ROWS = [
    # event, year, month, day, country, region, city, lat, lon, killed, wounded, group, attack, target, summary
    (199001010001, 1990, 1, 1, "France", "Western Europe", "Paris", 48.85, 2.35, 2, None,
     "Unknown", "Bombing/Explosion", "Business", "A “quoted” summary"),
    (199001020001, 1990, 1, 2, "France", "Western Europe", "Lyon", None, None, None, 3,
     "ETA", "Armed Assault", "Police", None),
    (199201010001, 1992, 0, 0, "Guadeloupe", "Central America & Caribbean", None, 16.24, -61.53, 0, 0,
     "Unknown", "Bombing/Explosion", "Business", None),
    (199201020001, 1992, 3, 4, "Yugoslavia", "Eastern Europe", "Belgrade", 44.8, 20.47, 5, 1,
     "ETA", "Armed Assault", "Police", None),
    (199401010001, 1994, 5, 6, "Nicaragua", "Central America & Caribbean", "Managua", 12.64,
     -86185896.0, 1, 2, "FSLN", "Assassination", "Government (General)", None),
]
FIELDS = ["event_id", "year", "month", "day", "country", "region", "city", "latitude", "longitude",
          "killed", "wounded", "group", "attack_type", "target_type", "summary"]


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def synthetic(tmp_path_factory):
    folder = tmp_path_factory.mktemp("synthetic")
    source = folder / "gtd.csv"
    frame = pd.DataFrame(SYNTHETIC_ROWS, columns=[COLUMNS[field] for field in FIELDS])
    frame.to_csv(source, index=False, encoding=ENCODING)
    out = folder / "out"
    build(source, out)
    return out


def test_meta_counts_rows_years_and_quality(synthetic):
    meta = read_json(synthetic / "meta.json")
    assert meta["years"] == {"first": 1990, "last": 1994, "gaps": [1991, 1993]}
    assert meta["rows"] == {"total": 5, "withoutGeo": 1, "withoutCoordinates": 2}
    assert meta["quality"] == {
        "killedKnownShare": 0.8,
        "woundedKnownShare": 0.8,
        "unknownGroupShare": 0.4,
        "withoutCoordinatesShare": 0.4,
    }
    assert meta["build"]["kind"] == "preprocessed"
    assert meta["dataset"]["citation"] is None and meta["dataset"]["license"] is None


def test_country_series_keep_unknown_apart_from_zero(synthetic):
    france = read_json(synthetic / "agg" / "country_year.json")["entities"]["FRA"]
    assert france["label"] == "France"
    assert france["region"] == "Western Europe"
    assert france["incidents"] == [2, None, 1, None, 0]
    assert france["killed"] == {"sum": [2, None, 0, None, 0], "known": [1, None, 1, None, 0]}
    assert france["wounded"] == {"sum": [3, None, 0, None, 0], "known": [1, None, 1, None, 0]}
    assert france["withoutCoordinates"] == [1, None, 0, None, 0]


def test_invalid_coordinates_count_as_missing(synthetic):
    nicaragua = read_json(synthetic / "agg" / "country_year.json")["entities"]["NIC"]
    assert nicaragua["withoutCoordinates"] == [0, None, 0, None, 1]
    incidents = read_json(synthetic / "incidents" / "NIC.json")
    assert (incidents["count"], incidents["withoutCoordinates"]) == (0, 1)


def test_countries_without_rows_hold_measured_zeros(synthetic):
    germany = read_json(synthetic / "agg" / "country_year.json")["entities"]["DEU"]
    assert germany["incidents"] == [0, None, 0, None, 0]
    assert germany["region"] is None
    assert (synthetic / "incidents" / "DEU.json").exists()


def test_not_representable_rows_are_kept_apart(synthetic):
    rest = read_json(synthetic / "agg" / "country_year.json")["notRepresentable"]
    assert rest["incidents"] == [0, None, 1, None, 0]
    assert rest["killed"] == {"sum": [0, None, 5, None, 0], "known": [0, None, 1, None, 0]}


def test_region_series_count_every_row(synthetic):
    regions = read_json(synthetic / "agg" / "region_year.json")["entities"]
    assert {key: value["incidents"] for key, value in regions.items()} == {
        "Central America & Caribbean": [0, None, 1, None, 1],
        "Eastern Europe": [0, None, 1, None, 0],
        "Western Europe": [2, None, 0, None, 0],
    }


def test_country_incidents_hold_only_rows_with_coordinates(synthetic):
    france = read_json(synthetic / "incidents" / "FRA.json")
    assert (france["count"], france["withoutCoordinates"]) == (2, 1)
    columns = france["columns"]
    assert columns["eventId"] == ["199001010001", "199201010001"]
    assert columns["month"] == [1, None] and columns["day"] == [1, None]
    assert columns["city"] == ["Paris", None]
    assert columns["summary"] == ["A “quoted” summary", None]
    assert [france["dictionaries"]["group"][i] for i in columns["group"]] == ["Unknown", "Unknown"]


def test_top_events_rank_each_year_by_known_deaths(synthetic):
    top = read_json(synthetic / "top_events.json")
    assert [event["eventId"] for event in top["countries"]["FRA"]] == [
        "199001010001",
        "199001020001",
        "199201010001",
    ]
    assert top["countries"]["FRA"][1]["killed"] is None
    assert "YUG" not in top["countries"]


def test_refuses_to_clear_a_folder_it_did_not_write(tmp_path):
    (tmp_path / "notes.txt").write_text("keep me", encoding="utf-8")
    with pytest.raises(FileExistsError):
        build(RAW_CSV, tmp_path)


# Checks against the real CSV. ------------------------------------------------

requires_csv = pytest.mark.skipif(
    not RAW_CSV.exists(),
    reason=f"GTD CSV absent ({RAW_CSV}): the preprocess was NOT checked against real data.",
)


@pytest.fixture(scope="module")
def real(tmp_path_factory):
    out = tmp_path_factory.mktemp("real") / "gtd"
    build(RAW_CSV, out)
    return out


@pytest.fixture(scope="module")
def raw():
    return read_gtd(["year", "killed", "wounded"])


def all_series(out: Path):
    countries = read_json(out / "agg" / "country_year.json")
    return [*countries["entities"].values(), countries["notRepresentable"]]


def total(series: list) -> float:
    return sum(value for value in series if value is not None)


@requires_csv
def test_every_row_is_counted_once(real, raw):
    meta = read_json(real / "meta.json")
    countries = read_json(real / "agg" / "country_year.json")
    mapped = sum(total(entity["incidents"]) for entity in countries["entities"].values())
    assert mapped + meta["rows"]["withoutGeo"] == len(raw) == meta["rows"]["total"]
    assert total(countries["notRepresentable"]["incidents"]) == meta["rows"]["withoutGeo"]


@requires_csv
def test_incidents_per_year_match_the_csv(real, raw):
    meta = read_json(real / "meta.json")
    expected = raw["year"].value_counts().to_dict()
    first = meta["years"]["first"]
    for name in ("country_year", "region_year"):
        series = all_series(real) if name == "country_year" else list(
            read_json(real / "agg" / "region_year.json")["entities"].values()
        )
        per_year = {
            first + i: sum(entity["incidents"][i] for entity in series)
            for i, value in enumerate(series[0]["incidents"])
            if value is not None
        }
        assert per_year == expected, name


@requires_csv
@pytest.mark.parametrize("metric", ["killed", "wounded"])
def test_known_casualties_match_the_csv(real, raw, metric):
    series = all_series(real)
    assert sum(total(entity[metric]["sum"]) for entity in series) == raw[metric].sum()
    assert sum(total(entity[metric]["known"]) for entity in series) == raw[metric].count()


@requires_csv
def test_country_files_hold_every_mapped_incident(real):
    countries = read_json(real / "agg" / "country_year.json")["entities"]
    for iso3, entity in countries.items():
        incidents = read_json(real / "incidents" / f"{iso3}.json")
        assert incidents["count"] + incidents["withoutCoordinates"] == total(entity["incidents"]), iso3


@requires_csv
def test_years_without_rows_are_gaps(real):
    assert read_json(real / "meta.json")["years"] == {"first": 1970, "last": 2017, "gaps": [1993]}


@requires_csv
def test_two_runs_write_identical_files(real, tmp_path):
    # A separate interpreter gets another string hash seed, so an order that
    # depends on set or dict hashing would show up as a different file.
    again = tmp_path / "gtd"
    script = Path(__file__).resolve().parent / "preprocess.py"
    subprocess.run(
        [sys.executable, str(script), "--out", str(again)],
        check=True,
        capture_output=True,
        env={**os.environ, "PYTHONHASHSEED": "random"},
    )

    def digests(folder: Path):
        return {
            path.relative_to(folder).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(folder.rglob("*.json"))
        }

    assert digests(again) == digests(real)
