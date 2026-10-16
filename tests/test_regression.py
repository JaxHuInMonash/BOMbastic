"""
Tests for FR-05: backend/regression.py and POST /api/v1/regressions.

Covers the report's regression cases (section 7): the exact fixture FX-05
(y = 2x + 1), a 30-point noisy fixture checked against an independent numpy
calculation, too few paired days, no spread in x, the pairing rules for
missing and multi-day values, the quality policy, and the API's answers
(valid, insufficient, invalid). No database needed.

    python -m unittest tests.test_regression -v
"""

from __future__ import annotations

import random
import sys
import unittest
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import regression  # noqa: E402

try:
    import numpy as np
except ImportError:      # numpy is in requirements.txt; only the independent check needs it
    np = None

D = date(2025, 1, 1)


def row(i, value, state="observed", acc=1):
    return {"observed_date": D + timedelta(i), "value": None if value is None else Decimal(str(value)),
            "quality_state": "missing" if value is None else state, "accumulation_days": None if value is None else acc}


class TestFit(unittest.TestCase):
    def test_fx05_exact_line(self):
        """TC: FX-05 exact data gives slope 2, intercept 1, R² 1, residuals ~0."""
        xs = [float(x) for x in range(1, 31)]
        result = regression.fit(xs, [2 * x + 1 for x in xs])
        self.assertAlmostEqual(result.slope, 2, places=12)
        self.assertAlmostEqual(result.intercept, 1, places=12)
        self.assertAlmostEqual(result.r_squared, 1, places=12)
        self.assertTrue(all(abs(r) < 1e-9 for r in result.residuals))
        self.assertEqual((result.n, result.x_min, result.x_max), (30, 1.0, 30.0))

    @unittest.skipIf(np is None, "numpy not installed")
    def test_noisy_fixture_matches_an_independent_calculation(self):
        """Slope, intercept, R², fitted values and residuals match numpy's least squares."""
        rng = random.Random(3164)
        xs = [rng.uniform(5, 25) for _ in range(30)]
        ys = [9.3 + 0.95 * x + rng.gauss(0, 3) for x in xs]
        result = regression.fit(xs, ys)
        slope, intercept = np.polyfit(xs, ys, 1)
        r2 = np.corrcoef(xs, ys)[0, 1] ** 2
        self.assertAlmostEqual(result.slope, slope, places=9)
        self.assertAlmostEqual(result.intercept, intercept, places=9)
        self.assertAlmostEqual(result.r_squared, r2, places=9)
        np.testing.assert_allclose(result.fitted, intercept + slope * np.array(xs), atol=1e-9)
        np.testing.assert_allclose(result.residuals, np.array(ys) - (intercept + slope * np.array(xs)), atol=1e-9)
        self.assertAlmostEqual(sum(result.residuals), 0, places=9)

    def test_fewer_than_the_minimum_gives_a_reason_not_a_model(self):
        xs = [float(x) for x in range(19)]
        result = regression.fit(xs, xs, min_pairs=20)
        self.assertIsInstance(result, str)
        self.assertIn("Only 19 paired days", result)
        self.assertIsNot(type(regression.fit(xs + [19.0], xs + [19.0], min_pairs=20)), str)

    def test_no_spread_in_x_gives_a_reason(self):
        result = regression.fit([10.0] * 25, [float(i) for i in range(25)])
        self.assertIsInstance(result, str)
        self.assertIn("same value on every paired day", result)

    def test_constant_y_fits_but_r_squared_is_undefined(self):
        result = regression.fit([float(i) for i in range(25)], [7.0] * 25)
        self.assertEqual((result.slope, result.intercept, result.r_squared), (0.0, 7.0, None))

    def test_threshold_defaults_to_twenty(self):
        self.assertEqual(regression.MIN_PAIRS, 20)


class TestPair(unittest.TestCase):
    def test_only_single_day_readings_on_both_sides_are_paired(self):
        xs = [row(0, 10), row(1, None), row(2, 12, acc=2), row(3, 13), row(4, 14)]
        ys = [row(0, 20), row(1, 21), row(2, 22), row(3, None), row(4, 24)]
        p = regression.pair(xs, ys, D, D + timedelta(5))
        self.assertEqual([(q["x"], q["y"]) for q in p.pairs], [(10.0, 20.0), (14.0, 24.0)])
        # Day 1 and 3 no reading, day 2 multi-day, day 5 no row at all: each counted once.
        self.assertEqual(p.excluded, {"no_reading": 3, "multi_day": 1, "not_checked": 0})
        self.assertEqual(len(p.pairs) + sum(p.excluded.values()), 6)

    def test_checked_policy_leaves_out_unverified_readings(self):
        xs = [row(0, 10), row(1, 11, "unverified"), row(2, 12)]
        ys = [row(0, 20), row(1, 21), row(2, 22, "unverified")]
        all_ = regression.pair(xs, ys, D, D + timedelta(2), "all")
        checked = regression.pair(xs, ys, D, D + timedelta(2), "checked")
        self.assertEqual(len(all_.pairs), 3)
        self.assertEqual(len(checked.pairs), 1)
        self.assertEqual(checked.not_checked, 2)

    def test_interpolated_pairs_are_counted(self):
        p = regression.pair([row(0, 1, "interpolated")], [row(0, 2)], D, D)
        self.assertEqual(p.interpolated, 1)


