"""
Build <variable>_all.csv, the single input observations_database.sql loads.

Concatenates the per-station BOM CSVs for one variable: one header line, then
every file's data rows, in station order. Values are copied as text, never
parsed, so nothing is reformatted on the way into the database.

Which files go in:
  tmax, tmin   every file in data/temperature/<variable>/
  rainfall     every file in data/rainfall/selected/ (the 219 chosen stations),
               plus rainfall for any station that also has temperature, so a
               station a user can switch to temperature for, or run a
               regression at, always has its rainfall in the database too.
               --all-rainfall takes every held rainfall file instead.

Usage, from the repository root:
    python BOM-Scraper/combine_csvs.py tmax
    python BOM-Scraper/combine_csvs.py rainfall
    python BOM-Scraper/combine_csvs.py rainfall --all-rainfall
    psql -v ON_ERROR_STOP=1 -v variable=tmax -f observations_database.sql
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "BOM-Scraper" / "data"
RAINFALL_DIR = DATA_DIR / "rainfall"
TEMPERATURE_DIR = DATA_DIR / "temperature"
VARIABLES = ("rainfall", "tmax", "tmin")
COLUMNS = 8


def rainfall_files(rainfall_dir: Path = RAINFALL_DIR, temperature_dir: Path = TEMPERATURE_DIR,
                   everything: bool = False) -> list[Path]:
    held: dict[str, Path] = {}
    for sub in ("others", ""):            # selected/ last, so it wins if a file is in two places
        for path in (rainfall_dir / sub).glob("*.csv") if (rainfall_dir / sub).is_dir() else []:
            held.setdefault(path.stem, path)
    for path in sorted((rainfall_dir / "selected").glob("*.csv")):
        held[path.stem] = path

    if everything:
        return [held[s] for s in sorted(held)]

    wanted = {p.stem for p in (rainfall_dir / "selected").glob("*.csv")}
    for variable in ("tmax", "tmin"):
        folder = temperature_dir / variable
        if folder.is_dir():
            wanted.update(p.stem for p in folder.glob("*.csv"))
    return [held[s] for s in sorted(wanted) if s in held]


def files_for(variable: str, everything: bool = False,
              rainfall_dir: Path = RAINFALL_DIR, temperature_dir: Path = TEMPERATURE_DIR) -> list[Path]:
    if variable == "rainfall":
        return rainfall_files(rainfall_dir, temperature_dir, everything)
    return sorted((temperature_dir / variable).glob("*.csv"))


def combine(files: list[Path], output: Path) -> tuple[int, int]:
    """Write one header and every data row. Returns (files, data rows)."""
    if not files:
        raise SystemExit("No input files found.")
    header = None
    rows = 0
    with open(output, "w", encoding="utf-8", newline="\n") as out:
        for path in files:
            lines = path.read_text(encoding="utf-8-sig").splitlines()
            if not lines:
                continue
            first = lines[0]
            if first.count(",") + 1 != COLUMNS or not first.lower().startswith("product code"):
                raise SystemExit(f"{path}: unexpected header {first!r}; is this a BOM daily CSV?")
            if header is None:
                header = first
                out.write(header + "\n")
            for line in lines[1:]:
                if line.strip():
                    out.write(line + "\n")
                    rows += 1
    return len(files), rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("variable", choices=VARIABLES)
    parser.add_argument("--all-rainfall", action="store_true",
                        help="rainfall only: include every held station, not just selected + temperature stations")
    parser.add_argument("--out", type=Path, help="output path (default: <variable>_all.csv in the repo root)")
    args = parser.parse_args(argv)

    output = args.out or REPO_ROOT / f"{args.variable}_all.csv"
    files = files_for(args.variable, args.all_rainfall)
    n_files, n_rows = combine(files, output)
    try:
        shown = output.resolve().relative_to(REPO_ROOT)
    except ValueError:
        shown = output
    print(f"{n_files} station files, {n_rows:,} rows -> {shown}")
    print(f"next: psql -v ON_ERROR_STOP=1 -v variable={args.variable} -f observations_database.sql")
    return 0


if __name__ == "__main__":
    sys.exit(main())
