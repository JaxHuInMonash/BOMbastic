"""
Download daily maximum and minimum temperature from BOM Climate Data Online.

Same request pattern as rainfall_data.py: open the station's CDO page, find the
zipped-CSV link on it, download the zip. Two things are deliberately different:

  * The CSV is saved exactly as BOM serves it. rainfall_data.py passes each file
    through pandas, which rewrote the period column as '3.0' and is why every
    accumulation period was once lost on import. Nothing here parses and
    re-writes the data.
  * Every station gets a row in manifest.csv saying what happened and why
    (downloaded, no product, error, unexpected file), so a station that does not
    measure temperature is never confused with a network failure.

Variables, from BOM's own CDO page titles:
    tmax  p_nccObsCode=122  "Daily Maximum Temperature"  IDCJAC0010
    tmin  p_nccObsCode=123  "Daily Minimum Temperature"  IDCJAC0011

Default station set: every station we already hold rainfall for that is still
open and has a WMO id (184 stations). A WMO id marks a synoptic or automatic
weather station, which nearly always records temperature; most of the rest are
rain-only gauges. Stations with no temperature product are recorded, not
retried.

Rate: one request at a time with a pause between requests, as documented in
docs/data-sources.md section 4. Do not add concurrency to speed this up.

Since October 2026 BOM refuses scripted requests to CDO (HTTP 403) while still
serving browsers. The fetch stops at the first refusal and must not be made to
look like a browser to get past it. The supported route is now manual: download
each station's "All years of data" zip in a browser, drop the zips unopened into
data/temperature/downloads/, and import them:

    python BOM-Scraper/temperature_data.py --import            # file every zip in downloads/

The importer reads the product and station from inside each file, so filenames
do not matter, and it applies the same checks and manifest as the fetch.

Usage (from the repository root):
    python BOM-Scraper/temperature_data.py --import           # manual downloads (current route)
    python BOM-Scraper/temperature_data.py --dry-run          # list what would be fetched
    python BOM-Scraper/temperature_data.py --limit 2          # try two stations first
    python BOM-Scraper/temperature_data.py                    # the full default set
    python BOM-Scraper/temperature_data.py --stations 086338 066062
"""

from __future__ import annotations

import argparse
import csv
import io
import os
import re
import sys
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "BOM-Scraper" / "data"
STATIONS_CSV = DATA_DIR / "stations.csv"
RAINFALL_DIR = DATA_DIR / "rainfall"
TEMPERATURE_DIR = DATA_DIR / "temperature"
MANIFEST = TEMPERATURE_DIR / "manifest.csv"
DOWNLOADS_DIR = TEMPERATURE_DIR / "downloads"

CDO_BASE = "https://www.bom.gov.au"
CDO_PAGE = (CDO_BASE + "/jsp/ncc/cdio/weatherData/av?p_nccObsCode={obs_code}"
            "&p_display_type=dailyDataFile&p_startYear=&p_c=&p_stn_num={station_id}")
ZIP_LINK = re.compile(r'href="([^"]*p_display_type=dailyZippedDataFile[^"]*)"')

# variable_code -> (CDO observation code, BOM product code)
VARIABLES = {
    "tmax": ("122", "IDCJAC0010"),
    "tmin": ("123", "IDCJAC0011"),
}

HEADERS = {"User-Agent": "Mozilla/5.0"}   # same as rainfall_data.py
PAUSE_SECONDS = 0.5                       # between every request
TIMEOUT_SECONDS = 30
RETRIES = 2                               # network errors only, never "no product"

MANIFEST_FIELDS = ["station_id", "variable", "status", "detail", "rows",
                   "rows_with_value", "first_date", "last_date", "file", "checked_at"]


# --------------------------------------------------------------------- selection
def default_stations(stations_csv: Path = STATIONS_CSV,
                     rainfall_dir: Path = RAINFALL_DIR) -> list[str]:
    """Open, WMO-registered stations we already hold rainfall for, sorted by id."""
    held = set()
    for sub in ("", "selected", "others"):
        folder = rainfall_dir / sub
        if folder.is_dir():
            held.update(p.stem for p in folder.glob("*.csv"))

    st = pd.read_csv(stations_csv, dtype={"station_id": str, "district": str})
    active = st["is_active"].astype(str).str.lower().eq("true")
    pick = st[active & st["wmo_id"].notna() & st["station_id"].isin(held)]
    return sorted(pick["station_id"])


# Word that must appear in column 6 of each product's header.
VALUE_COLUMN_WORD = {"IDCJAC0009": "rainfall", "IDCJAC0010": "temperature", "IDCJAC0011": "temperature"}


# --------------------------------------------------------------------- fetching
class NoProduct(Exception):
    """The station page exists but offers no file for this variable."""


class UnexpectedFile(Exception):
    """BOM returned something, but not a daily CSV of the expected shape."""


