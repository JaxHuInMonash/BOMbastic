"""
Minimal FastAPI backend for FR-03 (map selection).

Serves the station list built by scripts/build_map_stations.py so the
frontend map can plot markers and hand back the selected station's
details on click. This is a stub sized for the sign-off demo: it reads
a static JSON file rather than Postgres, since NFR-05/FR-01 already own
the real database ingestion path. Swapping the JSON read for a DB query
later doesn't change the endpoint's contract.

The versioned endpoints (/api/v1/variables, /api/v1/observations, /health)
live in api_v1.py and read PostgreSQL. The endpoints below still read the
static JSON and the rainfall CSVs, so the existing map keeps working while the
frontend moves over.

Run, from backend/:
    pip install -r ../requirements.txt
    $env:PGPASSWORD = "..."          # PowerShell; the API reads it from the environment
    uvicorn main:app --reload --port 8000
Then open http://localhost:8000/docs for the generated API documentation (DR-03).
"""

import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from api_v1 import health_router, router as api_v1_router
from rainfall import load_flagged_rainfall

STATIONS_FILE = Path(__file__).parent / "map_stations.json"

# Points at BOM-Scraper/data/rainfall in the real repo layout. Override
# with the RAINFALL_DIR env var if running this outside the repo root.
RAINFALL_DIR = os.environ.get(
    "RAINFALL_DIR",
    str(Path(__file__).parent.parent / "BOM-Scraper" / "data" / "rainfall"),
)

app = FastAPI(title="BOMbastic Map API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to the deployed frontend origin before submission
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(api_v1_router)
app.include_router(health_router)

_stations_cache = None


def load_stations():
    global _stations_cache
    if _stations_cache is None:
        with open(STATIONS_FILE) as f:
            _stations_cache = json.load(f)
    return _stations_cache


@app.get("/api/stations")
def get_stations():
    """All stations available for the map (FR-03 acceptance criterion:
    'Location markers render on map')."""
    return load_stations()


@app.get("/api/stations/{station_id}")
def get_station(station_id: str):
    """Details for one station, e.g. after a marker click, so the
    dashboard can refresh for that location."""
    for s in load_stations():
        if s["station_id"] == station_id:
            return s
    raise HTTPException(status_code=404, detail="Station not found")


@app.get("/api/rainfall/{station_id}")
def get_rainfall(
    station_id: str,
    start_year: int | None = Query(default=None),
    end_year: int | None = Query(default=None),
):
    """Daily rainfall for a station, each record flagged 'ok', 'missing',
    'accumulated' (a multi-day total backdated onto one date) or
    'unverified' (NFR-05: users must be able to tell these apart, not
    have them silently shown as normal same-day readings)."""
    records, summary = load_flagged_rainfall(station_id, RAINFALL_DIR, start_year, end_year)
    if records is None:
        raise HTTPException(status_code=404, detail="No rainfall data for this station")
    return {"station_id": station_id, "summary": summary, "records": records}
