"""Writes to stdout, as JSON, the incidents of every GTD country name whose
policy in mapping_pays.csv is not "direct", with neutral field names.

Used to measure the alternative "reassign by coordinates" (point in polygon):
    python preprocess/export_policy_points.py | npx tsx scripts/measure-country-reassignment.ts
"""

from __future__ import annotations

import csv
import json
import math
import sys
from pathlib import Path

from gtd_source import read_gtd

MAPPING = Path(__file__).resolve().parent / "mapping_pays.csv"


def main() -> None:
    with MAPPING.open(encoding="utf-8", newline="") as file:
        names = {row["gtd_country"] for row in csv.DictReader(file) if row["policy"] != "direct"}

    frame = read_gtd(["country", "year", "latitude", "longitude"])
    frame = frame[frame["country"].isin(names)].sort_values(["country", "year"], kind="stable")
    points = [
        {
            "country": country,
            "year": int(year),
            "latitude": None if math.isnan(latitude) else latitude,
            "longitude": None if math.isnan(longitude) else longitude,
        }
        for country, year, latitude, longitude in frame.itertuples(index=False)
    ]
    json.dump(points, sys.stdout)


if __name__ == "__main__":
    main()
