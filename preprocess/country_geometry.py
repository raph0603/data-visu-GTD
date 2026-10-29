"""ISO alpha-3 codes that have a shape in the map geometry (world-atlas 50m).

Uses the same ISO 3166-1 source as src/core/iso3166.ts (pycountry), so that
the preprocess and the client agree on which codes can be drawn.
"""

from __future__ import annotations

import json
from functools import cache

import pycountry

from gtd_source import REPO_ROOT

TOPOLOGY = REPO_ROOT / "node_modules" / "world-atlas" / "countries-50m.json"


@cache
def drawable_iso3() -> frozenset[str]:
    if not TOPOLOGY.exists():
        raise FileNotFoundError(f"{TOPOLOGY} is missing: run npm install first.")
    topology = json.loads(TOPOLOGY.read_text(encoding="utf-8"))
    numeric_to_alpha3 = {country.numeric: country.alpha_3 for country in pycountry.countries}
    return frozenset(
        numeric_to_alpha3[geometry["id"]]
        for geometry in topology["objects"]["countries"]["geometries"]
        if geometry.get("id") in numeric_to_alpha3
    )
