"""Description of the raw GTD export: the only Python module that knows its
file location, encoding and column names.

Every other preprocess script reads the CSV through read_gtd() and only sees
the neutral field names below, so that a dataset with renamed columns only
requires a change here.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
RAW_CSV = REPO_ROOT / "data" / "raw" / "globalterrorismdb_0718dist.csv"

ENCODING = "latin-1"

# Neutral field name -> GTD column name.
COLUMNS: dict[str, str] = {
    "event_id": "eventid",
    "year": "iyear",
    "country": "country_txt",
    "region": "region_txt",
    "latitude": "latitude",
    "longitude": "longitude",
}


def read_gtd(fields: list[str], path: Path = RAW_CSV) -> pd.DataFrame:
    """Reads the selected neutral fields from the raw CSV."""
    unknown = sorted(set(fields) - COLUMNS.keys())
    if unknown:
        raise KeyError(f"Unknown GTD fields: {unknown}")
    source_columns = [COLUMNS[field] for field in fields]
    frame = pd.read_csv(path, encoding=ENCODING, usecols=source_columns, low_memory=False)
    return frame.rename(columns={COLUMNS[field]: field for field in fields})[fields]
