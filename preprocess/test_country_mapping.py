from __future__ import annotations

import pytest

from country_geometry import drawable_iso3
from country_mapping import CountryRule, check_mapping, load_mapping
from gtd_source import RAW_CSV, read_gtd

DRAWABLE = frozenset({"DEU", "FRA"})


def rule(name: str, iso3: str, policy: str, incidents: int) -> CountryRule:
    return CountryRule(name, iso3, policy, "", incidents)


VALID = {
    "France": rule("France", "FRA", "direct", 10),
    "West Germany (FRG)": rule("West Germany (FRG)", "DEU", "successor", 3),
    "International": rule("International", "", "not_representable", 1),
}
VALID_COUNTS = {"France": 10, "West Germany (FRG)": 3, "International": 1}


def test_accepts_a_consistent_mapping():
    assert check_mapping(VALID_COUNTS, VALID, DRAWABLE) == []


def test_rejects_a_new_name_from_the_data():
    errors = check_mapping({**VALID_COUNTS, "Atlantis": 2}, VALID, DRAWABLE)
    assert errors == ["Unmapped GTD country: 'Atlantis'"]


def test_rejects_a_mapped_name_missing_from_the_data():
    counts = {name: n for name, n in VALID_COUNTS.items() if name != "France"}
    assert check_mapping(counts, VALID, DRAWABLE) == ["Mapped name absent from data: 'France'"]


def test_rejects_a_code_without_shape_on_the_map():
    rules = {**VALID, "France": rule("France", "GLP", "direct", 10)}
    assert check_mapping(VALID_COUNTS, rules, DRAWABLE) == ["'France': iso3 'GLP' has no shape on the map"]


def test_rejects_a_not_representable_row_with_a_code():
    rules = {**VALID, "International": rule("International", "FRA", "not_representable", 1)}
    assert check_mapping(VALID_COUNTS, rules, DRAWABLE) == [
        "'International': not_representable must have an empty iso3, got 'FRA'"
    ]


def test_rejects_an_unknown_policy():
    rules = {**VALID, "France": rule("France", "FRA", "guess", 10)}
    assert check_mapping(VALID_COUNTS, rules, DRAWABLE) == ["'France': unknown policy 'guess'"]


def test_rejects_a_stale_incident_count():
    assert check_mapping({**VALID_COUNTS, "France": 11}, VALID, DRAWABLE) == [
        "'France': incidents column says 10, data has 11"
    ]


@pytest.mark.skipif(
    not RAW_CSV.exists(),
    reason=f"GTD CSV absent ({RAW_CSV}): the real mapping was NOT checked. "
    "Download it from kaggle.com/datasets/START-UMD/gtd into data/raw/.",
)
def test_mapping_covers_every_country_of_the_raw_csv():
    counts = read_gtd(["country"])["country"].value_counts().to_dict()
    assert check_mapping(counts, load_mapping(), drawable_iso3()) == []
