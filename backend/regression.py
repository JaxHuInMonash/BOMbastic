"""
Bivariate linear regression for one station (FR-05; report section 6.3).

Pure functions, no database: `pair` lines up two variables' daily rows by
date, `fit` runs ordinary least squares on the pairs. The endpoint in
api_v1.py does the fetching and validation.

Rules (report 6.3, docs/data-contract.md section 5):
  * Only days where both variables have a single-day reading are paired. A day
    with no reading (or no row) is never zero, and a multi-day value is never
    one day's value, so neither is paired.
  * The quality policy decides whether readings BOM hasn't checked yet take
    part: "all" keeps them, "checked" keeps only quality-checked readings.
    Interpolated values are counted and reported either way.
  * At least MIN_PAIRS paired days (configurable, default 20) and some spread
    in x are required; otherwise no model is returned, only the reason.

This describes how two variables moved together in past data. It is not a
forecast and does not show that one causes the other.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass, field
from datetime import date, timedelta

# Report 6.3: "Require at least 20 paired points by default ... expose the
# threshold in configuration". Set BOMBASTIC_REGRESSION_MIN_PAIRS to change it.
MIN_PAIRS = int(os.environ.get("BOMBASTIC_REGRESSION_MIN_PAIRS", "20"))

POLICIES = ("all", "checked")


@dataclass
class Pairing:
    pairs: list[dict] = field(default_factory=list)   # {date, x, y, x_quality, y_quality}
    no_reading: int = 0      # either variable has no reading, or no row, that day
    multi_day: int = 0       # either variable's value covers several days
    not_checked: int = 0     # left out by the "checked" policy
    interpolated: int = 0    # pairs that include an interpolated value

    @property
    def excluded(self) -> dict:
        return {"no_reading": self.no_reading, "multi_day": self.multi_day, "not_checked": self.not_checked}


def _single(row: dict | None) -> float | None:
    """The row's value if it is one day's reading, else None."""
    if row is None or row["value"] is None or (row["accumulation_days"] or 1) > 1:
        return None
    return float(row["value"])


def pair(rows_x: list[dict], rows_y: list[dict], start: date, end: date, policy: str = "all") -> Pairing:
    """Line up two variables' rows by date over [start, end]. Every day in the
    range is either paired or counted under exactly one reason, checked in
    this order: no reading, multi-day value, quality policy."""
    if policy not in POLICIES:
        raise ValueError(f"policy must be one of {POLICIES}")
    by_x = {r["observed_date"]: r for r in rows_x}
    by_y = {r["observed_date"]: r for r in rows_y}
    out = Pairing()
    day = start
    while day <= end:
        rx, ry = by_x.get(day), by_y.get(day)
        x, y = _single(rx), _single(ry)
        if rx is None or ry is None or rx["value"] is None or ry["value"] is None:
            out.no_reading += 1
        elif x is None or y is None:
            out.multi_day += 1
        elif policy == "checked" and not (rx["quality_state"] == "observed" and ry["quality_state"] == "observed"):
            out.not_checked += 1
        else:
            if "interpolated" in (rx["quality_state"], ry["quality_state"]):
                out.interpolated += 1
            out.pairs.append({"date": day, "x": x, "y": y,
                              "x_quality": rx["quality_state"], "y_quality": ry["quality_state"]})
        day += timedelta(days=1)
    return out


@dataclass
class Fit:
    n: int
    slope: float
    intercept: float
    r_squared: float | None      # None when y doesn't vary (the fit is exact but R² is undefined)
    fitted: list[float]
    residuals: list[float]
    x_min: float
    x_max: float


def fit(xs: list[float], ys: list[float], min_pairs: int = MIN_PAIRS) -> Fit | str:
    """Ordinary least squares for y = intercept + slope * x.

    Returns a Fit, or a sentence saying why no line is shown. Sums are taken
    about the means, which keeps the arithmetic stable for values like 25.3
    over thousands of days.
    """
    n = len(xs)
    if n != len(ys):
        raise ValueError("xs and ys must be the same length")
    if n < min_pairs:
        return (f"Only {n} paired day{'s' if n != 1 else ''} in this range; at least {min_pairs} "
                f"are needed before a line is shown. Choose a longer period.")
    mx = math.fsum(xs) / n
    my = math.fsum(ys) / n
    sxx = math.fsum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return "The x variable has the same value on every paired day, so no line can be fitted."
    sxy = math.fsum((x - mx) * (y - my) for x, y in zip(xs, ys))
    syy = math.fsum((y - my) ** 2 for y in ys)
    slope = sxy / sxx
    intercept = my - slope * mx
    fitted = [intercept + slope * x for x in xs]
    residuals = [y - f for y, f in zip(ys, fitted)]
    ss_res = math.fsum(r * r for r in residuals)
    r_squared = None if syy == 0 else max(0.0, 1 - ss_res / syy)
    return Fit(n=n, slope=slope, intercept=intercept, r_squared=r_squared, fitted=fitted,
               residuals=residuals, x_min=min(xs), x_max=max(xs))
