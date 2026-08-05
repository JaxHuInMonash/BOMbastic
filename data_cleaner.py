#!/usr/bin/env python3
"""
clean_bom.py — Clean and merge bulk BOM (Bill of Materials) CSV files.

WHAT IT DOES
------------
1. Reads every .csv in an input folder (columns don't need to match between files).
2. Standardizes column names using a configurable alias map (e.g. "Mfr P/N",
   "MPN", "manufacturer_part_no" all become "manufacturer_part_number").
3. Flags rows with missing values in required fields (doesn't drop them, so
   you can review before deciding what to do).
4. Removes duplicate rows based on a configurable set of key columns.
5. Merges everything into one master CSV, tagged with the source filename.
6. Writes a summary report (per-file column mapping, unmapped columns,
   duplicate counts, missing-value counts) so you can see exactly what
   happened to your data.

USAGE
-----
    python clean_bom.py --input ./raw_boms --output ./cleaned

    # customize which columns count as "the part number" for dedup, etc.
    python clean_bom.py --input ./raw_boms --output ./cleaned \
        --key-columns part_number reference_designator

    # see column mapping/report without writing the merged file
    python clean_bom.py --input ./raw_boms --output ./cleaned --dry-run

CUSTOMIZING COLUMN MAPPING
---------------------------
Edit the COLUMN_ALIASES dict below to match the column-name variants you
actually see in your files. Any incoming column that isn't recognized is
kept as-is (prefixed in the report as "unmapped") so you don't silently
lose data — check the report and add it to COLUMN_ALIASES if it's a known
field under a new name.
"""

import argparse
import logging
import re
import sys
from pathlib import Path

import pandas as pd

# ---------------------------------------------------------------------------
# CONFIG — edit this section to match your BOM column conventions
# ---------------------------------------------------------------------------

# Canonical column name -> list of variant names seen across your files.
# Matching is case/space/punctuation-insensitive (see _normalize_key below),
# so "Mfr P/N", "mfr_pn", "MFR-PN" all match "mfr p n".
COLUMN_ALIASES = {
    "part_number": [
        "part number", "part no", "partno", "pn", "part_number", "item number",
        "item no", "component", "internal part number",
    ],
    "description": [
        "description", "desc", "part description", "item description",
    ],
    "quantity": [
        "quantity", "qty", "qty required", "quantity required", "amount",
    ],
    "manufacturer": [
        "manufacturer", "mfr", "mfg", "vendor", "brand",
    ],
    "manufacturer_part_number": [
        "manufacturer part number", "mfr part number", "mfr p n", "mpn",
        "manufacturer pn", "vendor part number",
    ],
    "reference_designator": [
        "reference designator", "ref des", "refdes", "designator", "ref",
    ],
    "unit_cost": [
        "unit cost", "unit price", "cost", "price", "unit_cost",
    ],
    "supplier": [
        "supplier", "distributor", "source",
    ],
}

# Columns that must be non-empty for a row to be considered "complete".
# Rows missing any of these are flagged (not dropped) in the output.
REQUIRED_COLUMNS = ["part_number", "description", "quantity"]

# Columns used to identify duplicate rows. Can be overridden with --key-columns.
DEFAULT_KEY_COLUMNS = ["part_number"]

# ---------------------------------------------------------------------------

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("clean_bom")


def _normalize_key(name: str) -> str:
    """Lowercase, strip, collapse punctuation/whitespace for fuzzy matching."""
    name = str(name).strip().lower()
    name = re.sub(r"[\s_\-/\.]+", " ", name)
    name = re.sub(r"[^\w ]", "", name)
    return name.strip()


# Build reverse lookup: normalized alias -> canonical name
_ALIAS_LOOKUP = {}
for canonical, aliases in COLUMN_ALIASES.items():
    _ALIAS_LOOKUP[_normalize_key(canonical)] = canonical
    for alias in aliases:
        _ALIAS_LOOKUP[_normalize_key(alias)] = canonical


def map_columns(columns):
    """Return (renamed_columns, mapping_report) for a list of raw column names."""
    renamed = []
    report = []
    for col in columns:
        key = _normalize_key(col)
        canonical = _ALIAS_LOOKUP.get(key)
        if canonical:
            renamed.append(canonical)
            report.append((col, canonical, "mapped"))
        else:
            # Keep unrecognized columns as-is (normalized), don't drop data.
            fallback = key.replace(" ", "_") or col
            renamed.append(fallback)
            report.append((col, fallback, "UNMAPPED"))
    return renamed, report