try:
    from fastapi.testclient import TestClient
    import api_v1
    import main
    from test_api_v1 import STATIONS, VARIABLES, FakeStore
    HAVE_API = True
except ImportError:
    HAVE_API = False

TMIN = {"variable_code": "tmin", "label": "Minimum temperature", "unit": "°C",
        "semantic_type": "extreme", "default_chart": "line", "interpolation_allowed": False}


@unittest.skipUnless(HAVE_API, "API dependencies not installed")
class TestRegressionEndpoint(unittest.TestCase):
    def setUp(self):
        VARIABLES.setdefault("tmin", TMIN)
        self.addCleanup(VARIABLES.pop, "tmin", None)
        rng = random.Random(5)
        tmin = [row(i, round(rng.uniform(5, 20), 1), "unverified" if i >= 50 else "observed") for i in range(60)]
        tmax = [row(i, round(9 + 0.95 * float(r["value"]) + rng.gauss(0, 2), 1)) for i, r in enumerate(tmin)]
        tmax[10] = row(10, None)                      # a missing day is never paired
        tmax[20] = row(20, 30.0, acc=2)               # nor is a multi-day value
        self.store = FakeStore({("086338", "tmin"): tmin, ("086338", "tmax"): tmax,
                                ("086338", "rainfall"): [row(i, 1.0) for i in range(5)]})
        main.app.dependency_overrides[api_v1.get_store] = lambda: self.store
        self.addCleanup(main.app.dependency_overrides.clear)
        self.client = TestClient(main.app)

    def post(self, **body):
        return self.client.post("/api/v1/regressions", json={"station_id": "086338", "x": "tmin", "y": "tmax", **body})

    def test_default_range_ends_on_the_last_day_both_were_recorded(self):
        body = self.post().json()
        self.assertEqual(body["query"]["end"], "2025-03-01")
        self.assertEqual(body["query"]["defaulted"], ["end", "start"])
        self.assertEqual(body["available"], {"first_date": "2025-01-01", "last_date": "2025-03-01"})

    def test_valid_request_returns_the_model_points_and_exclusions(self):
        r = self.post(start="2025-01-01", end="2025-03-01")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["model"]["n"], 58)
        self.assertEqual(len(body["points"]), 58)
        self.assertEqual(body["excluded"], {"no_reading": 1, "multi_day": 1, "not_checked": 0})
        self.assertEqual(body["days_in_range"], 60)
        self.assertEqual(body["query"]["min_pairs"], 20)
        self.assertFalse(body["interpolated_included"])
        self.assertIn("No interpolated values were included.", body["warnings"])
        self.assertTrue(any("quality-checked yet" in w for w in body["warnings"]))
        # Points carry the same fit: residual = y - fitted, and fitted lies on the line.
        m = body["model"]
        for p in body["points"]:
            self.assertAlmostEqual(p["residual"], p["y"] - p["fitted"], places=9)
            self.assertAlmostEqual(p["fitted"], m["intercept"] + m["slope"] * p["x"], places=9)

    def test_checked_policy_uses_fewer_days(self):
        body = self.post(start="2025-01-01", end="2025-03-01", quality_policy="checked").json()
        self.assertEqual(body["model"]["n"], 48)
        self.assertEqual(body["excluded"]["not_checked"], 10)

    def test_too_few_paired_days_is_insufficient_with_a_reason(self):
        body = self.post(start="2025-01-01", end="2025-01-15").json()
        self.assertEqual(body["status"], "insufficient")
        self.assertIsNone(body["model"])
        self.assertIn("at least 20", body["message"])
        self.assertEqual(len(body["points"]), 14)   # the paired days are still returned, unfitted
        self.assertTrue(all(p["fitted"] is None for p in body["points"]))

    def test_same_variable_twice_is_422(self):
        self.assertEqual(self.post(y="tmin").status_code, 422)

    def test_unknown_variable_and_station_are_404(self):
        self.assertEqual(self.post(y="humidity").status_code, 404)
        self.assertEqual(self.post(station_id="999999").status_code, 404)

    def test_bad_dates_are_422(self):
        self.assertEqual(self.post(start="2025-03-01", end="2025-01-01").status_code, 422)
        self.assertEqual(self.post(start="not-a-date").status_code, 422)

    def test_variable_not_recorded_at_station_is_no_data(self):
        body = self.client.post("/api/v1/regressions", json={"station_id": "001006", "x": "tmin", "y": "tmax"}).json()
        self.assertEqual(body["status"], "no_data")
        self.assertIn("WYNDHAM AERO has no", body["message"])
        self.assertIn("001006", STATIONS)


if __name__ == "__main__":
    unittest.main()
