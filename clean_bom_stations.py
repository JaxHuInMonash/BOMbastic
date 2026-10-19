"""
Clean BOM station metadata files (e.g. product IDCJMC0014).

These aren't really CSVs - they're fixed-width text with a product line,
a blank line, a header, a dashed rule, then fixed-width data rows. Missing
values are shown as '..' or '.....'. This script:

  1. Skips the product/header/rule lines
  2. Parses columns using the dashed rule to get exact column widths
     (safer than splitting on whitespace, since site names contain spaces)
  3. Converts '..' / '.....' / blank -> NaN
  4. Casts each column to the right dtype (int, float, string)
  5. Drops the copyright footer, which sits below the data and would
     otherwise parse as three rows with no site number
  6. Adds `station_id`, the zero-padded 6-char code BOM uses in filenames
     and URLs (site 1000 -> '001000'), for joining to the rainfall data
  7. Adds an `is_active` flag (True if End year is missing, i.e. still recording)
  8. Writes a clean CSV ready for loading into Postgres

Usage:
    python clean_bom_stations.py BOM-Scraper/stations_list.txt cleaned_stations.csv
"""

import sys
import re
import pandas as pd
import numpy as np

COLUMN_NAMES = [
    "site",
    "dist",
    "site_name",
    "start_year",
    "end_year",
    "lat",
    "lon",
    "source",
    "state",
    "height_m",
    "bar_ht_m",
    "wmo",
]

MISSING_TOKENS = {"..", "...", "....", ".....", "-", ""}


def find_header_and_rule(lines):
    """Find the index of the dashed rule line (e.g. '------- ----- ...')."""
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped and set(stripped) <= {"-", " "}:
            return i
    raise ValueError("Could not find the dashed rule line separating header from data")


def colspecs_from_rule(rule_line):
    """Turn a line of dash-groups into a list of (start, end) column spans."""
    spans = []
    for m in re.finditer(r"-+", rule_line):
        spans.append((m.start(), m.end()))
    return spans


def widen_last_span(spans, line_lengths):
    """Extend the final column's end to the longest data line, so long
    site/source names aren't truncated."""
    if not spans:
        return spans
    max_len = max(line_lengths) if line_lengths else spans[-1][1]
    spans[-1] = (spans[-1][0], max(spans[-1][1], max_len))
    return spans


def clean_value(val):
    val = val.strip()
    return np.nan if val in MISSING_TOKENS else val


def clean_bom_station_file(input_path: str, output_path: str) -> pd.DataFrame:
    with open(input_path, "r", encoding="utf-8", errors="replace") as f:
        raw_lines = f.readlines()

    rule_idx = find_header_and_rule(raw_lines)
    data_lines = [l.rstrip("\n") for l in raw_lines[rule_idx + 1:] if l.strip()]

    spans = colspecs_from_rule(raw_lines[rule_idx])
    spans = widen_last_span(spans, [len(l) for l in data_lines])

    rows = []
    for line in data_lines:
        # pad short lines so slicing doesn't error out
        padded = line.ljust(spans[-1][1])
        row = [clean_value(padded[start:end]) for start, end in spans]
        rows.append(row)

    df = pd.DataFrame(rows, columns=COLUMN_NAMES)

    # dtypes
    int_cols = ["site", "dist", "start_year", "end_year", "wmo"]
    float_cols = ["lat", "lon", "height_m", "bar_ht_m"]
    str_cols = ["site_name", "source", "state"]

    for col in int_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce").astype("Int64")

    for col in float_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    for col in str_cols:
        df[col] = df[col].astype("string").str.strip()

    # site_name has irregular internal spacing from the fixed-width source
    df["site_name"] = df["site_name"].str.replace(r"\s+", " ", regex=True)

    # the file ends with a copyright/privacy footer sitting below the data;
    # those lines are non-blank so they survive the line filter, but they
    # have no site number
    df = df[df["site"].notna()].reset_index(drop=True)

    # BOM identifies stations by a zero-padded 6-char code in filenames and
    # URLs (001000), which the Int64 cast above strips back to 1000
    df.insert(0, "station_id", df["site"].astype(str).str.zfill(6))

    # station still recording if end_year is missing
    df["is_active"] = df["end_year"].isna()

    df.to_csv(output_path, index=False)
    return df


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python clean_bom_stations.py <input_file> <output_file>")
        sys.exit(1)

    cleaned = clean_bom_station_file(sys.argv[1], sys.argv[2])
    print(f"Cleaned {len(cleaned)} rows -> {sys.argv[2]}")
    print(cleaned.dtypes)
    print(cleaned.head())