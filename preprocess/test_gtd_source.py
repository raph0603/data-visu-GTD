from __future__ import annotations

import pytest

from gtd_source import RAW_CSV, read_gtd

requires_csv = pytest.mark.skipif(
    not RAW_CSV.exists(),
    reason=f"GTD CSV absent ({RAW_CSV}): the raw-data checks were NOT run. "
    "Download it from kaggle.com/datasets/START-UMD/gtd into data/raw/.",
)


def test_rejects_an_unknown_field():
    with pytest.raises(KeyError, match="nkill_typo"):
        read_gtd(["nkill_typo"])


@requires_csv
def test_text_has_no_c1_control_characters():
    # Read as latin-1, the curly quotes of the file (0x93, 0x94) would become
    # the invisible control characters U+0093 and U+0094 (decision D7).
    summaries = read_gtd(["summary"])["summary"].dropna()
    with_controls = summaries[summaries.str.contains("[\u0080-\u009f]", regex=True)]
    assert with_controls.empty, f"{len(with_controls)} summaries hold C1 control characters"
    assert summaries.str.contains("“").any(), "expected curly opening quotes in summaries"
