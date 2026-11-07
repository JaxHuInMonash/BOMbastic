"""
Offline tests for BOM-Scraper/temperature_data.py.

No request ever reaches bom.gov.au: a fake session stands in for the network,
serving a CDO-style station page and a zip built in memory.

Run from the repository root:
    python -m unittest tests.test_temperature_data -v
"""

from __future__ import annotations

import csv
import io
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "BOM-Scraper"))

import requests  # noqa: E402

import temperature_data as td  # noqa: E402

HEADER = ("Product code,Bureau of Meteorology station number,Year,Month,Day,"
          "Maximum temperature (Degree C),Days of accumulation of maximum temperature,Quality")


def daily_csv(rows, header=HEADER) -> bytes:
    lines = [header] + [",".join(map(str, r)) for r in rows]
    # BOM serves CRLF; keep it so the "saved exactly as served" check is meaningful.
    return ("\r\n".join(lines) + "\r\n").encode("utf-8")


GOOD_ROWS = [
    ("IDCJAC0010", "086338", 2024, 1, 1, "31.4", "1", "Y"),
    ("IDCJAC0010", "086338", 2024, 1, 2, "", "", ""),         # missing day
    ("IDCJAC0010", "086338", 2024, 1, 3, "-2.5", "1", "N"),   # negative, unverified
]


def zipped(csv_bytes: bytes, name="IDCJAC0010_086338_1800_Data.csv", extra=()) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(name, csv_bytes)
        zf.writestr("IDCJAC0010_086338_1800_Note.txt", "notes")
        for n, data in extra:
            zf.writestr(n, data)
    return buf.getvalue()


class FakeResponse:
    def __init__(self, text="", content=b"", status=200):
        self.text, self.content, self.status_code = text, content, status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code}")


class FakeSession:
    """Serves one station page and one zip per (station, obs code)."""

    def __init__(self, pages: dict, zips: dict):
        self.pages, self.zips, self.calls = pages, zips, []

    def get(self, url, headers=None, timeout=None):
        self.calls.append(url)
        if "dailyZippedDataFile" in url:
            key = url.split("p_stn_num=")[1].split("&")[0]
            return FakeResponse(content=self.zips[key])
        key = (url.split("p_stn_num=")[1], url.split("p_nccObsCode=")[1].split("&")[0])
        page = self.pages.get(key)
        if page is None:
            raise requests.ConnectionError("simulated network failure")
        if isinstance(page, int):
            return FakeResponse(status=page)
        return FakeResponse(text=page)


def station_page(station_id: str, with_link=True) -> str:
    link = (f'<a href="/jsp/ncc/cdio/weatherData/av?p_display_type=dailyZippedDataFile'
            f'&amp;p_stn_num={station_id}&amp;p_c=-123&amp;p_nccObsCode=122">All years of data</a>')
    return f"<html><body>{link if with_link else 'This data is not available'}</body></html>"


class Quiet(unittest.TestCase):
    def setUp(self):
        patches = [mock.patch.object(td, "PAUSE_SECONDS", 0),
                   mock.patch("builtins.print")]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)


class TestInspectCsv(unittest.TestCase):
    def test_summarises_a_good_file(self):
        s = td.inspect_csv(daily_csv(GOOD_ROWS), "086338", "IDCJAC0010")
        self.assertEqual(s["rows"], 3)
        self.assertEqual(s["rows_with_value"], 2)
        self.assertEqual((s["first_date"], s["last_date"]), ("2024-01-01", "2024-01-03"))

    def test_unpadded_station_number_still_matches(self):
        rows = [("IDCJAC0010", "86338", 2024, 1, 1, "31.4", "1", "Y")]
        td.inspect_csv(daily_csv(rows), "086338", "IDCJAC0010")

    def test_rejects_the_wrong_product(self):
        rows = [("IDCJAC0009", "086338", 2024, 1, 1, "3.0", "1", "Y")]
        with self.assertRaisesRegex(td.UnexpectedFile, "product code"):
            td.inspect_csv(daily_csv(rows), "086338", "IDCJAC0010")

    def test_rejects_another_stations_file(self):
        rows = [("IDCJAC0010", "066062", 2024, 1, 1, "31.4", "1", "Y")]
        with self.assertRaisesRegex(td.UnexpectedFile, "station number"):
            td.inspect_csv(daily_csv(rows), "086338", "IDCJAC0010")

    def test_rejects_a_rainfall_shaped_header(self):
        header = HEADER.replace("Maximum temperature (Degree C)", "Rainfall amount (millimetres)")
        with self.assertRaisesRegex(td.UnexpectedFile, "temperature column"):
            td.inspect_csv(daily_csv(GOOD_ROWS, header=header), "086338", "IDCJAC0010")

    def test_rejects_a_changed_column_count(self):
        with self.assertRaisesRegex(td.UnexpectedFile, "8 columns"):
            td.inspect_csv(b"a,b,c\r\n1,2,3\r\n", "086338", "IDCJAC0010")

    def test_rejects_header_only(self):
        with self.assertRaisesRegex(td.UnexpectedFile, "no data rows"):
            td.inspect_csv(daily_csv([]), "086338", "IDCJAC0010")


