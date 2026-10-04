"""
Tests for the versioned API (backend/api_v1.py).

Most tests run against an in-memory stand-in for the database, so they need no
PostgreSQL. The integration tests at the bottom run only when
BOMBASTIC_TEST_DATABASE_URL points at a loaded database, e.g. in PowerShell:

    $env:BOMBASTIC_TEST_DATABASE_URL = "postgresql://postgres@localhost:5432/bombastic"
    python -m unittest tests.test_api_v1 -v

The whole module is skipped if the API's dependencies are not installed
(pip install -r requirements.txt).
"""

from __future__ import annotations

import os
import sys
import unittest
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

try:
    from fastapi.testclient import TestClient
    import api_v1  # noqa: E402
    import db      # noqa: E402
    import main    # noqa: E402
    HAVE_API = True
except ImportError as missing:     # fastapi, httpx or psycopg not installed
    HAVE_API = False
    MISSING = str(missing)

needs_api = unittest.skipUnless(HAVE_API, "API dependencies not installed")

VARIABLES = {
    "rainfall": {"variable_code": "rainfall", "label": "Rainfall", "unit": "mm",
                 "semantic_type": "accumulation", "default_chart": "bar", "interpolation_allowed": False},
    "tmax": {"variable_code": "tmax", "label": "Maximum temperature", "unit": "°C",
             "semantic_type": "extreme", "default_chart": "line", "interpolation_allowed": False},
}
STATIONS = {
    "086338": {"station_id": "086338", "name": "MELBOURNE (OLYMPIC PARK)", "state": "VIC",
               "latitude": -37.8255, "longitude": 144.9816},
}


def row(d, value, state, acc=None):
    return {"observed_date": d, "value": None if value is None else Decimal(str(value)),
            "quality_state": state, "accumulation_days": acc}


class FakeStore:
    """Same interface as db.Store, backed by dicts."""

    def __init__(self, rows: dict[tuple[str, str], list[dict]]):
        self.rows = rows

    def ping(self): return True
    def variables(self): return list(VARIABLES.values())
    def variable(self, code): return VARIABLES.get(code)
    def station(self, sid): return STATIONS.get(sid)

    def availability(self, sid, var):
        dates = [r["observed_date"] for r in self.rows.get((sid, var), []) if r["value"] is not None]
        return {"first_date": min(dates) if dates else None, "last_date": max(dates) if dates else None}

    def observations(self, sid, var, start, end):
        return [r for r in self.rows.get((sid, var), []) if start <= r["observed_date"] <= end]


D = date(2025, 1, 1)
MELB_RAIN = [
    row(D, 0.0, "observed", 1),                                   # observed zero
    row(D + timedelta(1), None, "missing"),                       # missing day
    row(D + timedelta(2), 12.4, "unverified", 2),                 # 2-day total: covers the missing day too
    row(D + timedelta(3), 5.0, "observed", 1),
]
MELB_TMAX = [row(D + timedelta(i), 20 + i, "observed", 1) for i in range(30)]


@needs_api
class ApiCase(unittest.TestCase):
    def setUp(self):
        store = FakeStore({("086338", "rainfall"): MELB_RAIN, ("086338", "tmax"): MELB_TMAX})
        main.app.dependency_overrides[api_v1.get_store] = lambda: store
        self.addCleanup(main.app.dependency_overrides.clear)
        self.client = TestClient(main.app)

    def get(self, **params):
        return self.client.get("/api/v1/observations", params=params)


class TestVariables(ApiCase):
    def test_lists_label_unit_and_chart_type(self):
        r = self.client.get("/api/v1/variables")
        self.assertEqual(r.status_code, 200)
        tmax = next(v for v in r.json() if v["variable_code"] == "tmax")
        self.assertEqual((tmax["unit"], tmax["default_chart"]), ("°C", "line"))


class TestObservations(ApiCase):
    def test_missing_day_is_null_never_zero(self):
        body = self.get(station_id="086338", variable="rainfall", start="2025-01-01", end="2025-01-04").json()
        self.assertEqual(body["status"], "ok")
        values = [(r["date"], r["value"], r["quality_state"]) for r in body["records"]]
        self.assertIn(("2025-01-01", 0.0, "observed"), values)        # observed zero survives
        self.assertIn(("2025-01-02", None, "missing"), values)        # missing stays null

    def test_multi_day_total_is_kept_out_of_single_day_extremes(self):
        s = self.get(station_id="086338", variable="rainfall", start="2025-01-01", end="2025-01-04").json()["summary"]
        self.assertEqual(s["multi_day_values"], 1)
        self.assertEqual(s["max_single_day"], 5.0)                    # not the 12.4 three-day total
        self.assertEqual(s["days_covered"], 4)                        # 1 + 2 + 1: the missing day's rain is in the 2-day total
        self.assertEqual(s["aggregate"], "total")
        self.assertEqual(s["aggregate_value"], 17.4)

    def test_quality_counts_and_days_outside_the_record(self):
        q = self.get(station_id="086338", variable="rainfall", start="2024-12-30", end="2025-01-04").json()["quality_counts"]
        self.assertEqual(q, {"observed": 2, "unverified": 1, "interpolated": 0, "missing": 1, "no_record": 2})

    def test_aggregate_is_withheld_below_ninety_percent_coverage(self):
        s = self.get(station_id="086338", variable="tmax", start="2025-01-01", end="2025-02-28").json()["summary"]
        self.assertIsNone(s["aggregate_value"])
        self.assertIn("51%", s["aggregate_withheld_reason"])

    def test_mean_for_temperature_when_coverage_is_enough(self):
        s = self.get(station_id="086338", variable="tmax", start="2025-01-01", end="2025-01-30").json()["summary"]
        self.assertEqual((s["aggregate"], s["aggregate_value"]), ("mean", 34.5))

    def test_unpadded_station_id_is_accepted(self):
        self.assertEqual(self.get(station_id="86338", variable="tmax").status_code, 200)

    def test_default_range_is_the_last_year_of_the_stations_own_record(self):
        q = self.get(station_id="086338", variable="tmax").json()["query"]
        self.assertEqual(q["end"], "2025-01-30")
        self.assertEqual(q["start"], "2024-02-01")
        self.assertEqual(sorted(q["defaulted"]), ["end", "start"])

    def test_no_data_in_range_is_200_with_an_explanation(self):
        r = self.get(station_id="086338", variable="tmax", start="2010-01-01", end="2010-12-31")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["status"], "no_data")
        self.assertIn("2025-01-01 to 2025-01-30", body["message"])

    def test_known_variable_never_recorded_at_station_is_no_data(self):
        store = FakeStore({})
        main.app.dependency_overrides[api_v1.get_store] = lambda: store
        body = self.get(station_id="086338", variable="tmax").json()
        self.assertEqual(body["status"], "no_data")
        self.assertIn("has no maximum temperature records", body["message"])


