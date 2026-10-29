"""Prints the raw and gzip size of the files written by preprocess.py, the
initial load (meta + country_year + region_year + geometry) against the
2 MB gzip budget, the files loaded on demand, and the largest
incidents/<iso3>.json files with their summaries/<iso3>.json.

Run: python preprocess/size_report.py [--out public/data/gtd]
"""

from __future__ import annotations

import argparse
import gzip
from pathlib import Path

from country_geometry import TOPOLOGY
from preprocess import DEFAULT_OUT

BUDGET_GZIP = 2 * 1024 * 1024
LARGEST = 5


def sizes(data: bytes) -> tuple[int, int]:
    return len(data), len(gzip.compress(data, compresslevel=6, mtime=0))


def kib(n: int) -> str:
    return f"{n / 1024:,.1f} Ko".replace(",", " ")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    out = parser.parse_args().out

    initial = {
        "meta.json": out / "meta.json",
        "agg/country_year.json": out / "agg" / "country_year.json",
        "agg/region_year.json": out / "agg" / "region_year.json",
        "geometry countries-50m.json": TOPOLOGY,
    }
    print(f"{'File':<32}{'raw':>14}{'gzip':>14}")
    initial_gzip = 0
    for name, path in initial.items():
        raw, packed = sizes(path.read_bytes())
        initial_gzip += packed
        print(f"{name:<32}{kib(raw):>14}{kib(packed):>14}")
    print(f"{'initial load':<32}{'':>14}{kib(initial_gzip):>14}"
          f"  ({initial_gzip / BUDGET_GZIP:.1%} of the 2 MB budget)")

    for name in ("agg/group_year.json", "top_events.json", "cube.json"):
        raw, packed = sizes((out / name).read_bytes())
        print(f"{name + ' (on demand)':<32}{kib(raw):>14}{kib(packed):>14}")

    measured = {}
    for folder in ("incidents", "summaries"):
        files = sorted((out / folder).glob("*.json"))
        measured[folder] = {path.name: sizes(path.read_bytes()) for path in files}
        total_raw = sum(raw for raw, _ in measured[folder].values())
        total_gzip = sum(packed for _, packed in measured[folder].values())
        print(f"{f'{folder}/ ({len(files)} files)':<32}{kib(total_raw):>14}{kib(total_gzip):>14}")

    print("\nLargest incidents files (gzip), with the summaries file loaded on click:")
    largest = sorted(measured["incidents"].items(), key=lambda item: -item[1][1])[:LARGEST]
    for name, (raw, packed) in largest:
        _, summaries_gzip = measured["summaries"][name]
        print(f"  {name:<10}{kib(raw):>14}{kib(packed):>14}   summaries {kib(summaries_gzip)}")


if __name__ == "__main__":
    main()
