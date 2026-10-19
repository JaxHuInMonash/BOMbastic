"""
Versioned API for the dashboard, reading from PostgreSQL.

Implements the first two endpoints of the report's REST contract (section 5.3),
plus the health check:

    GET /api/v1/variables      what can be charted, with label, unit and chart type
    GET /api/v1/stations       stations with data, and which variables each has
    GET /api/v1/stations/{id}  one station and its variables
    GET /api/v1/observations   one station, one variable, one date range
    POST /api/v1/regressions   one station, two variables: OLS fit (FR-05, regression.py)
    GET /api/v1/export.csv     the observations query (or a two-station comparison) as CSV (FR-08)
    GET /health                is the service up and can it reach the database

Status codes follow the report's error contract:
    200  a valid query; "status" is "ok", or "no_data" when nothing was recorded
    404  unknown station or variable code
    422  invalid parameters (bad id, bad date, start after end, range too long)
    503  the database cannot be reached

Rules taken from docs/data-contract.md:
  * A missing day is returned as a record with value null and quality_state
    'missing'. It is never turned into zero.
  * A value with accumulation_days > 1 covers several days. It is returned as
    stored, and kept out of the single-day min and max.
  * Derived values (the total or the mean) are only given when at least 90% of
    the days in range are covered (section 8, decision D-A, proposed). Below that
    the figure is withheld and the reason is given instead.
"""

from __future__ import annotations

import csv
import io
from datetime import date, timedelta
from decimal import Decimal
from collections.abc import Generator
from typing import Literal

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Path, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

import db
import seasonal_regression

DEFAULT_DAYS = 365          # NFR-01 is measured on one station and up to a year of daily data
MAX_DAYS = 3660             # DR-04: about ten years of daily rows per request
COVERAGE_THRESHOLD = 0.90   # contract section 8, decision D-A (proposed)

router = APIRouter(prefix="/api/v1", tags=["v1"])
health_router = APIRouter(tags=["health"])


# --------------------------------------------------------------------- models
class Variable(BaseModel):
    variable_code: str
    label: str
    unit: str
    semantic_type: Literal["accumulation", "instantaneous", "extreme"]
    default_chart: Literal["line", "bar", "scatter"]
    interpolation_allowed: bool


class StationRef(BaseModel):
    station_id: str
    name: str
    state: str | None
    latitude: float
    longitude: float
    is_active: bool | None = None


class StationVariable(BaseModel):
    variable_code: str
    first_date: date
    last_date: date
    days_with_value: int


class Station(BaseModel):
    station_id: str
    name: str
    state: str | None
    latitude: float
    longitude: float
    is_active: bool
    variables: list[StationVariable]


class StationList(BaseModel):
    count: int
    stations: list[Station]


class Availability(BaseModel):
    first_date: date | None
    last_date: date | None


class QueryInfo(BaseModel):
    station: StationRef
    variable: Variable
    start: date
    end: date
    granularity: Literal["daily"] = "daily"
    defaulted: list[str] = []


class QualityCounts(BaseModel):
    observed: int = 0
    unverified: int = 0
    interpolated: int = 0
    missing: int = 0
    no_record: int = 0          # days in range with no row at all (outside the station's record)


class Summary(BaseModel):
    days_in_range: int
    days_covered: int           # days a value accounts for, counting multi-day totals in full
    coverage: float             # days_covered / days_in_range
    multi_day_values: int
    min_single_day: float | None
    max_single_day: float | None
    aggregate: Literal["total", "mean"]
    aggregate_value: float | None
    aggregate_withheld_reason: str | None


class Record(BaseModel):
    date: date
    value: float | None
    quality_state: Literal["observed", "unverified", "interpolated", "missing"]
    accumulation_days: int | None


class ObservationsResponse(BaseModel):
    status: Literal["ok", "no_data"]
    message: str | None = None
    query: QueryInfo
    available: Availability
    quality_counts: QualityCounts
    summary: Summary | None
    records: list[Record]


class RegressionRequest(BaseModel):
    station_id: str = Field(..., pattern=r"^\d{1,6}$")
    variable: Literal["rainfall", "tmax", "tmin"]
    start: date | None = None
    end: date | None = None
    quality_policy: Literal["all", "checked"] = "all"


class RegressionQuery(BaseModel):
    station: StationRef
    variable: Variable
    start: date
    end: date
    quality_policy: Literal["all", "checked"]
    min_months: int
    defaulted: list[str] = []


