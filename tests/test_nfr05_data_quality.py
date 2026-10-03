"""
NFR-05 evidence: proves the cleaning pipeline handles missing/invalid
BOM station records correctly rather than silently showing bad data.

This builds a small synthetic fixture that mirrors the real BOM
fixed-width station file format (product line, header, dashed rule,
data rows with '..' missing tokens, copyright footer), runs it through
clean_bom_stations.clean_bom_station_file, and checks each acceptance
criterion from the RTM individually.

Run:
    python test_nfr05_data_quality.py
"""

import sys
import tempfile
import os
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from clean_bom_stations import clean_bom_station_file


FIXTURE = """IDCJMC0014                                                                    Bureau of Meteorology

Site   Dist  Site Name                Start   End   Lat     Lon     Source  State  Height (m)  Bar_ht  WMO
------ ----- ------------------------ ------- ----- ------- ------- ------- ------ ----------- ------- ------
001006 1     WYNDHAM AERO             1971    ..    -15.51   128.15 GPS     WA           4.8    ..     94211
001999 1     MISSING EVERYTHING       ..      ..     ..       ..    ..      ..           ..     ..     ..
Product of the Bureau of Meteorology, (C) copyright Commonwealth of Australia 2026
This copyright notice has no site number and must be dropped, not parsed as a row
"""


def run():
    with tempfile.TemporaryDirectory() as tmp:
        input_path = os.path.join(tmp, "fixture_stations.txt")
        output_path = os.path.join(tmp, "fixture_cleaned.csv")

        with open(input_path, "w") as f:
            f.write(FIXTURE)

        df = clean_bom_station_file(input_path, output_path)

        print("--- Cleaned output ---")
        print(df.to_string(index=False))
        print()

        checks = []

        # 1. missing end_year becomes NaN/NA, not a string or zero
        row = df[df["site"] == 1006].iloc[0]
        checks.append(("Missing end_year -> NA (not 0/blank string)", pd.isna(row["end_year"])))

        # 2. missing end_year -> is_active True
        checks.append(("Missing end_year -> is_active=True", bool(row["is_active"]) is True))

        # 3. a row that's entirely missing except site id still parses, doesn't crash
        checks.append(("All-missing row still present (not silently dropped)", 1999 in df["site"].tolist()))

        # 4. copyright/footer text never appears as a fake row
        checks.append(("Copyright footer excluded from rows", not df["site_name"].str.contains("copyright", case=False, na=False).any()))

        # 5. station_id is the zero-padded 6-char BOM code
        checks.append(("station_id zero-padded to 6 chars", row["station_id"] == "001006"))

        print("--- NFR-05 acceptance criteria ---")
        all_passed = True
        for name, passed in checks:
            print(f"[{'PASS' if passed else 'FAIL'}] {name}")
            all_passed = all_passed and passed

        print()
        print("ALL CHECKS PASSED" if all_passed else "SOME CHECKS FAILED")
        return all_passed


if __name__ == "__main__":
    ok = run()
    sys.exit(0 if ok else 1)
