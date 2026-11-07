"""
Parse the Bureau of Meteorology station register into a typed table.

This module is the single place the register is parsed. Station selection
(`stations_list.py`), CSV export and the database loader all consume its output;
nothing else re-parses the source file.

It merges two earlier implementations:

  * `clean_bom_stations.py` (Rithik) contributed the parsing approach -- locate the
    dashed rule by description, derive column spans from it, and type every column
    properly with real nulls rather than sentinel strings.
  * `stations_list.py` (Raedan) contributed reading the site number as text, which
    preserves BOM's zero padding (001006, not 1006), and validating each row by its
    station id rather than assuming a fixed-length footer.

Why fixed-width and not `str.split()`: the register is a fixed-width report, and
several of its fields contain spaces. 359 rows have a `location_source` such as
"MAP 1:250 000". Splitting on whitespace shifts every later field on those rows.

Output conforms to docs/data-contract.md section 2.

Usage:
    python BOM-Scraper/station_parser.py                     # writes the default CSV
    python BOM-Scraper/station_parser.py IN.txt OUT.csv      # explicit paths

    from station_parser import parse_register
    stations = parse_register()
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pandas as pd

# ---------------------------------------------------------------- locations
# Paths resolve from this file, so every script runs from any working directory.
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_REGISTER = REPO_ROOT / "BOM-Scraper" / "stations_list.txt"
DEFAULT_OUTPUT = REPO_ROOT / "BOM-Scraper" / "data" / "stations.csv"

# ---------------------------------------------------------------- contract
# Column order and names are fixed by docs/data-contract.md section 2.
COLUMNS = [
    "station_id",
    "name",
    "district",
    "state",
    "latitude",
    "longitude",
    "start_year",
    "end_year",
    "is_active",
    "elevation_m",
    "barometer_elevation_m",
    "wmo_id",
    "location_source",
]

# The register's own columns, in file order. Not the same as COLUMNS: these are
# raw field names used only between reading and renaming.
RAW_FIELDS = [
    "site", "district", "name", "start_year", "end_year", "latitude",
    "longitude", "location_source", "state", "elevation_m",
    "barometer_elevation_m", "wmo_id",
]

# Every way this file says "no value". Recognised on input, never written on output.
MISSING_TOKENS = {"..", "...", "....", ".....", "-", "", "Unknown"}

# docs/data-contract.md section 2 -- 'ISL' is real; two stations use it.
VALID_STATES = {"WA", "NT", "SA", "QLD", "NSW", "VIC", "TAS", "ANT", "ISL"}

STATION_ID_WIDTH = 6


# ---------------------------------------------------------------- parsing
def find_rule_line(lines: list[str]) -> int:
    """Index of the dashed rule separating the header from the data.

    Found by description -- a line of nothing but dashes and spaces -- rather than
    by a hardcoded position, so an extra header line from BOM does not break us.
    """
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped and set(stripped) <= {"-", " "}:
            return i
    raise ValueError(
        "No dashed rule found: this does not look like a BOM fixed-width register."
    )


def colspecs_from_rule(rule: str, longest_line: int) -> list[tuple[int, int]]:
    """Character spans for each column, one per run of dashes.

    The final span is widened to the longest data line so a long trailing value is
    not clipped by a rule that happens to be shorter than its data.
    """
    spans = [(m.start(), m.end()) for m in re.finditer(r"-+", rule)]
    if not spans:
        raise ValueError("The rule line contains no dash groups.")
    last_start, last_end = spans[-1]
    spans[-1] = (last_start, max(last_end, longest_line))
    return spans


def _clean(value: str | float) -> str | None:
    """Strip a field and map BOM's missing markers to None."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    return None if value in MISSING_TOKENS else value