class RegressionModel(BaseModel):
    n: int
    intercept: float
    trend_per_month: float
    sin_coefficient: float
    cos_coefficient: float
    r_squared: float | None
    adjusted_r_squared: float | None
    rmse: float


class RegressionPoint(BaseModel):
    date: date
    observed: float
    fitted: float | None
    residual: float | None


class RegressionResponse(BaseModel):
    status: Literal["ok", "insufficient", "no_data"]
    message: str | None = None
    query: RegressionQuery
    available: Availability
    months_used: int
    warnings: list[str]
    model: RegressionModel | None
    points: list[RegressionPoint]


# --------------------------------------------------------------------- dependencies
def get_store() -> Generator[db.Store, None, None]:
    with db.connect() as conn:
        yield db.Store(conn)


def install(app: FastAPI) -> None:
    """Add the v1 routes and /health to the app, and answer database problems
    with 503 wherever in a request they surface (report §5.3: a temporary
    dependency failure is 503, never a bare 500)."""
    app.include_router(router)
    app.include_router(health_router)

    @app.exception_handler(db.DatabaseUnavailable)
    async def _database_unavailable(_request: Request, error: db.DatabaseUnavailable):
        return JSONResponse(status_code=503, content={"detail": f"Database unavailable: {error}"})

    @app.exception_handler(db.SchemaOutOfDate)
    async def _schema_out_of_date(_request: Request, error: db.SchemaOutOfDate):
        return JSONResponse(status_code=503, content={"detail": f"Database schema out of date: {error}"})


def group_stations(rows: list[db.CoverageRow]) -> list[Station]:
    """Fold one-row-per-variable into one Station with a list of variables."""
    stations: dict[str, Station] = {}
    for r in rows:
        st = stations.get(r["station_id"])
        if st is None:
            st = stations[r["station_id"]] = Station(
                station_id=r["station_id"], name=r["name"], state=r["state"],
                latitude=r["latitude"], longitude=r["longitude"],
                is_active=r["is_active"], variables=[])
        st.variables.append(StationVariable(
            variable_code=r["variable_code"], first_date=r["first_date"],
            last_date=r["last_date"], days_with_value=r["days_with_value"]))
    return list(stations.values())


# --------------------------------------------------------------------- pure logic
def resolve_range(start: date | None, end: date | None,
                  available: Availability) -> tuple[date, date, list[str]]:
    """Fill in whichever end of the range was not given.

    With neither given, the last DEFAULT_DAYS of the station's own record are
    used, so a station that stopped recording years ago still opens on data.
    """
    defaulted: list[str] = []
    if end is None:
        if start is not None:
            end = start + timedelta(days=DEFAULT_DAYS - 1)
        else:
            end = available.last_date or date.today()
        defaulted.append("end")
    if start is None:
        start = end - timedelta(days=DEFAULT_DAYS - 1)
        defaulted.append("start")

    if start > end:
        raise HTTPException(422, f"start ({start}) is after end ({end}).")
    days = (end - start).days + 1
    if days > MAX_DAYS:
        raise HTTPException(
            422, f"The range is {days} days; at most {MAX_DAYS} days of daily data can be "
                 f"requested at once. Narrow the range.")
    return start, end, defaulted


def summarise(rows: list[db.ObservationRow], start: date, end: date,
              semantic_type: str) -> tuple[QualityCounts, Summary]:
    counts = QualityCounts()
    days_covered = 0
    multi_day = 0
    single_day_values: list[float] = []
    all_values: list[float] = []

    for row in rows:
        state = row["quality_state"]
        setattr(counts, state, getattr(counts, state) + 1)
        if row["value"] is None:
            continue
        value = float(row["value"])
        span = row["accumulation_days"] or 1
        days_covered += span
        all_values.append(value)
        if span > 1:
            multi_day += 1
        else:
            single_day_values.append(value)

    days_in_range = (end - start).days + 1
    counts.no_record = max(days_in_range - len(rows), 0)
    coverage = min(days_covered / days_in_range, 1.0) if days_in_range else 0.0

    is_total = semantic_type == "accumulation"
    aggregate_value = None
    reason = None
    if not all_values:
        reason = "No values in this range."
    elif coverage < COVERAGE_THRESHOLD:
        reason = (f"Only {coverage:.0%} of days in this range have a value; a "
                  f"{'total' if is_total else 'mean'} is shown at {COVERAGE_THRESHOLD:.0%} or above.")
    elif is_total:
        aggregate_value = round(sum(all_values), 2)
    else:
        # A mean of daily extremes uses single-day values only.
        aggregate_value = round(sum(single_day_values) / len(single_day_values), 2) if single_day_values else None

    return counts, Summary(
        days_in_range=days_in_range,
        days_covered=min(days_covered, days_in_range),
        coverage=round(coverage, 4),
        multi_day_values=multi_day,
        min_single_day=min(single_day_values) if single_day_values else None,
        max_single_day=max(single_day_values) if single_day_values else None,
        aggregate="total" if is_total else "mean",
        aggregate_value=aggregate_value,
        aggregate_withheld_reason=reason,
    )


