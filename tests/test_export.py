"""
Tests for FR-08 / DR-01: GET /api/v1/export.csv.

Report test cases: the CSV row count and records match the table (the same
query's /api/v1/observations records), with station ID, date, variable, value,
unit and quality flag on every row; a missing day stays an empty value, never
0; provenance (source product, ingestion run) travels with each value. No
database needed.

    python -m unittest tests.test_export -v
"""

from __future__ import annotations

import csv
import io
import sys
import unittest
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    from fastapi.testclient import TestClient
    import api_v1
    import main
    from test_api_v1 import D, MELB_RAIN, FakeStore, row
    HAVE_API = True
except ImportError:
    HAVE_API = False

COLUMNS = ["station_id", "station_name", "date", "variable", "value", "unit",
           "quality_flag", "days_covered", "source_product", "ingestion_run_id"]


def with_source(rows, product, run):
    return [{**r, "source_product": product, "ingestion_run_id": run} for r in rows]


@unittest.skipUnless(HAVE_API, "API dependencies not installed")
class TestExport(unittest.TestCase):
    def setUp(self):
        rain = with_source(MELB_RAIN, "IDCJAC0009", 7)
        tmax = with_source([row(D + timedelta(i), 20 + i / 10, "observed", 1) for i in range(5)], "IDCJAC0010", 8)
        wyndham = with_source([row(D, 1.2, "unverified", 1), row(D + timedelta(1), None, "missing")], "IDCJAC0009", 7)
        store = FakeStore({("086338", "rainfall"): rain, ("086338", "tmax"): tmax, ("001006", "rainfall"): wyndham})
        main.app.dependency_overrides[api_v1.get_store] = lambda: store
        self.addCleanup(main.app.dependency_overrides.clear)
        self.client = TestClient(main.app)

    def export(self, **params):
        return self.client.get("/api/v1/export.csv", params={"station_id": "086338", "variable": "rainfall",
                                                              "start": "2025-01-01", "end": "2025-01-10", **params})

    def rows(self, response):
        text = response.content.decode("utf-8")
        self.assertTrue(text.startswith("﻿"), "starts with a byte order mark so Excel reads °C")
        return list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))

    def test_same_records_as_the_table_with_stable_columns(self):
        r = self.export()
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.headers["content-type"].startswith("text/csv"))
        header = r.content.decode("utf-8").lstrip("﻿").splitlines()[0].split(",")
        self.assertEqual(header, COLUMNS)
        rows = self.rows(r)
        table = self.client.get("/api/v1/observations", params={"station_id": "086338", "variable": "rainfall",
                                                                 "start": "2025-01-01", "end": "2025-01-10"}).json()
        self.assertEqual(len(rows), len(table["records"]))
        self.assertEqual([x["date"] for x in rows], [x["date"] for x in table["records"]])
        self.assertEqual([x["quality_flag"] for x in rows], [x["quality_state"] for x in table["records"]])

    def test_every_row_carries_identity_unit_quality_and_provenance(self):
        for x in self.rows(self.export()):
            self.assertEqual((x["station_id"], x["station_name"], x["variable"], x["unit"]),
                             ("086338", "MELBOURNE (OLYMPIC PARK)", "rainfall", "mm"))
            self.assertEqual((x["source_product"], x["ingestion_run_id"]), ("IDCJAC0009", "7"))

    def test_missing_is_empty_never_zero_and_multi_day_says_so(self):
        rows = self.rows(self.export())
        self.assertEqual([x["value"] for x in rows], ["0", "", "12.4", "5"])
        self.assertEqual([x["quality_flag"] for x in rows], ["observed", "missing", "unverified", "observed"])
        self.assertEqual([x["days_covered"] for x in rows], ["1", "", "2", "1"])

    def test_filename_names_the_query(self):
        disposition = self.export().headers["content-disposition"]
        self.assertEqual(disposition, 'attachment; filename="bombastic_086338_rainfall_2025-01-01_2025-01-10.csv"')

    def test_unit_with_a_degree_sign_survives(self):
        rows = self.rows(self.export(variable="tmax"))
        self.assertEqual({x["unit"] for x in rows}, {"°C"})
        self.assertEqual(rows[1]["value"], "20.1")

    def test_comparison_has_both_stations_first_station_first(self):
        r = self.export(compare_station_id="001006")
        rows = self.rows(r)
        self.assertEqual([x["station_id"] for x in rows], ["086338"] * 4 + ["001006"] * 2)
        self.assertEqual(rows[4]["station_name"], "WYNDHAM AERO")
        self.assertEqual(rows[5]["value"], "")
        self.assertIn("bombastic_086338_vs_001006_rainfall", r.headers["content-disposition"])

    def test_errors_follow_the_contract(self):
        self.assertEqual(self.export(variable="humidity").status_code, 404)
        self.assertEqual(self.export(station_id="999999").status_code, 404)
        self.assertEqual(self.export(compare_station_id="999999").status_code, 404)
        self.assertEqual(self.export(compare_station_id="086338").status_code, 422)
        self.assertEqual(self.export(start="2025-02-01").status_code, 422)
        self.assertEqual(self.export(station_id="12x").status_code, 422)

    def test_plain_numbers(self):
        from decimal import Decimal
        self.assertEqual([api_v1.plain_number(Decimal(v)) for v in ("12.40", "0.00", "120.00", "-3.50")],
                         ["12.4", "0", "120", "-3.5"])
        self.assertEqual(api_v1.plain_number(None), "")


if __name__ == "__main__":
    unittest.main()
