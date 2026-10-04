"""
Versioned API for the dashboard, reading from PostgreSQL.

Implements the first two endpoints of the report's REST contract (section 5.3),
plus the health check:

    GET /api/v1/variables      what can be charted, with label, unit and chart type
    GET /api/v1/stations       stations with data, and which variables each has
    GET /api/v1/stations/{id}  one station and its variables
    GET /api/v1/observations   one station, one variable, one date range
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

from datetime import date, timedelta
from typing import Iterator, Literal

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Path, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import db

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


# --------------------------------------------------------------------- dependencies
def get_store() -> Iterator[db.Store]:
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


def group_stations(rows: list[dict]) -> list[Station]:
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
    defaulted = []
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


def summarise(rows: list[dict], start: date, end: date,
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


# --------------------------------------------------------------------- endpoints
@health_router.get("/health")
def health(store: db.Store = Depends(get_store)) -> dict:
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

    corners = (min_lat, max_lat, min_lon, max_lon)
    if any(c is not None for c in corners) and not all(c is not None for c in corners):
        raise HTTPException(422, "Give all four of min_lat, max_lat, min_lon, max_lon, or none.")
    bbox = corners if all(c is not None for c in corners) else None
    if bbox and (min_lat > max_lat or min_lon > max_lon):
        raise HTTPException(422, "min_lat must not exceed max_lat, nor min_lon max_lon.")

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
    query = QueryInfo(station=station, variable=var, start=start, end=end, defaulted=defaulted)

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