def lookup(store: db.Store, station_id: str, variable: str, start: date | None,
           end: date | None) -> tuple[db.StationRow, db.VariableRow, Availability, date, date, list[str]]:
    """Validate a station/variable/range query the way every endpoint does:
    404 for an unknown station or variable, 422 for a bad range."""
    station_id = station_id.zfill(6)
    var = store.variable(variable)
    if var is None:
        known = ", ".join(v["variable_code"] for v in store.variables())
        raise HTTPException(404, f"Unknown variable '{variable}'. Known variables: {known}.")
    station = store.station(station_id)
    if station is None:
        raise HTTPException(404, f"Unknown station '{station_id}'.")
    available = Availability(**store.availability(station_id, variable))
    start, end, defaulted = resolve_range(start, end, available)
    return station, var, available, start, end, defaulted


# Column names are part of the contract (report FR-08): don't rename them.
EXPORT_COLUMNS = ["station_id", "station_name", "date", "variable", "value", "unit",
                  "quality_flag", "days_covered", "source_product", "ingestion_run_id"]


def plain_number(value: Decimal | float | None) -> str:
    """12.40 -> '12.4', 0.00 -> '0', 120.00 -> '120': the stored value, no float noise."""
    if value is None:
        return ""
    text = format(Decimal(str(value)), "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def export_rows(station: db.StationRow, var: db.VariableRow,
                rows: list[db.ObservationRow]) -> list[list[str]]:
    """One CSV row per stored record, exactly the records /observations returns.
    A missing day keeps its row with an empty value and quality_flag 'missing'
    (never 0); days_covered is how many days the value accounts for."""
    out: list[list[str]] = []
    for r in rows:
        has_value = r["value"] is not None
        out.append([
            station["station_id"], station["name"], r["observed_date"].isoformat(), var["variable_code"],
            plain_number(r["value"]), var["unit"], r["quality_state"],
            str(r["accumulation_days"] or 1) if has_value else "",
            # .get: rows built outside the database (tests) may not carry provenance.
            r.get("source_product") or "", str(r.get("ingestion_run_id") or ""),
        ])
    return out


# --------------------------------------------------------------------- endpoints
@health_router.get("/health")
def health(store: db.Store = Depends(get_store)) -> dict[str, str]:
    """Liveness and readiness: answers 503 if the database is unreachable."""
    store.ping()
    return {"status": "ok", "database": "ok"}


@router.get("/variables", response_model=list[Variable])
def list_variables(store: db.Store = Depends(get_store)):
    """Every variable the dashboard can chart, with the label, unit and default
    chart type the frontend should use (FR-02, FR-07)."""
    return store.variables()


@router.get("/stations", response_model=StationList)
def list_stations(
    variable: str | None = Query(None, description="Only stations that have this variable"),
    min_lat: float | None = Query(None, ge=-90, le=90),
    max_lat: float | None = Query(None, ge=-90, le=90),
    min_lon: float | None = Query(None, ge=-180, le=180),
    max_lon: float | None = Query(None, ge=-180, le=180),
    store: db.Store = Depends(get_store),
):
    """Stations that have data in the database, each with the variables it has
    and the dates they cover (FR-03; lets the variable picker offer only what a
    station records, FR-07). Optionally limited to one variable or a map viewport."""
    if variable is not None and store.variable(variable) is None:
        known = ", ".join(v["variable_code"] for v in store.variables())
        raise HTTPException(404, f"Unknown variable '{variable}'. Known variables: {known}.")

    bbox: tuple[float, float, float, float] | None = None
    if min_lat is not None and max_lat is not None and min_lon is not None and max_lon is not None:
        if min_lat > max_lat or min_lon > max_lon:
            raise HTTPException(422, "min_lat must not exceed max_lat, nor min_lon max_lon.")
        bbox = (min_lat, max_lat, min_lon, max_lon)
    elif any(c is not None for c in (min_lat, max_lat, min_lon, max_lon)):
        raise HTTPException(422, "Give all four of min_lat, max_lat, min_lon, max_lon, or none.")

    stations = group_stations(store.station_coverage(variable_code=variable, bbox=bbox))
    return StationList(count=len(stations), stations=stations)