class TestErrorContract(ApiCase):
    def test_unknown_variable_is_404_and_lists_the_known_ones(self):
        r = self.get(station_id="086338", variable="humidity")
        self.assertEqual(r.status_code, 404)
        self.assertIn("rainfall", r.json()["detail"])

    def test_unknown_station_is_404(self):
        self.assertEqual(self.get(station_id="999999", variable="tmax").status_code, 404)

    def test_malformed_station_id_is_422(self):
        self.assertEqual(self.get(station_id="MELB", variable="tmax").status_code, 422)

    def test_malformed_date_is_422(self):
        self.assertEqual(self.get(station_id="086338", variable="tmax", start="2025-13-01").status_code, 422)

    def test_start_after_end_is_422(self):
        r = self.get(station_id="086338", variable="tmax", start="2025-02-01", end="2025-01-01")
        self.assertEqual(r.status_code, 422)
        self.assertIn("after", r.json()["detail"])

    def test_range_over_the_limit_is_422(self):
        r = self.get(station_id="086338", variable="tmax", start="1900-01-01", end="2025-01-01")
        self.assertEqual(r.status_code, 422)
        self.assertIn(str(api_v1.MAX_DAYS), r.json()["detail"])

    def test_database_down_is_503_not_500(self):
        main.app.dependency_overrides.clear()
        original = db.DATABASE_URL
        db.DATABASE_URL = "postgresql://nobody@127.0.0.1:1/none"
        self.addCleanup(setattr, db, "DATABASE_URL", original)
        for path in ("/health", "/api/v1/variables"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 503)

    def test_existing_map_endpoints_are_untouched(self):
        self.assertEqual(self.client.get("/api/stations").status_code, 200)


# --------------------------------------------------------------------- real database
TEST_DB = os.environ.get("BOMBASTIC_TEST_DATABASE_URL")


@needs_api
@unittest.skipUnless(TEST_DB, "set BOMBASTIC_TEST_DATABASE_URL to run against a loaded database")
class TestAgainstDatabase(unittest.TestCase):
    def setUp(self):
        original = db.DATABASE_URL
        db.DATABASE_URL = TEST_DB
        self.addCleanup(setattr, db, "DATABASE_URL", original)
        self.client = TestClient(main.app)

    def test_health(self):
        self.assertEqual(self.client.get("/health").json(), {"status": "ok", "database": "ok"})

    def test_three_variables_with_units(self):
        units = {v["variable_code"]: v["unit"] for v in self.client.get("/api/v1/variables").json()}
        self.assertEqual(units, {"rainfall": "mm", "tmax": "°C", "tmin": "°C"})

    def test_deniliquin_rainfall_matches_the_contract(self):
        # docs/data-contract.md section 5: 074128 has 58,400 Y, 1,093 N, 2,094 missing in total.
        total = {"observed": 0, "unverified": 0, "missing": 0}
        for start in range(1858, 2027, 10):
            body = self.client.get("/api/v1/observations", params={
                "station_id": "074128", "variable": "rainfall",
                "start": f"{start}-01-01", "end": f"{min(start + 9, 2026)}-12-31"}).json()
            for k in total:
                total[k] += body["quality_counts"][k]
        self.assertEqual(total, {"observed": 58400, "unverified": 1093, "missing": 2094})

    def test_deniliquin_temperature_stopped_in_2003(self):
        body = self.client.get("/api/v1/observations", params={"station_id": "074128", "variable": "tmax"}).json()
        self.assertEqual(body["available"]["last_date"], "2003-06-29")
        self.assertEqual(body["query"]["end"], "2003-06-29")       # defaults to the end of its own record
        self.assertEqual(body["status"], "ok")

    def test_negative_minimum_temperatures_come_through(self):
        body = self.client.get("/api/v1/observations", params={
            "station_id": "074128", "variable": "tmin", "start": "1980-01-01", "end": "1989-12-31"}).json()
        self.assertLess(min(r["value"] for r in body["records"] if r["value"] is not None), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
