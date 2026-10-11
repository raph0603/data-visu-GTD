"""Loads and checks preprocess/mapping_pays.csv, the table that joins every GTD
country name to an ISO alpha-3 code of the map, or declares it not representable.
"""

from __future__ import annotations

import csv
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

MAPPING_CSV = Path(__file__).resolve().parent / "mapping_pays.csv"

# direct: the GTD name designates the country of iso3.
# successor: a former state whose whole territory lies in today's iso3.
# part_of: a territory drawn inside the shape of iso3 (e.g. Guadeloupe in France).
# not_representable: no single shape; counted, never drawn.
POLICIES = frozenset({"direct", "successor", "part_of", "not_representable"})


@dataclass(frozen=True)
class CountryRule:
    gtd_country: str
    iso3: str
    policy: str
    note: str
    incidents: int


def load_mapping(path: Path = MAPPING_CSV) -> dict[str, CountryRule]:
    rules: dict[str, CountryRule] = {}
    with path.open(encoding="utf-8", newline="") as file:
        for row in csv.DictReader(file):
            rule = CountryRule(
                gtd_country=row["gtd_country"],
                iso3=row["iso3"],
                policy=row["policy"],
                note=row["note"],
                incidents=int(row["incidents"]),
            )
            if rule.gtd_country in rules:
                raise ValueError(f"Duplicate GTD country in {path.name}: {rule.gtd_country}")
            rules[rule.gtd_country] = rule
    return rules


def check_mapping(
    counts: Mapping[str, int],
    rules: Mapping[str, CountryRule],
    drawable: frozenset[str],
) -> list[str]:
    """Returns one message per problem; an empty list means the mapping is valid.

    counts: number of incidents per GTD country name in the raw data.
    drawable: ISO alpha-3 codes that have a shape on the map.
    """
    errors = [f"Unmapped GTD country: {name!r}" for name in sorted(counts.keys() - rules.keys())]
    errors += [f"Mapped name absent from data: {name!r}" for name in sorted(rules.keys() - counts.keys())]
    for name in sorted(rules.keys() & counts.keys()):
        rule = rules[name]
        if rule.policy not in POLICIES:
            errors.append(f"{name!r}: unknown policy {rule.policy!r}")
        elif rule.policy == "not_representable" and rule.iso3:
            errors.append(f"{name!r}: not_representable must have an empty iso3, got {rule.iso3!r}")
        elif rule.policy != "not_representable" and rule.iso3 not in drawable:
            errors.append(f"{name!r}: iso3 {rule.iso3!r} has no shape on the map")
        if rule.incidents != counts[name]:
            errors.append(f"{name!r}: incidents column says {rule.incidents}, data has {counts[name]}")
    return errors
