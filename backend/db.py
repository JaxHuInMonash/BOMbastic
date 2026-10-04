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


class SchemaOutOfDate(Exception):
    """A table or view the API expects is missing: the schema script is older
    than the code. The API answers 503 with the fix, rather than a bare 500."""


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
            SELECT station_id, name, state, latitude, longitude, is_active
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

    def station_coverage(self, station_ids: list[str] | None = None,
                         variable_code: str | None = None,
                         bbox: tuple[float, float, float, float] | None = None) -> list[dict]:
        """One row per station and variable that has at least one value.

        station_ids limits to those stations; variable_code keeps only stations
        that have that variable (all their variables are still returned);
        bbox is (min_lat, max_lat, min_lon, max_lon).
        """
        where = ["c.days_with_value > 0"]
        params: list = []
        if station_ids is not None:
            where.append("s.station_id = ANY(%s)")
            params.append(station_ids)
        if variable_code is not None:
            where.append("""s.station_id IN (SELECT station_id FROM bombastic.station_coverage
                                             WHERE variable_code = %s AND days_with_value > 0)""")
            params.append(variable_code)
        if bbox is not None:
            where.append("s.latitude BETWEEN %s AND %s AND s.longitude BETWEEN %s AND %s")
            params.extend(bbox)
        try:
            return self.conn.execute(f"""
                SELECT s.station_id, s.name, s.state, s.latitude, s.longitude, s.is_active,
                       c.variable_code, c.first_date, c.last_date, c.days_with_value
                FROM bombastic.station_coverage c
                JOIN bombastic.stations s USING (station_id)
                WHERE {" AND ".join(where)}
                ORDER BY s.station_id, c.variable_code
            """, params).fetchall()
        except psycopg.errors.UndefinedTable as error:
            raise SchemaOutOfDate(
                "bombastic.station_coverage does not exist. Re-run stations_database.sql, "
                "which creates it, then any observations import refreshes it.") from error
        except psycopg.errors.ObjectNotInPrerequisiteState as error:   # created WITH NO DATA
            raise SchemaOutOfDate(
                "bombastic.station_coverage has not been populated. Run "
                "REFRESH MATERIALIZED VIEW bombastic.station_coverage;") from error

    def observations(self, station_id: str, variable_code: str,
                     start: date, end: date) -> list[dict]:
        return self.conn.execute("""
            SELECT observed_date, value, quality_state, accumulation_days
            FROM bombastic.observations
            WHERE station_id = %s AND variable_code = %s
              AND observed_date BETWEEN %s AND %s
            ORDER BY observed_date
        """, (station_id, variable_code, start, end)).fetchall()
