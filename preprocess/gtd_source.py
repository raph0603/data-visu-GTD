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

DATASET_ID = "gtd"
DATASET_TITLE = "Global Terrorism Database"

# Copied from the terms of use on kaggle.com/datasets/START-UMD/gtd (EULA, section 4.a).
DATASET_CITATION = (
    "National Consortium for the Study of Terrorism and Responses to Terrorism (START), "
    "University of Maryland. (2018). The Global Terrorism Database (GTD) [Data file]. "
    "Retrieved from https://www.start.umd.edu/gtd"
)
# Summary of the EULA (sections 2, 3.a and 4.b): non-commercial research only; publishing an
# analysis or a visualization is allowed, publicly posting the data is not.
DATASET_LICENSE = (
    "GTD End User License Agreement (University of Maryland): non-commercial research and analysis only. "
    "Copyright University of Maryland 2018."
)

# Value of the group field when the perpetrator is not identified.
UNKNOWN_GROUP = "Unknown"

# Windows-1252, not latin-1: the file holds curly quotes and dashes in the
# 0x80-0x9F range (docs/map-decisions.md, D7).
ENCODING = "cp1252"

# Neutral field name -> GTD column name.
# Month and day use 0 for "unknown".
COLUMNS: dict[str, str] = {
    "event_id": "eventid",
    "year": "iyear",
    "month": "imonth",
    "day": "iday",
    "country": "country_txt",
    "region": "region_txt",
    "city": "city",
    "latitude": "latitude",
    "longitude": "longitude",
    "killed": "nkill",
    "wounded": "nwound",
    "group": "gname",
    "attack_type": "attacktype1_txt",
    "target_type": "targtype1_txt",
    "weapon_type": "weaptype1_txt",
    # 1 when the attack is a suicide attack, else 0 (never missing in the 2017 export).
    "suicide": "suicide",
    "summary": "summary",
    "province": "provstate",
    "weapon_subtype": "weapsubtype1_txt",
    "target_subtype": "targsubtype1_txt",
    "success": "success",
    "doubt": "doubtterr",
}


def read_ranking_details(path: Path = RAW_CSV) -> pd.DataFrame:
    """Optional detail columns; alternative/test exports may omit them."""
    fields = ["event_id", "province", "weapon_subtype", "target_subtype", "success", "doubt"]
    names = {COLUMNS[field]: field for field in fields}
    frame = pd.read_csv(path, encoding=ENCODING, usecols=lambda name: name in names, low_memory=False)
    frame = frame.rename(columns=names)
    for field in fields:
        if field not in frame:
            frame[field] = pd.NA
    frame["event_id"] = frame["event_id"].astype("int64").astype(str)
    return frame.set_index("event_id")


def read_gtd(fields: list[str], path: Path = RAW_CSV) -> pd.DataFrame:
    """Reads the selected neutral fields from the raw CSV."""
    unknown = sorted(set(fields) - COLUMNS.keys())
    if unknown:
        raise KeyError(f"Unknown GTD fields: {unknown}")
    source_columns = [COLUMNS[field] for field in fields]
    frame = pd.read_csv(path, encoding=ENCODING, usecols=source_columns, low_memory=False)
    return frame.rename(columns={COLUMNS[field]: field for field in fields})[fields]
