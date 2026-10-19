"""Seasonal + linear trend regression for monthly BOM observations."""
from __future__ import annotations
from dataclasses import dataclass
from datetime import date
from collections import defaultdict
import math
import numpy as np

MIN_MONTHS = 24

@dataclass
class SeasonalFit:
    n: int
    intercept: float
    trend_per_month: float
    sin_coefficient: float
    cos_coefficient: float
    r_squared: float | None
    adjusted_r_squared: float | None
    rmse: float
    fitted: list[float]
    residuals: list[float]
    dates: list[date]
    observed: list[float]

def monthly_series(rows: list[dict], variable: str, quality_policy: str = "all"):
    """Monthly means for temperature (>=70% daily coverage), totals for rain
    (>=90% daily coverage). Require 24 usable months before fitting.
    """
    from calendar import monthrange
    from datetime import timedelta
    if variable not in {"rainfall", "tmax", "tmin"}:
        raise ValueError("Unsupported variable")
    if quality_policy not in {"all", "checked"}:
        raise ValueError("Unsupported quality policy")
    groups = defaultdict(dict)
    for row in rows:
        d, value = row["observed_date"], row["value"]
        if value is None or (quality_policy == "checked" and row["quality_state"] != "observed"):
            continue
        value = float(value)
        if not math.isfinite(value):
            continue
        days = int(row.get("accumulation_days") or 1)
        if days < 1:
            continue
        if days > 1:
            first = d - timedelta(days=days - 1)
            if variable != "rainfall" or (first.year, first.month) != (d.year, d.month):
                continue
            for k in range(days):
                day = d - timedelta(days=k)
                groups[(day.year, day.month)].setdefault(day, 0.0)
            groups[(d.year, d.month)][d] = value
        else:
            groups[(d.year, d.month)][d] = value
    dates, values = [], []
    for (year, month), daily in sorted(groups.items()):
        required_fraction = 0.9 if variable == "rainfall" else 0.7
        if len(daily) / monthrange(year, month)[1] < required_fraction:
            continue
        dates.append(date(year, month, 1))
        vals = list(daily.values())
        values.append(float(sum(vals)) if variable == "rainfall" else float(np.mean(vals)))
    return dates, values

def fit_seasonal(dates: list[date], values: list[float], min_months: int = MIN_MONTHS):
    """Fit y = b0 + b1*t + b2*sin(2*pi*t/12) + b3*cos(2*pi*t/12)."""
    if len(dates) != len(values):
        raise ValueError("Dates and values must have equal lengths")
    if len(set(dates)) != len(dates):
        raise ValueError("Dates must be unique")
    if len(dates) < min_months:
        return f"Only {len(dates)} complete months available; at least {min_months} required."
    origin = min(dates)
    t = np.array([(d.year-origin.year)*12 + d.month-origin.month for d in dates], dtype=float)
    if np.ptp(t) < 23:
        return "Data must span at least two annual cycles."
    y = np.asarray(values, dtype=float)
    if not np.isfinite(y).all():
        return "Non-finite observations cannot be fitted."
    X = np.column_stack((np.ones(len(t)), t, np.sin(2*np.pi*t/12), np.cos(2*np.pi*t/12)))
    if np.linalg.matrix_rank(X) < 4:
        return "Not enough independent monthly observations to fit the seasonal model."
    coefficients = np.linalg.lstsq(X, y, rcond=None)[0]
    fitted = X @ coefficients
    residuals = y - fitted
    sse = float(np.sum(residuals**2))
    sst = float(np.sum((y-np.mean(y))**2))
    r2 = None if sst == 0 else 1-sse/sst
    adjusted = None if r2 is None else 1-(1-r2)*(len(y)-1)/(len(y)-4)
    return SeasonalFit(
        n=len(y), intercept=float(coefficients[0]),
        trend_per_month=float(coefficients[1]),
        sin_coefficient=float(coefficients[2]),
        cos_coefficient=float(coefficients[3]),
        r_squared=r2, adjusted_r_squared=adjusted,
        rmse=math.sqrt(sse/len(y)),
        fitted=fitted.tolist(), residuals=residuals.tolist(),
        dates=dates, observed=values,
    )