@router.get("/stations/{station_id}", response_model=Station)
def get_station(
    station_id: str = Path(..., pattern=r"^\d{1,6}$", description="BOM station number"),
    store: db.Store = Depends(get_store),
):
    """One station and the variables it has. A station that is in the BOM
    register but has no data loaded returns an empty variables list."""
    station_id = station_id.zfill(6)
    station = store.station(station_id)
    if station is None:
        raise HTTPException(404, f"Unknown station '{station_id}'.")
    found = group_stations(store.station_coverage(station_ids=[station_id]))
    if found:
        return found[0]
    return Station(**station, variables=[])


@router.get("/observations", response_model=ObservationsResponse)
def get_observations(
    station_id: str = Query(..., pattern=r"^\d{1,6}$", description="BOM station number, e.g. 086338"),
    variable: str = Query(..., description="A variable_code from /api/v1/variables"),
    start: date | None = Query(None, description="First day, YYYY-MM-DD. Default: a year before end"),
    end: date | None = Query(None, description="Last day, YYYY-MM-DD. Default: the station's latest value"),
    store: db.Store = Depends(get_store),
):
    """One station, one variable, one date range of daily values (FR-01)."""
    station, var, available, start, end, defaulted = lookup(store, station_id, variable, start, end)
    query = QueryInfo(station=StationRef(**station), variable=Variable(**var), start=start, end=end,
                      defaulted=defaulted)
    station_id = station["station_id"]

    if available.first_date is None:
        return ObservationsResponse(
            status="no_data", query=query, available=available,
            message=f"{station['name']} has no {var['label'].lower()} records.",
            quality_counts=QualityCounts(no_record=(end - start).days + 1),
            summary=None, records=[])

    rows = store.observations(station_id, variable, start, end)
    counts, summary = summarise(rows, start, end, var["semantic_type"])

    if not any(r["value"] is not None for r in rows):
        return ObservationsResponse(
            status="no_data", query=query, available=available,
            message=(f"No {var['label'].lower()} values between {start} and {end}. "
                     f"This station has them from {available.first_date} to {available.last_date}."),
            quality_counts=counts, summary=summary,
            records=[Record(date=r["observed_date"], value=None, quality_state=r["quality_state"],
                            accumulation_days=r["accumulation_days"]) for r in rows])

    return ObservationsResponse(
        status="ok", query=query, available=available, quality_counts=counts, summary=summary,
        records=[Record(date=r["observed_date"],
                        value=None if r["value"] is None else float(r["value"]),
                        quality_state=r["quality_state"],
                        accumulation_days=r["accumulation_days"]) for r in rows])


