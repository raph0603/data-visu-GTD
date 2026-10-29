"""Writes the yearly population of every drawable country, from the World Bank,
for the rates per million inhabitants of the country view (D21).

Source: World Bank, World Development Indicators, SP.POP.TOTL (CC BY 4.0),
downloaded once into data/raw/population/ (not committed, like the GTD CSV):

    curl -L "https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?format=json&per_page=20000&date=1970:2017" \
         -o data/raw/population/wb_population_SP.POP.TOTL_1970-2017.json

The output, src/modules/map/population.json, is small (about 100 Ko) and
committed: the view needs it without the World Bank file. Keys are the ISO
alpha-3 codes of agg/country_year.json, plus "WLD" for the world; a year
without a value is null, never 0.

Run: python preprocess/population.py
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data" / "raw" / "population" / "wb_population_SP.POP.TOTL_1970-2017.json"
COUNTRIES = ROOT / "public" / "data" / "gtd" / "agg" / "country_year.json"
OUT = ROOT / "src" / "modules" / "map" / "population.json"
WORLD = "WLD"


def build(records: list[dict], drawable: list[str], first: int, last: int) -> dict:
    span = last - first + 1
    wanted = set(drawable) | {WORLD}
    values: dict[str, list[int | None]] = {}
    for record in records:
        code = record.get("countryiso3code") or ""
        year = int(record["date"])
        if code not in wanted or not first <= year <= last:
            continue
        series = values.setdefault(code, [None] * span)
        value = record.get("value")
        series[year - first] = None if value is None else int(value)
    return {
        "schemaVersion": 1,
        "source": "World Bank, World Development Indicators, SP.POP.TOTL (Population, total)",
        "license": "CC BY 4.0",
        "url": "https://data.worldbank.org/indicator/SP.POP.TOTL",
        "years": {"first": first, "last": last},
        "values": {code: values[code] for code in sorted(values)},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()

    meta, records = json.loads(args.source.read_text(encoding="utf-8"))
    countries = json.loads(COUNTRIES.read_text(encoding="utf-8"))
    first, last = countries["years"]["first"], countries["years"]["last"]
    drawable = sorted(countries["entities"])
    table = build(records, drawable, first, last)
    table["retrieved"] = meta.get("lastupdated")
    args.out.write_text(json.dumps(table, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8")

    missing = [code for code in drawable if code not in table["values"]]
    incidents = {code: sum(v or 0 for v in countries["entities"][code]["incidents"]) for code in missing}
    print(f"{len(table['values']) - 1} pays sur {len(drawable)} avec une population ; écrit {args.out}")
    print("Sans population (incidents 1970-2017) :", ", ".join(f"{c} ({incidents[c]})" for c in missing))


if __name__ == "__main__":
    main()