class TestRun(Quiet):
    def setUp(self):
        super().setUp()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.out = Path(self.tmp.name)

    def manifest(self):
        with open(self.out / "manifest.csv", newline="", encoding="utf-8") as f:
            return {(r["station_id"], r["variable"]): r for r in csv.DictReader(f)}

    def test_downloads_and_saves_the_file_byte_for_byte(self):
        raw = daily_csv(GOOD_ROWS)
        session = FakeSession({("086338", "122"): station_page("086338")}, {"086338": zipped(raw)})
        counts = td.run(["086338"], ["tmax"], out_dir=self.out, session=session)

        self.assertEqual(counts, {"downloaded": 1})
        self.assertEqual((self.out / "tmax" / "086338.csv").read_bytes(), raw)
        entry = self.manifest()[("086338", "tmax")]
        self.assertEqual(entry["status"], "downloaded")
        self.assertEqual(entry["rows_with_value"], "2")
        self.assertIn("temperature", entry["detail"])

    def test_no_product_is_recorded_and_never_retried(self):
        session = FakeSession({("009999", "122"): station_page("009999", with_link=False)}, {})
        td.run(["009999"], ["tmax"], out_dir=self.out, session=session)
        self.assertEqual(self.manifest()[("009999", "tmax")]["status"], "no_product")
        self.assertFalse((self.out / "tmax" / "009999.csv").exists())

        session.calls.clear()
        counts = td.run(["009999"], ["tmax"], out_dir=self.out, session=session)
        self.assertEqual(counts, {"skipped_no_product": 1})
        self.assertEqual(session.calls, [])

    def test_network_error_is_recorded_separately_from_no_product(self):
        session = FakeSession({}, {})
        with mock.patch.object(td, "RETRIES", 0):
            td.run(["086338"], ["tmax"], out_dir=self.out, session=session)
        entry = self.manifest()[("086338", "tmax")]
        self.assertEqual(entry["status"], "error")
        self.assertIn("ConnectionError", entry["detail"])

    def test_errors_are_skipped_on_resume_unless_asked(self):
        with mock.patch.object(td, "RETRIES", 0):
            td.run(["086338"], ["tmax"], out_dir=self.out, session=FakeSession({}, {}))
        raw = daily_csv(GOOD_ROWS)
        good = FakeSession({("086338", "122"): station_page("086338")}, {"086338": zipped(raw)})

        self.assertEqual(td.run(["086338"], ["tmax"], out_dir=self.out, session=good),
                         {"skipped_error": 1})
        self.assertEqual(td.run(["086338"], ["tmax"], out_dir=self.out, session=good,
                                retry_errors=True), {"downloaded": 1})

    def test_a_refusal_stops_the_whole_run_after_one_request(self):
        pages = {(sid, code): 403 for sid in ("086338", "066062", "023000") for code in ("122", "123")}
        session = FakeSession(pages, {})
        counts = td.run(["086338", "066062", "023000"], ["tmax", "tmin"],
                        out_dir=self.out, session=session)
        self.assertEqual(counts, {"refused": 1})
        self.assertEqual(len(session.calls), 1, "a 403 must be neither retried nor followed by more requests")
        self.assertEqual(self.manifest()[("086338", "tmax")]["status"], "refused")

    def test_a_refused_station_is_not_retried_on_resume(self):
        session = FakeSession({("086338", "122"): 403}, {})
        td.run(["086338"], ["tmax"], out_dir=self.out, session=session)
        session.calls.clear()
        self.assertEqual(td.run(["086338"], ["tmax"], out_dir=self.out, session=session),
                         {"skipped_refused": 1})
        self.assertEqual(session.calls, [])

    def test_server_errors_are_retried_but_client_errors_are_not(self):
        session = FakeSession({("086338", "122"): 503}, {})
        with mock.patch.object(td, "RETRIES", 2):
            td.run(["086338"], ["tmax"], out_dir=self.out, session=session)
        self.assertEqual(len(session.calls), 3)
        session = FakeSession({("066062", "122"): 404}, {})
        with mock.patch.object(td, "RETRIES", 2):
            td.run(["066062"], ["tmax"], out_dir=self.out, session=session)
        self.assertEqual(len(session.calls), 1)
        self.assertEqual(self.manifest()[("066062", "tmax")]["status"], "error")

    def test_a_held_file_is_not_requested_again(self):
        (self.out / "tmax").mkdir(parents=True)
        (self.out / "tmax" / "086338.csv").write_bytes(daily_csv(GOOD_ROWS))
        session = FakeSession({}, {})
        self.assertEqual(td.run(["086338"], ["tmax"], out_dir=self.out, session=session),
                         {"existing": 1})
        self.assertEqual(session.calls, [])

    def test_unexpected_file_is_not_saved(self):
        wrong = daily_csv([("IDCJAC0009", "086338", 2024, 1, 1, "3.0", "1", "Y")])
        session = FakeSession({("086338", "122"): station_page("086338")}, {"086338": zipped(wrong)})
        td.run(["086338"], ["tmax"], out_dir=self.out, session=session)
        self.assertEqual(self.manifest()[("086338", "tmax")]["status"], "unexpected_file")
        self.assertFalse((self.out / "tmax" / "086338.csv").exists())

    def test_dry_run_makes_no_requests(self):
        session = FakeSession({}, {})
        counts = td.run(["086338", "066062"], ["tmax", "tmin"], out_dir=self.out,
                        session=session, dry_run=True)
        self.assertEqual(counts, {"would_fetch": 4})
        self.assertEqual(session.calls, [])
        self.assertEqual(list(self.out.iterdir()), [], "a dry run must not write anything")

    def test_uses_the_right_cdo_code_per_variable(self):
        session = FakeSession({}, {})
        with mock.patch.object(td, "RETRIES", 0):
            td.run(["086338"], ["tmax", "tmin"], out_dir=self.out, session=session)
        codes = [u.split("p_nccObsCode=")[1].split("&")[0] for u in session.calls]
        self.assertEqual(codes, ["122", "123"])