class Refused(Exception):
    """BOM declined the request (HTTP 401, 403 or 429).

    This is an answer, not a fault: the run stops at the first one and is never
    retried. Do not change headers or networks to get past it; see
    docs/data-sources.md section 4.
    """


REFUSAL_CODES = {401, 403, 429}


def _get(session: requests.Session, url: str) -> requests.Response:
    """GET with retries for transient faults only (timeouts, 5xx).

    A refusal or any other 4xx is raised on the first response: asking again
    does not change BOM's answer and only adds load.
    """
    last_error = None
    for attempt in range(RETRIES + 1):
        try:
            response = session.get(url, headers=HEADERS, timeout=TIMEOUT_SECONDS)
        except requests.RequestException as error:      # timeout, DNS, connection reset
            last_error = error
            time.sleep(PAUSE_SECONDS * (attempt + 2))
            continue
        if response.status_code in REFUSAL_CODES:
            raise Refused(f"HTTP {response.status_code} for {url}")
        if 400 <= response.status_code < 500:
            response.raise_for_status()                  # other client errors: no retry
        if response.status_code >= 500:
            last_error = requests.HTTPError(f"HTTP {response.status_code} for {url}")
            time.sleep(PAUSE_SECONDS * (attempt + 2))
            continue
        return response
    raise last_error


def fetch_csv_bytes(session: requests.Session, station_id: str, obs_code: str) -> bytes:
    """Return the daily CSV exactly as BOM serves it inside the zip."""
    page = _get(session, CDO_PAGE.format(obs_code=obs_code, station_id=station_id))
    match = ZIP_LINK.search(page.text)
    if not match:
        raise NoProduct("no zipped data file offered on the station page")

    time.sleep(PAUSE_SECONDS)
    archive = _get(session, CDO_BASE + match.group(1).replace("&amp;", "&"))
    try:
        zf = zipfile.ZipFile(io.BytesIO(archive.content))
    except zipfile.BadZipFile as error:
        raise UnexpectedFile(f"download was not a zip ({error})") from error

    names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
    if len(names) != 1:
        raise UnexpectedFile(f"expected one CSV in the zip, found {names}")
    return zf.read(names[0])


def inspect_csv(raw: bytes, station_id: str, product_code: str) -> dict:
    """Check the file is the daily product we asked for, and summarise it.

    BOM's product page does not document the column names, so this checks the
    shape the importer relies on (eight columns, in BOM's fixed order) and the
    identifiers inside the rows, not the exact header wording.
    """
    text = raw.decode("utf-8-sig", errors="replace")
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        raise UnexpectedFile("empty file")

    header, data = rows[0], [r for r in rows[1:] if any(cell.strip() for cell in r)]
    if len(header) != 8:
        raise UnexpectedFile(f"expected 8 columns, header has {len(header)}: {header}")
    expected = VALUE_COLUMN_WORD.get(product_code, "temperature")
    if expected not in header[5].lower():
        raise UnexpectedFile(f"column 6 is {header[5]!r}, expected a {expected} column")
    if not data:
        raise UnexpectedFile("header only, no data rows")

    products = {r[0].strip() for r in data}
    stations = {r[1].strip().zfill(6) for r in data}
    if products != {product_code}:
        raise UnexpectedFile(f"product code {sorted(products)}, expected {product_code}")
    if stations != {station_id}:
        raise UnexpectedFile(f"station number {sorted(stations)}, expected {station_id}")

    with_value = [r for r in data if r[5].strip()]
    dates = [f"{r[2].strip()}-{int(r[3]):02d}-{int(r[4]):02d}" for r in with_value
             if r[2].strip().isdigit() and r[3].strip().isdigit() and r[4].strip().isdigit()]
    return {
        "rows": len(data),
        "rows_with_value": len(with_value),
        "first_date": min(dates) if dates else "",
        "last_date": max(dates) if dates else "",
        "value_column": header[5],
    }


# --------------------------------------------------------------------- manifest
def read_manifest(path: Path = MANIFEST) -> dict[tuple[str, str], dict]:
    if not path.exists():
        return {}
    with open(path, newline="", encoding="utf-8") as f:
        return {(r["station_id"], r["variable"]): r for r in csv.DictReader(f)}


def write_manifest(entries: dict[tuple[str, str], dict], path: Path = MANIFEST) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=MANIFEST_FIELDS)
        writer.writeheader()
        for key in sorted(entries):
            writer.writerow({k: entries[key].get(k, "") for k in MANIFEST_FIELDS})
    os.replace(tmp, path)


# --------------------------------------------------------------------- driver
def _display_path(path: Path) -> str:
    """Repository-relative path for the manifest, so it reads the same on every machine."""
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return str(path)



