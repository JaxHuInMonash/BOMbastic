"""
Manual/regression tests for the BOMbastic data pipeline.

Standard library only -- no pytest, nothing to install.

Run from the repository root:
    python -m unittest discover -s tests -v      # everything
    python -m unittest tests.test_pipeline.TestClean -v   # one class
    python -m unittest tests.test_pipeline.TestClean.test_missing_tokens_become_none

Tests that need the real 19,509-row register skip themselves automatically if
BOM-Scraper/stations_list.txt is not present, so the suite still runs on a
fresh clone.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "BOM-Scraper"))

import pandas as pd  # noqa: E402

import station_parser as sp  # noqa: E402
import stations_list as sl  # noqa: E402

REGISTER = REPO_ROOT / "BOM-Scraper" / "stations_list.txt"
HAVE_REGISTER = REGISTER.exists()
needs_register = unittest.skipUnless(
    HAVE_REGISTER, f"{REGISTER.name} not present"
)

# A miniature register. The header and dashed rule are copied verbatim from the
# real IDCJMC0014 file, so the column geometry under test is the real geometry;
# only the data rows are invented. Four rows, each carrying one awkward case:
#   001006  ordinary active station, leading zero in the id
#   002001  closed station -- has an end year
#   003002  BOM's '..' missing markers, and a three-character district
#   004003  a Source containing spaces, which is what breaks str.split()
MINI_REGISTER = """\
Bureau of Meteorology product IDCJMC0014.                                       Produced: 03 Aug 2026

   Site  Dist  Site name                                 Start     End      Lat       Lon Source         STA Height (m)   Bar_ht    WMO
------- ----- ---------------------------------------- ------- ------- -------- --------- -------------- --- ---------- -------- ------
 001006 01    WYNDHAM AERO                                1951    2026 -15.5100  128.1500 GPS            WA        11.0     11.1  94100
 002001 02    OLD STATION (CLOSED)                        1900    1985 -20.0000  120.0000 GPS            WA        50.0       ..     ..
 003002 003   SENTINEL TEST                               1960         -30.0000  140.0000 ..             SA          ..       ..     ..
 004003 04    SPACEY SOURCE                               1970         -33.8688  151.2093 MAP 1:250 000  NSW        5.0       ..     ..
