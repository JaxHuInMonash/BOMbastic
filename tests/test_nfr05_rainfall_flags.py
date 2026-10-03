"""
NFR-05 evidence: proves rainfall records are flagged correctly instead
of missing/accumulated/unverified values being shown as normal data.

Builds a synthetic BOM-format rainfall CSV covering all four cases and
checks rainfall.load_flagged_rainfall assigns the right flag to each.

Run:
    python test_nfr05_rainfall_flags.py
"""

import sys
import unittest
import os
import tempfile
import csv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from rainfall import load_flagged_rainfall

HEADER = [
    "Product code", "Bureau of Meteorology station number", "Year", "Month", "Day",
    "Rainfall amount (millimetres)", "Period over which rainfall was measured (days)", "Quality",
]

ROWS = [
    # (year, month, day, rainfall, period, quality) -> expected flag
    (2020, 1, 1, "5.0", "", "Y"),      # ok
    (2020, 1, 2, "", "", ""),          # missing: no reading at all
    (2020, 1, 3, "12.0", "3", "Y"),    # accumulated: 3-day total backdated to day 3
    (2020, 1, 4, "0.0", "", "N"),      # unverified: recorded but not QC'd
]

EXPECTED_FLAGS = ["ok", "missing", "accumulated", "unverified"]


def run():
    with tempfile.TemporaryDirectory() as tmp:
        station_dir = os.path.join(tmp, "others")
        os.makedirs(station_dir)
        csv_path = os.path.join(station_dir, "999999.csv")

        with open(csv_path, "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(HEADER)
            for year, month, day, rainfall, period, quality in ROWS:
                writer.writerow(["IDCJAC0009", "999999", year, month, day, rainfall, period, quality])

        records, summary = load_flagged_rainfall("999999", tmp)

        print("--- Flagged records ---")
        for r in records:
            print(r)
        print()
        print("--- Summary ---")
        print(summary)
        print()

        all_passed = True
        for record, expected in zip(records, EXPECTED_FLAGS):
            passed = record["flag"] == expected
            print(f"[{'PASS' if passed else 'FAIL'}] {record['date']} expected={expected} got={record['flag']}")
            all_passed = all_passed and passed

        # every non-'ok' category should show up in the summary counts, not
        # just the raw records - otherwise a UI reading only the summary
        # would still miss them
        for flag in ("missing", "accumulated", "unverified"):
            passed = summary["counts"][flag] == 1
            print(f"[{'PASS' if passed else 'FAIL'}] summary counts '{flag}' == 1")
            all_passed = all_passed and passed

        print()
        print("ALL CHECKS PASSED" if all_passed else "SOME CHECKS FAILED")
        return all_passed


class TestNFR05RainfallFlags(unittest.TestCase):
    """Lets `python -m unittest discover -s tests` count this evidence.
    Run the file directly to see the per-check PASS/FAIL report."""

    def test_acceptance_criteria(self):
        self.assertTrue(run(), "one or more NFR-05 checks failed; run test_nfr05_rainfall_flags.py directly for details")


if __name__ == "__main__":
    ok = run()
    sys.exit(0 if ok else 1)