def run(station_ids: list[str], variables: list[str], out_dir: Path = TEMPERATURE_DIR,
        session: requests.Session | None = None, dry_run: bool = False,
        retry_errors: bool = False) -> dict[str, int]:
    session = session or requests.Session()
    manifest_path = out_dir / "manifest.csv"
    manifest = read_manifest(manifest_path)
    counts: dict[str, int] = {}

    for variable in variables:
        obs_code, product_code = VARIABLES[variable]
        if not dry_run:
            (out_dir / variable).mkdir(parents=True, exist_ok=True)

        for station_id in station_ids:
            target = out_dir / variable / f"{station_id}.csv"
            previous = manifest.get((station_id, variable), {})

            # Resume: never re-request a file we hold or a product BOM said it lacks.
            if target.exists():
                status = "existing"
            elif previous.get("status") == "no_product":
                status = "skipped_no_product"
            elif previous.get("status") in ("error", "refused") and not retry_errors:
                status = "skipped_" + previous["status"]
            elif dry_run:
                status = "would_fetch"
            else:
                status = None

            if status:
                counts[status] = counts.get(status, 0) + 1
                continue

            entry = {"station_id": station_id, "variable": variable,
                     "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
            try:
                raw = fetch_csv_bytes(session, station_id, obs_code)
                summary = inspect_csv(raw, station_id, product_code)
                target.write_bytes(raw)
                entry.update(status="downloaded", file=_display_path(target),
                             detail=summary.pop("value_column"), **summary)
            except NoProduct as reason:
                entry.update(status="no_product", detail=str(reason))
            except UnexpectedFile as reason:
                entry.update(status="unexpected_file", detail=str(reason))
            except Refused as reason:
                # Record it, then stop the whole run: every later request would get the same answer.
                entry.update(status="refused", detail=str(reason))
                manifest[(station_id, variable)] = entry
                write_manifest(manifest, manifest_path)
                counts["refused"] = counts.get("refused", 0) + 1
                print(f"\nStopped: BOM refused the request ({reason}).\n"
                      "Nothing further was requested. Do not re-run or change headers to get past\n"
                      "this; see docs/data-sources.md section 4 for the alternatives.")
                return counts
            except requests.RequestException as error:
                entry.update(status="error", detail=f"{type(error).__name__}: {error}")

            manifest[(station_id, variable)] = entry
            write_manifest(manifest, manifest_path)   # after every station, so a crash loses nothing
            counts[entry["status"]] = counts.get(entry["status"], 0) + 1
            print(f"{variable} {station_id}: {entry['status']}"
                  + (f" ({entry.get('rows_with_value')} days)" if entry["status"] == "downloaded" else
                     f" - {entry.get('detail', '')}"))
            time.sleep(PAUSE_SECONDS)

    return counts


# --------------------------------------------------------------------- manual import
# Rainfall is accepted too, so a station added by hand (e.g. a city centre) can get
# all three variables through one drop folder. It is filed with the scraped rainfall.
RAINFALL_PRODUCT = "IDCJAC0009"
PRODUCT_TO_VARIABLE = {product: variable for variable, (_, product) in VARIABLES.items()}
PRODUCT_TO_VARIABLE[RAINFALL_PRODUCT] = "rainfall"

# BOM names the CSV inside each zip <product>_<station>_<start year>_Data.csv. The
# "All years of data" download uses 1800; "this year's data" uses the current year.
MEMBER_NAME = re.compile(r"_(\d{4})_Data\.csv$", re.IGNORECASE)


def _reject_single_year(name: str) -> None:
    match = MEMBER_NAME.search(name)
    if match and match.group(1) != "1800":
        raise UnexpectedFile(
            f"this is BOM's {match.group(1)}-only file, not 'All years of data'. "
            "Re-download the 'All years' zip from the same page")


def _rainfall_target(station_id: str, rainfall_dir: Path) -> Path:
    """Keep an already-held station where it is; file a new one under others/."""
    for sub in ("selected", "others", ""):
        existing = rainfall_dir / sub / f"{station_id}.csv"
        if existing.exists():
            return existing
    return rainfall_dir / "others" / f"{station_id}.csv"


def _csv_payloads(path: Path) -> list[tuple[str, bytes]]:
    """(label, raw CSV bytes) for one dropped file: a BOM zip, or a bare CSV."""
    if path.suffix.lower() == ".csv":
        _reject_single_year(path.name)
        return [(path.name, path.read_bytes())]
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile as error:
        raise UnexpectedFile(f"not a readable zip ({error})") from error
    names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
    if len(names) != 1:
        raise UnexpectedFile(f"expected one CSV in the zip, found {names}")
    _reject_single_year(names[0])
    return [(f"{path.name}:{names[0]}", zf.read(names[0]))]


def _identify(raw: bytes) -> tuple[str, str]:
    """Product code and zero-padded station id, read from the first data row."""
    rows = list(csv.reader(io.StringIO(raw.decode("utf-8-sig", errors="replace"))))
    data = [r for r in rows[1:] if len(r) >= 2 and r[0].strip()]
    if not data:
        raise UnexpectedFile("no data rows")
    return data[0][0].strip(), data[0][1].strip().zfill(6)


def import_downloads(folder: Path = DOWNLOADS_DIR, out_dir: Path = TEMPERATURE_DIR,
                     rainfall_dir: Path = RAINFALL_DIR) -> dict[str, int]:
    """File manually downloaded BOM zips into out_dir/<variable>/<station>.csv
    (temperature) or the rainfall folders (rainfall).

    The CSV inside each zip is written byte for byte. The downloads themselves
    are left where they are, as the provenance record.
    """
    manifest_path = out_dir / "manifest.csv"
    manifest = read_manifest(manifest_path)
    counts: dict[str, int] = {}
    files = sorted(p for p in folder.glob("*") if p.suffix.lower() in (".zip", ".csv"))
    if not files:
        print(f"No .zip files in {_display_path(folder)}")
        return counts

    for path in files:
        try:
            for label, raw in _csv_payloads(path):
                product, station_id = _identify(raw)
                variable = PRODUCT_TO_VARIABLE.get(product)
                if variable is None:
                    raise UnexpectedFile(
                        f"product {product} is not one this importer files "
                        f"(expected one of {sorted(PRODUCT_TO_VARIABLE)})")
                summary = inspect_csv(raw, station_id, product)

                if variable == "rainfall":
                    target = _rainfall_target(station_id, rainfall_dir)
                else:
                    target = out_dir / variable / f"{station_id}.csv"
                target.parent.mkdir(parents=True, exist_ok=True)
                if target.exists() and target.read_bytes() == raw:
                    status = "already_imported"
                else:
                    status = "replaced" if target.exists() else "imported"
                    target.write_bytes(raw)

                manifest[(station_id, variable)] = {
                    "station_id": station_id, "variable": variable, "status": "downloaded",
                    "detail": f"manual browser download {label}; {summary.pop('value_column')}",
                    "file": _display_path(target),
                    "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    **summary,
                }
                counts[status] = counts.get(status, 0) + 1
                print(f"{status:16s} {variable} {station_id}  "
                      f"{summary['first_date']} to {summary['last_date']}, "
                      f"{summary['rows_with_value']} days with a value   <- {path.name}")
        except UnexpectedFile as reason:
            counts["rejected"] = counts.get("rejected", 0) + 1
            print(f"{'rejected':16s} {path.name}: {reason}")

    write_manifest(manifest, manifest_path)

    # Which stations can do what, now.
    have = {(k[0], k[1]) for k, v in manifest.items()
            if v.get("status") == "downloaded" and k[1] in VARIABLES}
    stations = sorted({sid for sid, _ in have})
    both = [sid for sid in stations if (sid, "tmax") in have and (sid, "tmin") in have]
    print(f"\n{len(stations)} stations with temperature; {len(both)} with both tmax and tmin "
          f"(needed for a one-station regression).")
    lone = [f"{sid} ({'tmax' if (sid, 'tmax') in have else 'tmin'} only)" for sid in stations if sid not in both]
    if lone:
        print("Missing the other variable: " + ", ".join(lone))
    return counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--stations", nargs="+", help="station ids (default: open WMO stations with rainfall held)")
    parser.add_argument("--variables", nargs="+", default=list(VARIABLES), choices=list(VARIABLES))
    parser.add_argument("--limit", type=int, help="only the first N stations")
    parser.add_argument("--dry-run", action="store_true", help="list what would be fetched; no requests")
    parser.add_argument("--retry-errors", action="store_true", help="re-try stations that failed on a network error")
    parser.add_argument("--import", dest="import_from", nargs="?", const=str(DOWNLOADS_DIR),
                        metavar="FOLDER", help="file manually downloaded zips (default: data/temperature/downloads)")
    args = parser.parse_args(argv)

    if args.import_from:
        counts = import_downloads(Path(args.import_from))
        print("\n" + ", ".join(f"{k}: {v}" for k, v in sorted(counts.items())))
        print(f"manifest: {_display_path(MANIFEST)}")
        return 1 if counts.get("rejected") else 0

    stations = [s.strip().zfill(6) for s in args.stations] if args.stations else default_stations()
    if args.limit:
        stations = stations[: args.limit]

    print(f"{len(stations)} stations x {len(args.variables)} variables"
          + (" (dry run)" if args.dry_run else ""))
    counts = run(stations, args.variables, dry_run=args.dry_run, retry_errors=args.retry_errors)
    print("\n" + ", ".join(f"{k}: {v}" for k, v in sorted(counts.items())))
    if not args.dry_run:
        print(f"manifest: {_display_path(MANIFEST)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