"""


# ---------------------------------------------------------------------------
# station_parser.py -- unit level
# ---------------------------------------------------------------------------
class TestFindRuleLine(unittest.TestCase):
    def test_finds_the_dashed_rule(self):
        lines = ["header", "  Site  Dist", "------- -----", "   1006 01"]
        self.assertEqual(sp.find_rule_line(lines), 2)

    def test_skips_blank_lines_before_the_rule(self):
        lines = ["", "   ", "title", "--- ---", "data"]
        self.assertEqual(sp.find_rule_line(lines), 3)

    def test_raises_when_there_is_no_rule(self):
        with self.assertRaises(ValueError):
            sp.find_rule_line(["just", "some", "text"])


class TestColspecs(unittest.TestCase):
    def test_one_span_per_dash_run(self):
        spans = sp.colspecs_from_rule("--- ----- --", longest_line=12)
        self.assertEqual(spans, [(0, 3), (4, 9), (10, 12)])

    def test_last_span_widens_to_the_longest_line(self):
        # The rule stops at 12 but a data row runs to 30: the final field must
        # not be clipped.
        spans = sp.colspecs_from_rule("--- ----- --", longest_line=30)
        self.assertEqual(spans[-1], (10, 30))

    def test_last_span_never_shrinks(self):
        spans = sp.colspecs_from_rule("--- ----- --", longest_line=5)
        self.assertEqual(spans[-1], (10, 12))

    def test_raises_on_a_rule_with_no_dashes(self):
        with self.assertRaises(ValueError):
            sp.colspecs_from_rule("        ", longest_line=8)


class TestClean(unittest.TestCase):
    def test_strips_whitespace(self):
        self.assertEqual(sp._clean("  WYNDHAM  "), "WYNDHAM")

    def test_missing_tokens_become_none(self):
        for token in ["..", "...", "....", ".....", "-", "", "  ", "Unknown"]:
            with self.subTest(token=token):
                self.assertIsNone(sp._clean(token))

    def test_real_values_survive(self):
        self.assertEqual(sp._clean("GPS"), "GPS")
        self.assertEqual(sp._clean("0.0"), "0.0")

    def test_non_strings_become_none(self):
        self.assertIsNone(sp._clean(float("nan")))
        self.assertIsNone(sp._clean(None))


class TestParseRegisterMini(unittest.TestCase):
    """Parse the four-row fixture. Fast, and runs without the real register."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        path = Path(cls.tmp.name) / "mini.txt"
        path.write_text(MINI_REGISTER, encoding="utf-8")
        cls.df = sp.parse_register(path)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_row_count_excludes_the_header(self):
        self.assertEqual(len(self.df), 4)

    def test_columns_are_the_contract_columns_in_order(self):
        self.assertEqual(list(self.df.columns), sp.COLUMNS)

    def test_station_id_is_zero_padded_text(self):
        self.assertEqual(list(self.df["station_id"]), ["001006", "002001", "003002", "004003"])
        self.assertTrue(self.df["station_id"].str.fullmatch(r"\d{6}").all())

    def test_district_keeps_its_leading_zero(self):
        self.assertEqual(self.df.loc[0, "district"], "01")
        self.assertEqual(self.df.loc[2, "district"], "003")

    def test_is_active_follows_end_year(self):
        self.assertEqual(list(self.df["is_active"]), [False, False, True, True])

    def test_sentinels_became_nulls(self):
        row = self.df.loc[2]
        self.assertTrue(pd.isna(row["elevation_m"]))
        self.assertTrue(pd.isna(row["wmo_id"]))
        self.assertTrue(pd.isna(row["location_source"]))

    def test_source_containing_spaces_is_not_split(self):
        # The whole point of fixed-width parsing. str.split() would shift every
        # later field on this row and put 'NSW' somewhere it does not belong.
        self.assertEqual(self.df.loc[3, "location_source"], "MAP 1:250 000")
        self.assertEqual(self.df.loc[3, "state"], "NSW")

    def test_year_columns_are_nullable_integers(self):
        self.assertEqual(str(self.df["start_year"].dtype), "Int64")
        self.assertEqual(str(self.df["end_year"].dtype), "Int64")

    def test_the_fixture_passes_validation(self):
        self.assertEqual(sp.validate(self.df), [])


