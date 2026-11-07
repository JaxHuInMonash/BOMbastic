"""
Build the station list for the map (FR-03).

Earlier version binned cleaned_stations.csv by lat/lon and picked a few
per bin. That's a reasonable fallback, but it produced markers for
stations we have no rainfall data for at all - clicking them would have
nothing to show. This version instead maps the station metadata onto
the stations we ACTUALLY have rainfall history for (rainfall_data.py's
output, sorted by station_sorter.py into selected/ and others/), so
every marker on the map corresponds to real, explorable data.

Station metadata comes from BOM-Scraper/data/stations.csv, the output of
station_parser.py, whose columns are fixed by docs/data-contract.md
section 2. The JSON written here keeps its own short keys (lat, lon) because
the frontend and backend already read those; only the input side changed.

Usage:
    python build_map_stations.py                                    # repo defaults
    python build_map_stations.py <stations.csv> <rainfall_dir> <output.json>

<rainfall_dir> is the directory containing selected/ and others/
subfolders of per-station rainfall CSVs (BOM-Scraper/data/rainfall).
"""

import sys
import os
import json
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent
DEFAULT_STATIONS = REPO_ROOT / "BOM-Scraper" / "data" / "stations.csv"
DEFAULT_RAINFALL_DIR = REPO_ROOT / "BOM-Scraper" / "data" / "rainfall"
DEFAULT_OUTPUT = REPO_ROOT / "backend" / "map_stations.json"

# Contract column -> key the map JSON has always used.
OUTPUT_KEYS = {
    "station_id": "station_id",
    "name": "name",
    "latitude": "lat",
    "longitude": "lon",
    "state": "state",
}


def stations_with_rainfall(rainfall_dir: str):
    """station_id -> 'selected' | 'others', for every station we have a
    rainfall CSV for. 'selected' stations were picked by
    station_sorter.py/bin_choices.py as the best-recorded station in
    their lat/lon bin; 'others' are the rest."""
    mapping = {}
    for subdir, tag in (("selected", "selected"), ("others", "others")):
        path = os.path.join(rainfall_dir, subdir)
        if not os.path.isdir(path):
            continue
        for filename in os.listdir(path):
            if filename.endswith(".csv"):
                station_id = os.path.splitext(filename)[0]
                mapping[station_id] = tag

    # fall back to the flat directory too, in case station_sorter.py
    # hasn't been run yet and files are still unsorted
    if os.path.isdir(rainfall_dir):
        for filename in os.listdir(rainfall_dir):
            if filename.endswith(".csv"):
                station_id = os.path.splitext(filename)[0]
                mapping.setdefault(station_id, "unsorted")

    return mapping


def build_map_stations(stations_csv, rainfall_dir, output_json):
    # station_id and state stay text: '001006', not 1006.
    df = pd.read_csv(stations_csv, dtype={"station_id": str, "state": str})

    missing = [c for c in OUTPUT_KEYS if c not in df.columns]
    if missing:
        raise SystemExit(
            f"{stations_csv} is missing contract columns {missing}. "
            "Regenerate it with: python BOM-Scraper/station_parser.py"
        )

    df = df.dropna(subset=["latitude", "longitude"])

    rainfall_map = stations_with_rainfall(str(rainfall_dir))
    df = df[df["station_id"].isin(rainfall_map.keys())].copy()
    df["data_tier"] = df["station_id"].map(rainfall_map)

    records = (
        df[list(OUTPUT_KEYS) + ["data_tier"]]
        .rename(columns=OUTPUT_KEYS)
        .to_dict(orient="records")
    )

    with open(output_json, "w") as f:
        json.dump(records, f, indent=2)

    selected_count = sum(1 for r in records if r["data_tier"] == "selected")
    print(f"{len(records)} stations written to {output_json} "
          f"({selected_count} 'selected' / {len(records) - selected_count} 'others')")
    return records


if __name__ == "__main__":
    if len(sys.argv) == 1:
        build_map_stations(DEFAULT_STATIONS, DEFAULT_RAINFALL_DIR, DEFAULT_OUTPUT)
    elif len(sys.argv) == 4:
        build_map_stations(sys.argv[1], sys.argv[2], sys.argv[3])
    else:
        print("Usage: python build_map_stations.py [<stations.csv> <rainfall_dir> <output.json>]")
        sys.exit(1)
