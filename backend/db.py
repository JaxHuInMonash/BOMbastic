"""
Read-only access to the BOMbastic PostgreSQL database.

Every query the API makes lives here, so the HTTP layer (api_v1.py) never
writes SQL and can be tested against an in-memory stand-in.

Connection settings come from the environment:
    BOMBASTIC_DATABASE_URL   default postgresql://postgres@localhost:5432/bombastic
    PGPASSWORD               read by the PostgreSQL client library itself, so
                             the password never has to appear in the URL or code
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import date
from typing import Iterator

import psycopg
from psycopg.rows import dict_row

DATABASE_URL = os.environ.get(
    "BOMBASTIC_DATABASE_URL", "postgresql://postgres@localhost:5432/bombastic"
)
CONNECT_TIMEOUT_SECONDS = 5


class DatabaseUnavailable(Exception):
    """The database could not be reached. The API answers 503, not 500."""


@contextmanager
def connect(url: str | None = None) -> Iterator[psycopg.Connection]:
    try:
        conn = psycopg.connect(url or DATABASE_URL, row_factory=dict_row,
                               autocommit=True, connect_timeout=CONNECT_TIMEOUT_SECONDS)
    except psycopg.OperationalError as error:
        raise DatabaseUnavailable(str(error).strip()) from error
    try:
        yield conn
    finally:
        conn.close()


class Store:
    """The queries the API needs, against one open connection."""

    def __init__(self, conn: psycopg.Connection):
        self.conn = conn

    def ping(self) -> bool:
        return self.conn.execute("SELECT 1 AS ok").fetchone()["ok"] == 1

    def variables(self) -> list[dict]:
        return self.conn.execute("""
            SELECT variable_code, label, unit, semantic_type, default_chart,
                   interpolation_allowed
            FROM bombastic.variables
            ORDER BY variable_code
        """).fetchall()

    def variable(self, code: str) -> dict | None:
        return self.conn.execute("""
            SELECT variable_code, label, unit, semantic_type, default_chart,
                   interpolation_allowed
            FROM bombastic.variables
            WHERE variable_code = %s
        """, (code,)).fetchone()

    def station(self, station_id: str) -> dict | None:
        return self.conn.execute("""
            SELECT station_id, name, state, latitude, longitude
            FROM bombastic.stations
            WHERE station_id = %s
        """, (station_id,)).fetchone()

    def availability(self, station_id: str, variable_code: str) -> dict:
        """First and last date with a value, for this station and variable."""
        return self.conn.execute("""
            SELECT MIN(observed_date) AS first_date, MAX(observed_date) AS last_date
            FROM bombastic.observations
            WHERE station_id = %s AND variable_code = %s AND value IS NOT NULL
        """, (station_id, variable_code)).fetchone()

    def observations(self, station_id: str, variable_code: str,
                     start: date, end: date) -> list[dict]:
        return self.conn.execute("""
            SELECT observed_date, value, quality_state, accumulation_days
            FROM bombastic.observations
            WHERE station_id = %s AND variable_code = %s
              AND observed_date BETWEEN %s AND %s
            ORDER BY observed_date
        """, (station_id, variable_code, start, end)).fetchall()