class TestValidate(unittest.TestCase):
    """Corrupt one thing at a time and confirm validate() notices."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / "mini.txt"
        path.write_text(MINI_REGISTER, encoding="utf-8")
        self.df = sp.parse_register(path)

    def assertComplains(self, df, fragment):
        problems = sp.validate(df)
        self.assertTrue(
            any(fragment in p for p in problems),
            f"expected a complaint containing {fragment!r}, got {problems}",
        )

    def test_duplicate_station_id(self):
        df = self.df.copy()
        df.loc[1, "station_id"] = df.loc[0, "station_id"]
        self.assertComplains(df, "not unique")

    def test_malformed_station_id(self):
        df = self.df.copy()
        df.loc[0, "station_id"] = "1006"
        self.assertComplains(df, "six digits")

    def test_latitude_out_of_range(self):
        df = self.df.copy()
        df.loc[0, "latitude"] = 91.0
        self.assertComplains(df, "latitude")

    def test_end_year_before_start_year(self):
        df = self.df.copy()
        df.loc[1, "end_year"] = 1800
        self.assertComplains(df, "end_year")

    def test_is_active_contradicting_end_year(self):
        df = self.df.copy()
        df.loc[0, "is_active"] = True          # row 0 has an end year
        self.assertComplains(df, "is_active")

    def test_unknown_state_code(self):
        df = self.df.copy()
        df.loc[0, "state"] = "XYZ"
        self.assertComplains(df, "state codes")

    def test_duplicate_wmo_id(self):
        df = self.df.copy()
        df.loc[1, "wmo_id"] = df.loc[0, "wmo_id"]
        self.assertComplains(df, "wmo_id")

    def test_sentinel_string_left_in_a_text_column(self):
        df = self.df.copy()
        df.loc[0, "location_source"] = "N/A"
        self.assertComplains(df, "sentinel")


class TestWriteCsv(unittest.TestCase):
    def test_round_trip_preserves_leading_zeros_and_nulls(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        src = Path(tmp.name) / "mini.txt"
        src.write_text(MINI_REGISTER, encoding="utf-8")
        df = sp.parse_register(src)

        out = sp.write_csv(df, Path(tmp.name) / "out" / "stations.csv")
        self.assertTrue(out.exists())

        back = pd.read_csv(out, dtype={"station_id": str, "district": str})
        self.assertEqual(list(back["station_id"]), ["001006", "002001", "003002", "004003"])
        self.assertEqual(back.loc[0, "district"], "01")
        # Missing values must come back as nulls, not as the string 'N/A'.
        self.assertTrue(pd.isna(back.loc[2, "location_source"]))


# ---------------------------------------------------------------------------
# stations_list.py -- unit level
# ---------------------------------------------------------------------------
class TestGridBins(unittest.TestCase):
    def test_southern_and_western_edges_are_the_label(self):
        df = pd.DataFrame({"latitude": [-37.8, -33.9, 0.5], "longitude": [144.9, 151.2, -1.5]})
        binned = sl.add_grid_bins(df, size=2)
        self.assertEqual(list(binned["lat_bin"]), [-38.0, -34.0, 0.0])
        self.assertEqual(list(binned["lon_bin"]), [144.0, 150.0, -2.0])

    def test_exact_boundaries_belong_to_the_cell_above(self):
        df = pd.DataFrame({"latitude": [-38.0], "longitude": [144.0]})
        binned = sl.add_grid_bins(df, size=2)
        self.assertEqual(binned.loc[0, "lat_bin"], -38.0)

    def test_the_input_frame_is_not_mutated(self):
        df = pd.DataFrame({"latitude": [-37.8], "longitude": [144.9]})
        sl.add_grid_bins(df)
        self.assertNotIn("lat_bin", df.columns)


class TestSelectCandidates(unittest.TestCase):
    def make(self, rows):
        df = pd.DataFrame(rows)
        df["end_year"] = pd.array([None] * len(df), dtype="Int64")
        df["is_active"] = True
        return df

    def test_caps_at_per_cell(self):
        # Seven stations in one cell, all distinct ages.
        df = self.make([
            {"station_id": f"00000{i}", "latitude": -37.5, "longitude": 144.5,
             "start_year": 1900 + i}
            for i in range(7)
        ])
        out = sl.select_candidates(df, per_cell=5, as_at=2026)
        self.assertEqual(len(out), 5)
        # The five oldest, i.e. the smallest start years.
        self.assertEqual(sorted(out["start_year"]), [1900, 1901, 1902, 1903, 1904])

    def test_drops_stations_below_the_minimum_age(self):
        df = self.make([
            {"station_id": "000001", "latitude": -37.5, "longitude": 144.5, "start_year": 1900},
            {"station_id": "000002", "latitude": -37.5, "longitude": 144.5, "start_year": 2020},
        ])
        out = sl.select_candidates(df, min_years=10, as_at=2026)
        self.assertEqual(list(out["station_id"]), ["000001"])

    def test_drops_inactive_stations(self):
        df = self.make([
            {"station_id": "000001", "latitude": -37.5, "longitude": 144.5, "start_year": 1900},
            {"station_id": "000002", "latitude": -37.5, "longitude": 144.5, "start_year": 1900},
        ])
        df.loc[1, "is_active"] = False
        out = sl.select_candidates(df, as_at=2026)
        self.assertEqual(list(out["station_id"]), ["000001"])

    def test_ties_break_on_station_id_not_on_row_order(self):
        # Six stations, identical age, one cell. Only five can be chosen, so the
        # cut-off is entirely a tie. Shuffling the input must not change the
        # result -- this is the regression test for the determinism bug.
        rows = [
            {"station_id": f"00000{i}", "latitude": -37.5, "longitude": 144.5,
             "start_year": 1900}
            for i in range(1, 7)
        ]
        first = sl.select_candidates(self.make(rows), per_cell=5, as_at=2026)
        shuffled = sl.select_candidates(
            self.make(list(reversed(rows))), per_cell=5, as_at=2026
        )
        self.assertEqual(
            sorted(first["station_id"]), sorted(shuffled["station_id"])
        )
        self.assertEqual(
            sorted(first["station_id"]),
            ["000001", "000002", "000003", "000004", "000005"],
        )

    def test_cells_are_independent(self):
        df = self.make([
            {"station_id": "000001", "latitude": -37.5, "longitude": 144.5, "start_year": 1900},
            {"station_id": "000002", "latitude": -25.0, "longitude": 133.0, "start_year": 2000},
        ])
        out = sl.select_candidates(df, per_cell=1, as_at=2026)
        self.assertEqual(len(out), 2)


class TestReadExistingIds(unittest.TestCase):
    def write(self, text):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / "candidates.csv"
        path.write_text(text, encoding="utf-8")
        return path

    def test_returns_none_when_the_file_is_absent(self):
        self.assertIsNone(sl.read_existing_ids(Path("no-such-file.csv")))

    def test_reads_the_contract_column(self):
        path = self.write("station_id,name\n001006,WYNDHAM\n")
        self.assertEqual(sl.read_existing_ids(path), {"001006"})

    def test_reads_the_legacy_STN_column(self):
        path = self.write("STN,Name\n001006,WYNDHAM\n")
        self.assertEqual(sl.read_existing_ids(path), {"001006"})

    def test_pads_unpadded_ids(self):
        path = self.write("STN,Name\n1006,WYNDHAM\n")
        self.assertEqual(sl.read_existing_ids(path), {"001006"})


# ---------------------------------------------------------------------------
# Integration -- needs the real register
# ---------------------------------------------------------------------------
@needs_register
class TestRealRegister(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.df = sp.parse_register(REGISTER)

    def test_expected_station_count(self):
        self.assertEqual(len(self.df), 19509)

    def test_register_passes_validation(self):
        self.assertEqual(sp.validate(self.df), [])

    def test_known_stations_are_present_and_padded(self):
        ids = set(self.df["station_id"])
        for known in ["001006", "023000", "074128", "094029", "300000"]:
            with self.subTest(station=known):
                self.assertIn(known, ids)

    def test_leading_zero_districts_survive(self):
        self.assertEqual(int(self.df["district"].str.startswith("0").sum()), 1895)

    def test_active_count(self):
        self.assertEqual(int(self.df["is_active"].sum()), 6316)

    def test_selection_is_reproducible(self):
        a = sl.select_candidates(self.df, as_at=2026)
        b = sl.select_candidates(self.df.sample(frac=1, random_state=7), as_at=2026)
        self.assertEqual(sorted(a["station_id"]), sorted(b["station_id"]))

    def test_selection_shape(self):
        out = sl.select_candidates(self.df, as_at=2026)
        self.assertEqual(len(out), 959)
        self.assertEqual(out.groupby(["lat_bin", "lon_bin"]).ngroups, 233)
        self.assertLessEqual(out.groupby(["lat_bin", "lon_bin"]).size().max(), 5)


if __name__ == "__main__":
    unittest.main(verbosity=2)