@router.post("/regressions", response_model=RegressionResponse)
def post_regression(
    body: RegressionRequest,
    store: db.Store = Depends(get_store)
):
    """Seasonal + Trend regression using one weather variable."""
    from calendar import monthrange

    station_id = body.station_id.zfill(6)

    station = store.station(station_id)
    if station is None:
        raise HTTPException(
            404, f"Unknown station '{station_id}'."
        )

    var = store.variable(body.variable)
    if var is None:
        raise HTTPException(
            404, f"Unknown variable '{body.variable}'."
        )

    available = Availability(
        **store.availability(station_id, body.variable)
    )

    defaulted = []

    end = body.end
    if end is None:
        end = available.last_date or date.today()
        defaulted.append("end")

    start = body.start
    if start is None:
        start = end - timedelta(days=3 * 365)
        defaulted.append("start")

    if start > end:
        raise HTTPException(
            422, "start must not be after end"
        )

    if (end - start).days + 1 > MAX_DAYS:
        raise HTTPException(
            422, f"Maximum range is {MAX_DAYS} days."
        )

    query = RegressionQuery(
        station=StationRef(**station),
        variable=Variable(**var),
        start=start,
        end=end,
        quality_policy=body.quality_policy,
        min_months=seasonal_regression.MIN_MONTHS,
        defaulted=defaulted,
    )

    if available.first_date is None:
        return RegressionResponse(
            status="no_data",
            message="No observations available at this station.",
            query=query,
            available=available,
            months_used=0,
            warnings=[],
            model=None,
            points=[],
        )

    # Use complete calendar months only.
    first_month = date(start.year, start.month, 1)

    if start.day != 1:
        first_month = date(
            start.year + (start.month == 12),
            start.month % 12 + 1,
            1,
        )

    last_day = monthrange(end.year, end.month)[1]

    if end.day == last_day:
        last_month_end = end
    else:
        last_month_end = (
            date(end.year, end.month, 1)
            - timedelta(days=1)
        )

    dates, values = [], []

    if first_month <= last_month_end:
        rows = store.observations(
            station_id,
            body.variable,
            first_month,
            last_month_end,
        )

        dates, values = seasonal_regression.monthly_series(
            rows,
            body.variable,
            body.quality_policy,
        )

    result = seasonal_regression.fit_seasonal(
        dates, values
    )

    if isinstance(result, str):
        return RegressionResponse(
            status="insufficient",
            message=result,
            query=query,
            available=available,
            months_used=len(dates),
            warnings=[],
            model=None,
            points=[
                RegressionPoint(
                    date=d,
                    observed=v,
                    fitted=None,
                    residual=None,
                )
                for d, v in zip(dates, values)
            ],
        )

    warnings = [
        "Historical seasonal trends only; not a forecast."
    ]

    if body.variable == "rainfall":
        warnings.append(
            "Rainfall is irregular, so seasonal fit may be weak."
        )

    return RegressionResponse(
        status="ok",
        query=query,
        available=available,
        months_used=result.n,
        warnings=warnings,
        model=RegressionModel(
            n=result.n,
            intercept=result.intercept,
            trend_per_month=result.trend_per_month,
            sin_coefficient=result.sin_coefficient,
            cos_coefficient=result.cos_coefficient,
            r_squared=result.r_squared,
            adjusted_r_squared=result.adjusted_r_squared,
            rmse=result.rmse,
        ),
        points=[
            RegressionPoint(
                date=d,
                observed=v,
                fitted=f,
                residual=r,
            )
            for d, v, f, r in zip(
                result.dates,
                result.observed,
                result.fitted,
                result.residuals,
            )
        ],
    )

@router.get("/export.csv", response_class=Response,
            responses={200: {"content": {"text/csv": {}}, "description": "The query's records as CSV"}})
def export_csv(
    station_id: str = Query(..., pattern=r"^\d{1,6}$", description="BOM station number"),
    variable: str = Query(..., description="A variable_code from /api/v1/variables"),
    start: date | None = Query(None, description="First day, YYYY-MM-DD"),
    end: date | None = Query(None, description="Last day, YYYY-MM-DD"),
    compare_station_id: str | None = Query(None, pattern=r"^\d{1,6}$",
                                           description="A second station: export a comparison"),
    store: db.Store = Depends(get_store),
):
    """The records of an observations query as CSV (FR-08, DR-01): the same rows
    as /api/v1/observations and the dashboard table, with stable column names,
    the unit on every row, the quality flag, the days each value covers, and the
    source product and ingestion run each value came from.

    With compare_station_id, both stations' records over the same dates, the
    first station's rows first. The file starts with a UTF-8 byte order mark so
    Excel shows units like °C correctly."""
    station, var, _available, start, end, _ = lookup(store, station_id, variable, start, end)
    stations = [station]
    if compare_station_id is not None:
        other = compare_station_id.zfill(6)
        if other == station["station_id"]:
            raise HTTPException(422, "compare_station_id must be a different station.")
        second = store.station(other)
        if second is None:
            raise HTTPException(404, f"Unknown station '{other}'.")
        stations.append(second)

    buffer = io.StringIO()
    buffer.write("\ufeff")
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(EXPORT_COLUMNS)
    for st in stations:
        writer.writerows(export_rows(st, var, store.observations(st["station_id"], variable, start, end)))

    names = "_vs_".join(st["station_id"] for st in stations)
    filename = f"bombastic_{names}_{var['variable_code']}_{start}_{end}.csv"
    return Response(content=buffer.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})
