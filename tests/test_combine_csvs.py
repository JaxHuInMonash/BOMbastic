"""
Tests for BOM-Scraper/combine_csvs.py.

Run from the repository root:
    python -m unittest tests.test_combine_csvs -v
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "BOM-Scraper"))

import combine_csvs as cc  # noqa: E402

RAIN_HEADER = ("Product code,Bureau of Meteorology station number,Year,Month,Day,"
               "Rainfall amount (millimetres),Period over which rainfall was measured (days),Quality")
TMAX_HEADER = ("Product code,Bureau of Meteorology station number,Year,Month,Day,"
               "Maximum temperature (Degree C),Days of accumulation of maximum temperature,Quality")


class Layout(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.rain = self.root / "rainfall"
        self.temp = self.root / "temperature"

    def put(self, path: Path, header: str, rows: list[str], crlf: bool = False):
        path.parent.mkdir(parents=True, exist_ok=True)
        sep = "\r\n" if crlf else "\n"
        path.write_bytes((sep.join([header] + rows) + sep).encode("utf-8"))


class TestRainfallSelection(Layout):
    def test_selected_plus_stations_that_have_temperature(self):
        self.put(self.rain / "selected" / "023000.csv", RAIN_HEADER, ["r"])
        self.put(self.rain / "others" / "086338.csv", RAIN_HEADER, ["r"])   # has temperature
        self.put(self.rain / "others" / "001006.csv", RAIN_HEADER, ["r"])   # no temperature
        self.put(self.temp / "tmax" / "086338.csv", TMAX_HEADER, ["t"])
        names = [p.stem for p in cc.rainfall_files(self.rain, self.temp)]
        self.assertEqual(names, ["023000", "086338"])

    def test_all_rainfall_takes_every_held_file(self):
        self.put(self.rain / "selected" / "023000.csv", RAIN_HEADER, ["r"])
        self.put(self.rain / "others" / "001006.csv", RAIN_HEADER, ["r"])
        names = [p.stem for p in cc.rainfall_files(self.rain, self.temp, everything=True)]
        self.assertEqual(names, ["001006", "023000"])

    def test_temperature_station_without_rainfall_is_skipped_not_an_error(self):
        self.put(self.rain / "selected" / "023000.csv", RAIN_HEADER, ["r"])
        self.put(self.temp / "tmin" / "999999.csv", TMAX_HEADER, ["t"])
        self.assertEqual([p.stem for p in cc.rainfall_files(self.rain, self.temp)], ["023000"])


class TestCombine(Layout):
    def test_one_header_all_rows_crlf_removed(self):
        a = self.temp / "tmax" / "014015.csv"
        b = self.temp / "tmax" / "086338.csv"
        self.put(a, TMAX_HEADER, ["IDCJAC0010,014015,2024,01,01,33.1,1,Y", ""], crlf=True)
        self.put(b, TMAX_HEADER, ["IDCJAC0010,086338,2024,01,01,-0.5,1,N",
                                  "IDCJAC0010,086338,2024,01,02,,,"])
        out = self.root / "tmax_all.csv"
        files, rows = cc.combine(cc.files_for("tmax", temperature_dir=self.temp), out)

        self.assertEqual((files, rows), (2, 3))
        text = out.read_bytes()
        self.assertNotIn(b"\r", text)
        lines = text.decode().splitlines()
        self.assertEqual(lines[0], TMAX_HEADER)
        self.assertEqual(lines.count(TMAX_HEADER), 1)
        self.assertIn("IDCJAC0010,086338,2024,01,01,-0.5,1,N", lines)   # copied, not reformatted

    def test_rejects_a_file_that_is_not_a_bom_daily_csv(self):
        self.put(self.temp / "tmax" / "bad.csv", "a,b,c", ["1,2,3"])
        with self.assertRaises(SystemExit):
            cc.combine(cc.files_for("tmax", temperature_dir=self.temp), self.root / "x.csv")

    def test_no_files_is_an_error(self):
        with self.assertRaises(SystemExit):
            cc.combine([], self.root / "x.csv")


if __name__ == "__main__":
    unittest.main(verbosity=2)
