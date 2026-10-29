"""Lists the GTD country names that preprocess/mapping_pays.csv does not cover yet.

It never edits the mapping: each proposal is printed for a human to accept,
correct or reject. A name is proposed as "direct" only when it equals an ISO
3166-1 name (name, official_name or common_name in pycountry) AND that code has
a shape in the map geometry; every other name is printed as UNDECIDED.

Run: python preprocess/propose_country_mapping.py
"""

from __future__ import annotations

import csv
from pathlib import Path

import pycountry

from country_geometry import drawable_iso3
from gtd_source import read_gtd

MAPPING = Path(__file__).resolve().parent / "mapping_pays.csv"


def iso_names() -> dict[str, str]:
    names: dict[str, str] = {}
    for country in pycountry.countries:
        for attribute in ("name", "official_name", "common_name"):
            value = getattr(country, attribute, None)
            if value:
                names.setdefault(value.lower(), country.alpha_3)
    return names


def main() -> None:
    counts = read_gtd(["country"])["country"].value_counts()
    known: set[str] = set()
    if MAPPING.exists():
        with MAPPING.open(encoding="utf-8", newline="") as file:
            known = {row["gtd_country"] for row in csv.DictReader(file)}

    names, drawable = iso_names(), drawable_iso3()
    missing = sorted(set(counts.index) - known)
    stale = sorted(known - set(counts.index))
    print(f"{len(counts)} GTD names, {len(known)} mapped, {len(missing)} missing, {len(stale)} stale.")
    for name in stale:
        print(f"STALE (in mapping, not in data): {name}")
    for name in missing:
        iso3 = names.get(name.lower())
        if iso3 and iso3 in drawable:
            print(f"{name},{iso3},direct,Nom ISO identique,{counts[name]}")
        else:
            reason = f"ISO {iso3} sans forme dans la carte" if iso3 else "aucun nom ISO identique"
            print(f"UNDECIDED: {name} ({counts[name]} incidents, {reason})")


if __name__ == "__main__":
    main()