def parse_register(register_path: Path | str = DEFAULT_REGISTER) -> pd.DataFrame:
    """Read the register and return a typed DataFrame shaped by the data contract.

    Missing values are pandas NA throughout. No sentinel strings are produced --
    see docs/data-contract.md section 7 for why that matters.
    """
    register_path = Path(register_path)
    raw_lines = register_path.read_text(encoding="utf-8", errors="replace").splitlines()

    rule_index = find_rule_line(raw_lines)
    data_lines = [line for line in raw_lines[rule_index + 1:] if line.strip()]
    if not data_lines:
        raise ValueError(f"{register_path} contains a header but no data rows.")

    spans = colspecs_from_rule(raw_lines[rule_index], max(len(l) for l in data_lines))
    if len(spans) != len(RAW_FIELDS):
        raise ValueError(
            f"Expected {len(RAW_FIELDS)} columns from the rule line, found {len(spans)}. "
            "The register layout may have changed."
        )

    width = spans[-1][1]
    rows = [
        [_clean(line.ljust(width)[start:end]) for start, end in spans]
        for line in data_lines
    ]
    df = pd.DataFrame(rows, columns=RAW_FIELDS)

    # Keep only real station rows. This also removes BOM's copyright footer, which
    # is non-blank and so survives the line filter above, but has no site number.
    is_station = df["site"].fillna("").str.fullmatch(r"\d+")
    df = df[is_station].reset_index(drop=True)

    # --- identity -------------------------------------------------------------
    # The zero-padded six-character form BOM uses in filenames and URLs. Kept as
    # text: the leading zeros are data, not formatting.
    df["station_id"] = df["site"].str.strip().str.zfill(STATION_ID_WIDTH)

    # --- types ----------------------------------------------------------------
    for col in ["start_year", "end_year", "wmo_id"]:
        # Int64 (capital I) is nullable; int64 is not and would force NaN to float.
        df[col] = pd.to_numeric(df[col], errors="coerce").astype("Int64")

    for col in ["latitude", "longitude", "elevation_m", "barometer_elevation_m"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # district stays text: 1,895 values carry a leading zero ('01'), and observed
    # lengths run from 0 to 4. An integer cast would silently destroy that.
    for col in ["name", "district", "state", "location_source"]:
        df[col] = df[col].astype("string").str.strip()

    # Fixed-width padding leaves irregular internal spacing in names.
    df["name"] = df["name"].str.replace(r"\s+", " ", regex=True)

    # A station is still recording when the register gives it no end year.
    df["is_active"] = df["end_year"].isna()

    return df[COLUMNS]


# ---------------------------------------------------------------- validation
def validate(df: pd.DataFrame) -> list[str]:
    """Return a list of contract violations. Empty means the frame is conformant."""
    problems: list[str] = []

    def check(condition: bool, message: str) -> None:
        if not condition:
            problems.append(message)

    check(df["station_id"].is_unique, "station_id is not unique")
    check(
        df["station_id"].str.fullmatch(r"\d{6}").all(),
        "station_id must be exactly six digits",
    )
    check(df["name"].notna().all(), "name must not be null")
    check(df["latitude"].between(-90, 90).all(), "latitude outside -90..90")
    check(df["longitude"].between(-180, 180).all(), "longitude outside -180..180")
    check(df["start_year"].notna().all(), "start_year must not be null")

    ended = df["end_year"].notna()
    check(
        (df.loc[ended, "end_year"] >= df.loc[ended, "start_year"]).all(),
        "end_year is earlier than start_year for some stations",
    )
    check(
        (df["is_active"] == df["end_year"].isna()).all(),
        "is_active disagrees with end_year",
    )

    states = set(df["state"].dropna().unique())
    check(
        states <= VALID_STATES,
        f"unexpected state codes: {sorted(states - VALID_STATES)}",
    )

    wmo = df["wmo_id"].dropna()
    check(wmo.is_unique, "wmo_id is not unique among non-null values")

    # The sentinel ban: no contract column may contain a missing-marker string.
    for col in ["name", "district", "state", "location_source"]:
        offenders = df[col].dropna().isin(MISSING_TOKENS | {"N/A", "Present"})
        check(not offenders.any(), f"{col} contains sentinel strings")

    return problems


def write_csv(df: pd.DataFrame, output_path: Path | str = DEFAULT_OUTPUT) -> Path:
    """Write the contract CSV. Missing values are written as empty fields."""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_path, index=False, na_rep="")
    return output_path


def main(argv: list[str]) -> int:
    register = Path(argv[1]) if len(argv) > 1 else DEFAULT_REGISTER
    output = Path(argv[2]) if len(argv) > 2 else DEFAULT_OUTPUT

    if not register.exists():
        print(f"Register not found: {register}", file=sys.stderr)
        return 1

    stations = parse_register(register)

    problems = validate(stations)
    if problems:
        print("Contract violations:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    written = write_csv(stations, output)
    active = int(stations["is_active"].sum())
    print(f"{len(stations)} stations parsed ({active} still recording)")
    print(f"written to {written}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