TMIN_HEADER = HEADER.replace("Maximum", "Minimum").replace("maximum", "minimum")


class TestImport(Quiet):
    """Manual browser downloads dropped into a folder."""

    def setUp(self):
        super().setUp()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.out = Path(self.tmp.name) / "temperature"
        self.drop = self.out / "downloads"
        self.drop.mkdir(parents=True)

    def drop_zip(self, filename, rows, header=HEADER, member=None):
        raw = daily_csv(rows, header=header)
        member = member or f"{rows[0][0]}_{rows[0][1]}_1800_Data.csv"
        (self.drop / filename).write_bytes(zipped(raw, name=member))
        return raw

    def manifest(self):
        with open(self.out / "manifest.csv", newline="", encoding="utf-8") as f:
            return {(r["station_id"], r["variable"]): r for r in csv.DictReader(f)}

    def test_files_tmax_and_tmin_by_their_contents_not_their_names(self):
        raw_max = self.drop_zip("whatever (1).zip", GOOD_ROWS)
        tmin_rows = [("IDCJAC0011",) + r[1:] for r in GOOD_ROWS]
        raw_min = self.drop_zip("IDCJAC0010_wrong_name.zip", tmin_rows, header=TMIN_HEADER)

        counts = td.import_downloads(self.drop, self.out)

        self.assertEqual(counts, {"imported": 2})
        self.assertEqual((self.out / "tmax" / "086338.csv").read_bytes(), raw_max)
        self.assertEqual((self.out / "tmin" / "086338.csv").read_bytes(), raw_min)
        entry = self.manifest()[("086338", "tmin")]
        self.assertEqual(entry["status"], "downloaded")
        self.assertIn("manual browser download", entry["detail"])

    def test_reimport_is_a_no_op(self):
        self.drop_zip("a.zip", GOOD_ROWS)
        td.import_downloads(self.drop, self.out)
        self.assertEqual(td.import_downloads(self.drop, self.out), {"already_imported": 1})

    RAIN_HEADER = ("Product code,Bureau of Meteorology station number,Year,Month,Day,"
                   "Rainfall amount (millimetres),Period over which rainfall was measured (days),Quality")

    def test_a_rainfall_zip_for_a_new_station_is_filed_under_others(self):
        rain = [("IDCJAC0009", "086338", 2024, 1, 1, "3.0", "1", "Y")]
        raw = self.drop_zip("rain.zip", rain, header=self.RAIN_HEADER)
        rain_dir = Path(self.tmp.name) / "rainfall"
        counts = td.import_downloads(self.drop, self.out, rain_dir)
        self.assertEqual(counts, {"imported": 1})
        self.assertEqual((rain_dir / "others" / "086338.csv").read_bytes(), raw)
        self.assertFalse((self.out / "tmax").exists())

    def test_rainfall_for_a_held_station_stays_where_it_is(self):
        rain_dir = Path(self.tmp.name) / "rainfall"
        (rain_dir / "selected").mkdir(parents=True)
        (rain_dir / "selected" / "023000.csv").write_text("old")
        self.drop_zip("rain.zip", [("IDCJAC0009", "023000", 2024, 1, 1, "3.0", "1", "Y")],
                      header=self.RAIN_HEADER)
        self.assertEqual(td.import_downloads(self.drop, self.out, rain_dir), {"replaced": 1})
        self.assertFalse((rain_dir / "others" / "023000.csv").exists())

    def test_a_rainfall_header_on_a_temperature_product_is_rejected(self):
        header = HEADER.replace("Maximum temperature (Degree C)", "Rainfall amount (millimetres)")
        self.drop_zip("odd.zip", GOOD_ROWS, header=header)
        self.assertEqual(td.import_downloads(self.drop, self.out), {"rejected": 1})

    def test_a_this_year_only_download_is_rejected(self):
        self.drop_zip("IDCJAC0010_086338_2026.zip", GOOD_ROWS, member="IDCJAC0010_086338_2026_Data.csv")
        self.assertEqual(td.import_downloads(self.drop, self.out), {"rejected": 1})
        self.assertFalse((self.out / "tmax" / "086338.csv").exists())

    def test_a_corrupt_zip_is_rejected_without_stopping_the_rest(self):
        (self.drop / "broken.zip").write_bytes(b"not a zip")
        self.drop_zip("good.zip", GOOD_ROWS)
        self.assertEqual(td.import_downloads(self.drop, self.out), {"rejected": 1, "imported": 1})

    def test_an_unzipped_csv_is_accepted_too(self):
        raw = daily_csv(GOOD_ROWS)
        (self.drop / "IDCJAC0010_086338_1800_Data.csv").write_bytes(raw)
        self.assertEqual(td.import_downloads(self.drop, self.out), {"imported": 1})
        self.assertEqual((self.out / "tmax" / "086338.csv").read_bytes(), raw)

    def test_replaces_a_stale_error_entry_in_the_manifest(self):
        td.write_manifest({("086338", "tmax"): {"station_id": "086338", "variable": "tmax",
                                                "status": "error", "detail": "HTTPError 403"}},
                          self.out / "manifest.csv")
        self.drop_zip("a.zip", GOOD_ROWS)
        td.import_downloads(self.drop, self.out)
        self.assertEqual(self.manifest()[("086338", "tmax")]["status"], "downloaded")


class TestDefaultStations(unittest.TestCase):
    def test_open_wmo_stations_with_rainfall_held(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        (root / "rain" / "selected").mkdir(parents=True)
        (root / "rain" / "others").mkdir()
        for sid, sub in [("000001", "selected"), ("000002", "others"), ("000003", "selected")]:
            (root / "rain" / sub / f"{sid}.csv").write_text("x")
        (root / "stations.csv").write_text(
            "station_id,district,is_active,wmo_id\n"
            "000001,01,True,94001\n"      # picked
            "000002,01,True,94002\n"      # picked (others/ counts too)
            "000003,01,False,94003\n"     # closed
            "000004,01,True,94004\n"      # no rainfall held
            "000005,01,True,\n"           # no WMO id
        )
        self.assertEqual(td.default_stations(root / "stations.csv", root / "rain"),
                         ["000001", "000002"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
