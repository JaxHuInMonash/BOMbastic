"""
Select a bounded, geographically spread set of candidate stations.

Parsing lives in `station_parser.py`; this module only selects. Before the
contract (docs/data-contract.md) this file did both, which is how the project
ended up with two incompatible parsers for the same source file.

The strategy, unchanged from Raedan's original:

  1. keep only stations still recording
  2. keep only those active for at least MIN_YEARS_ACTIVE
  3. bin every station into a BIN_DEGREES-square latitude/longitude cell
  4. take the CANDIDATES_PER_CELL longest-running stations in each cell

Ranking by years active is a pre-filter, not a quality measure: it uses the
station's opening year from the register, before any observation data exists.
It is known to favour long-lived river-height gauges that record no rainfall --
see docs/data-sources.md section 7.

One change of substance from the original: step 4 breaks ties on station_id.
Without a tiebreak the cut-off between 5th and 6th place is decided by NumPy's
sort implementation, so the candidate list depends on the pandas version of
whoever ran it. 29 of 233 cells are tied at that boundary. See
docs/data-sources.md section 6.

Because that changes which stations are selected, this script will not overwrite
an existing candidate list unless asked. Run it without arguments to see whether
the committed list still matches; pass --refresh-candidates to replace it.

Usage:
    python BOM-Scraper/stations_list.py                      # report only
    python BOM-Scraper/stations_list.py --refresh-candidates # rewrite the list
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import pandas as pd

from station_parser import DEFAULT_REGISTER, parse_register, validate, write_csv

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "BOM-Scraper" / "data"
STATIONS_CSV = DATA_DIR / "stations.csv"
CANDIDATES_CSV = DATA_DIR / "candidate_stations.csv"

BIN_DEGREES = 2
CANDIDATES_PER_CELL = 5
MIN_YEARS_ACTIVE = 10


def add_grid_bins(df: pd.DataFrame, size: int = BIN_DEGREES) -> pd.DataFrame:
    """Label each station with the cell it falls in.

    Floor division rounds toward negative infinity, so for southern latitudes the
    label is the cell's southern edge: -37.8 -> -38.0. Same for western edges.
    """
    df = df.copy()
    df["lat_bin"] = (df["latitude"] // size) * size
    df["lon_bin"] = (df["longitude"] // size) * size
    return df


def select_candidates(
    stations: pd.DataFrame,
    per_cell: int = CANDIDATES_PER_CELL,
    min_years: int = MIN_YEARS_ACTIVE,
    as_at: int | None = None,
) -> pd.DataFrame:
    """Return the longest-running active stations in each grid cell."""
    # Taken from the clock rather than hardcoded, so the filter does not silently
    # age as the project runs into a new year.
    as_at = as_at if as_at is not None else date.today().year

    active = stations[stations["is_active"]].copy()
    active["years_active"] = as_at - active["start_year"].astype(int)
    active = active[active["years_active"] >= min_years]

    binned = add_grid_bins(active)

    return (
        # station_id is the tiebreak, not decoration: years_active alone leaves the
        # 5th/6th cut-off to the sort implementation. See the module docstring.
        binned.sort_values(["years_active", "station_id"], ascending=[False, True])
        .groupby(["lat_bin", "lon_bin"], sort=False)
        .head(per_cell)
        .reset_index(drop=True)
    )


def read_existing_ids(path: Path) -> set[str] | None:
    """Station ids in an existing candidate list, or None if there is not one.

    Reads the pre-contract column name as well, so the currently committed list
    can be compared without being rewritten first.
    """
    if not path.exists():
        return None
    existing = pd.read_csv(path, dtype=str)
    column = "station_id" if "station_id" in existing.columns else "STN"
    return set(existing[column].str.strip().str.zfill(6))


def main(argv: list[str]) -> int:
    refresh = "--refresh-candidates" in argv[1:]

    stations = parse_register(DEFAULT_REGISTER)

    problems = validate(stations)
    if problems:
        print("Contract violations, refusing to write:")
        for problem in problems:
            print(f"  - {problem}")
        return 1

    write_csv(stations, STATIONS_CSV)

    candidates = select_candidates(stations)
    cells = candidates.groupby(["lat_bin", "lon_bin"], sort=False).ngroups
    print(f"{len(stations)} stations parsed -> {STATIONS_CSV.name}")
    print(f"{len(candidates)} candidates in {cells} cells")

    previous = read_existing_ids(CANDIDATES_CSV)
    if previous is not None:
        selected = set(candidates["station_id"])
        added = sorted(selected - previous)
        dropped = sorted(previous - selected)
        if added or dropped:
            print(
                f"\nThis selection differs from {CANDIDATES_CSV.name}: "
                f"{len(added)} added, {len(dropped)} dropped."
            )
            print(f"  added:   {', '.join(added)}")
            print(f"  dropped: {', '.join(dropped)}")
            print(
                "  Every difference is a tie on years_active. Adopting this list means "
                "downloading the added stations and leaving the dropped ones as orphans."
            )
        else:
            print(f"\nSelection is unchanged from {CANDIDATES_CSV.name}.")

    if previous is not None and not refresh:
        print(
            f"\n{CANDIDATES_CSV.name} left untouched. "
            "Pass --refresh-candidates to replace it."
        )
        return 0

    CANDIDATES_CSV.parent.mkdir(parents=True, exist_ok=True)
    candidates.to_csv(CANDIDATES_CSV, index=False, na_rep="")
    print(f"\nwritten to {CANDIDATES_CSV}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