def load_and_standardize(filepath: Path):
    """Load one CSV, standardize its columns, tag with source file."""
    import warnings
    try:
        # index_col=False stops pandas from silently treating an extra field
        # in a malformed row as an index column (which shifts every other
        # value one column to the left without any error/warning).
        # on_bad_lines="warn" reports rows with the wrong number of fields
        # instead of silently misaligning them.
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            df = pd.read_csv(
                filepath, dtype=str, keep_default_na=False, na_values=[""],
                index_col=False, engine="python", on_bad_lines="warn",
            )
        for w in caught:
            log.warning(f"  ! {filepath.name}: {w.message}")
    except Exception as e:
        log.warning(f"  ! Failed to read {filepath.name}: {e}")
        return None, []

    new_cols, mapping_report = map_columns(df.columns)
    df.columns = new_cols

    # Collapse accidental duplicate columns after mapping (e.g. two source
    # columns both mapped to "quantity") by keeping the first non-null value
    # across the duplicated columns, in column order.
    if len(set(new_cols)) != len(new_cols):
        collapsed = {}
        for name in dict.fromkeys(new_cols):  # unique, order-preserving
            same_named = df.loc[:, [c == name for c in df.columns]]
            if same_named.shape[1] > 1:
                collapsed[name] = same_named.bfill(axis=1).iloc[:, 0]
            else:
                collapsed[name] = same_named.iloc[:, 0]
        df = pd.DataFrame(collapsed)

    df["source_file"] = filepath.name
    return df, mapping_report


def flag_missing(df: pd.DataFrame):
    """Add a 'missing_fields' column listing which required fields are blank."""
    present_required = [c for c in REQUIRED_COLUMNS if c in df.columns]
    missing_required = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing_required:
        log.info(f"  (required columns not present in merged data: {missing_required})")

    def row_missing(row):
        missing = [c for c in present_required if pd.isna(row.get(c)) or str(row.get(c)).strip() == ""]
        return ", ".join(missing)

    df["missing_fields"] = df.apply(row_missing, axis=1) if present_required else ""
    return df


def dedupe(df: pd.DataFrame, key_columns):
    key_columns = [c for c in key_columns if c in df.columns]
    if not key_columns:
        log.warning(f"  ! None of the requested key columns {key_columns} exist — skipping dedup.")
        return df, 0
    before = len(df)
    df = df.drop_duplicates(subset=key_columns, keep="first")
    removed = before - len(df)
    return df, removed


def main():
    parser = argparse.ArgumentParser(description="Clean and merge bulk BOM CSV files.")
    parser.add_argument("--input", required=True, help="Folder containing input .csv files")
    parser.add_argument("--output", required=True, help="Folder to write cleaned output into")
    parser.add_argument(
        "--key-columns", nargs="+", default=DEFAULT_KEY_COLUMNS,
        help=f"Canonical column names used to detect duplicates (default: {DEFAULT_KEY_COLUMNS})",
    )
    parser.add_argument("--dry-run", action="store_true", help="Only print the report, don't write output files")
    args = parser.parse_args()

    input_dir = Path(args.input)
    output_dir = Path(args.output)
    if not input_dir.is_dir():
        log.error(f"Input folder not found: {input_dir}")
        sys.exit(1)

    csv_files = sorted(input_dir.glob("*.csv"))
    if not csv_files:
        log.error(f"No .csv files found in {input_dir}")
        sys.exit(1)

    log.info(f"Found {len(csv_files)} CSV file(s) in {input_dir}\n")

    all_frames = []
    all_reports = []
    for f in csv_files:
        log.info(f"Processing {f.name} ...")
        df, mapping_report = load_and_standardize(f)
        if df is None:
            continue
        unmapped = [r for r in mapping_report if r[2] == "UNMAPPED"]
        if unmapped:
            log.info(f"  Unmapped columns kept as-is: {[u[0] for u in unmapped]}")
        all_frames.append(df)
        for orig, canon, status in mapping_report:
            all_reports.append({"file": f.name, "original_column": orig, "mapped_to": canon, "status": status})

    if not all_frames:
        log.error("No files were successfully loaded.")
        sys.exit(1)

    merged = pd.concat(all_frames, ignore_index=True, sort=False)
    total_rows = len(merged)

    merged = flag_missing(merged)
    n_missing = (merged["missing_fields"] != "").sum() if "missing_fields" in merged.columns else 0

    merged, n_duplicates = dedupe(merged, args.key_columns)

    log.info("\n--- Summary ---")
    log.info(f"Files processed:      {len(all_frames)}")
    log.info(f"Total rows read:      {total_rows}")
    log.info(f"Duplicate rows removed ({args.key_columns}): {n_duplicates}")
    log.info(f"Rows missing required fields ({REQUIRED_COLUMNS}): {n_missing}")
    log.info(f"Final row count:      {len(merged)}")

    if args.dry_run:
        log.info("\n[dry run] No files written.")
        return

    output_dir.mkdir(parents=True, exist_ok=True)
    merged_path = output_dir / "merged_bom_cleaned.csv"
    report_path = output_dir / "column_mapping_report.csv"

    merged.to_csv(merged_path, index=False)
    pd.DataFrame(all_reports).to_csv(report_path, index=False)

    log.info(f"\nWrote: {merged_path}")
    log.info(f"Wrote: {report_path}")


if __name__ == "__main__":
    main()