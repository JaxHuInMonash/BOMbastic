"""
Rainfall data access + data-quality flagging (NFR-05).

Loads a station's daily rainfall CSV (as produced by
BOM-Scraper/rainfall_data.py) and annotates every record with what's
actually reliable about it, instead of just handing back raw numbers:

  - "missing"     no rainfall reading recorded for that day at all
  - "accumulated" BOM's 'Period over which rainfall was measured' is >1,
                  meaning this figure is a multi-day total backdated onto
                  a single date (e.g. the gauge wasn't read for 3 days,
                  so day 3 shows the sum of all 3) - real, but NOT a
                  same-day reading, and treating it as one misleads users
                  comparing daily totals
  - "unverified"  BOM's Quality flag is 'N' (not quality-controlled)
  - "ok"          a normal, quality-controlled, single-day reading

This mirrors the search-across-selected/others/unsorted approach already
used in rainfall_data.py's find_existing(), so a station's file is found
regardless of which folder station_sorter.py filed it into.
"""

import os
import pandas as pd

RAINFALL_COL = "Rainfall amount (millimetres)"
PERIOD_COL = "Period over which rainfall was measured (days)"
QUALITY_COL = "Quality"


def _search_dirs(rainfall_dir: str):
    return (
        rainfall_dir,
        os.path.join(rainfall_dir, "selected"),
        os.path.join(rainfall_dir, "others"),
    )


def find_rainfall_csv(station_id: str, rainfall_dir: str):
    for directory in _search_dirs(rainfall_dir):
        path = os.path.join(directory, f"{station_id}.csv")
        if os.path.exists(path):
            return path
    return None


def _flag_row(rainfall_mm, period_days, quality) -> str:
    if pd.isna(rainfall_mm):
        return "missing"
    if pd.notna(period_days) and period_days > 1:
        return "accumulated"
    if quality == "N":
        return "unverified"
    return "ok"


def load_flagged_rainfall(station_id: str, rainfall_dir: str, start_year=None, end_year=None):
    """Returns (records, summary) for a station, or (None, None) if no
    rainfall file exists for it."""
    path = find_rainfall_csv(station_id, rainfall_dir)
    if path is None:
        return None, None

    df = pd.read_csv(path)

    if start_year is not None:
        df = df[df["Year"] >= start_year]
    if end_year is not None:
        df = df[df["Year"] <= end_year]

    records = []
    for _, row in df.iterrows():
        rainfall_mm = row[RAINFALL_COL]
        period_days = row.get(PERIOD_COL)
        flag = _flag_row(rainfall_mm, period_days, row.get(QUALITY_COL))

        records.append({
            "date": f"{int(row['Year']):04d}-{int(row['Month']):02d}-{int(row['Day']):02d}",
            "rainfall_mm": None if pd.isna(rainfall_mm) else float(rainfall_mm),
            "period_days": None if pd.isna(period_days) else int(period_days),
            "flag": flag,
        })

    total = len(records)
    counts = {"ok": 0, "missing": 0, "accumulated": 0, "unverified": 0}
    for r in records:
        counts[r["flag"]] += 1

    summary = {
        "total_days": total,
        "counts": counts,
        "pct_missing": round(100 * counts["missing"] / total, 1) if total else 0,
        "pct_accumulated": round(100 * counts["accumulated"] / total, 1) if total else 0,
        "pct_unverified": round(100 * counts["unverified"] / total, 1) if total else 0,
    }

    return records, summary
