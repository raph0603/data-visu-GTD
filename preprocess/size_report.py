"""Prints the raw and gzip size of the files written by preprocess.py, the
initial load (meta + country_year + region_year + geometry) against the
2 MB gzip budget, and the largest incidents/<iso3>.json files.

Run: python preprocess/size_report.py [--out public/data/gtd]
"""

from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

from country_geometry import TOPOLOGY
from preprocess import DEFAULT_OUT

BUDGET_GZIP = 2 * 1024 * 1024
LARGEST = 5


def sizes(data: bytes) -> tuple[int, int]:
    return len(data), len(gzip.compress(data, compresslevel=6, mtime=0))


def kib(n: int) -> str:
    return f"{n / 1024:,.1f} Ko".replace(",", " ")


def without_summaries(path: Path) -> bytes:
    """The same incidents file with the summary column left out."""
    value = json.loads(path.read_text(encoding="utf-8"))
    value["columns"].pop("summary")
    text = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return (text + "\n").encode("utf-8")


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

    raw, packed = sizes((out / "top_events.json").read_bytes())
    print(f"{'top_events.json (on demand)':<32}{kib(raw):>14}{kib(packed):>14}")

    incidents = sorted((out / "incidents").glob("*.json"))
    measured = [(path, *sizes(path.read_bytes())) for path in incidents]
    total_raw = sum(raw for _, raw, _ in measured)
    total_gzip = sum(packed for _, _, packed in measured)
    print(f"{f'incidents/ ({len(incidents)} files)':<32}{kib(total_raw):>14}{kib(total_gzip):>14}")

    print(f"\nLargest incidents files (gzip without the summary column in brackets):")
    for path, raw, packed in sorted(measured, key=lambda item: -item[2])[:LARGEST]:
        _, packed_lean = sizes(without_summaries(path))
        print(f"  {path.name:<10}{kib(raw):>14}{kib(packed):>14}   ({kib(packed_lean)})")


if __name__ == "__main__":
    main()
