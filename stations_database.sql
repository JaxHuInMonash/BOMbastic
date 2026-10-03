-- BOMbastic PostgreSQL schema and station import
--
-- Implements docs/data-contract.md. Where this file and that document disagree,
-- the document is right and this file is a bug.
--
-- The staging-table-then-validate structure is from the original schema by
-- HW240823 (commit c1be1de) and is kept deliberately: importing every field as
-- text first means a malformed row is a reportable count rather than an aborted
-- load.
--
-- Changes from that version:
--   * station_id (zero-padded text) is the primary key; the integer site number
--     is gone. Leading zeros are data -- they appear in every rainfall filename
--     and in BOM's own URLs.
--   * district is text, not SMALLINT: 1,895 values carry a leading zero.
--   * is_active is a generated column, so it cannot disagree with end_year.
--   * observations is narrow (one row per station x date x variable) rather than
--     one column per variable, so quality flags survive and a new variable is an
--     INSERT rather than a migration. See docs/data-contract.md section 4.
--   * variables and ingestion_runs added.
--
-- Run from the repository root:
--     psql -v ON_ERROR_STOP=1 -f stations_database.sql

\set ON_ERROR_STOP on

BEGIN;


CREATE SCHEMA IF NOT EXISTS bombastic;


-- ===========================================================================
-- stations -- docs/data-contract.md section 2
-- ===========================================================================
CREATE TABLE IF NOT EXISTS bombastic.stations (
    station_id            CHAR(6)          PRIMARY KEY,
    name                  VARCHAR(60)      NOT NULL,
    district              VARCHAR(4),
    state                 VARCHAR(3),
    latitude              DOUBLE PRECISION NOT NULL,
    longitude             DOUBLE PRECISION NOT NULL,
    start_year            SMALLINT         NOT NULL,
    end_year              SMALLINT,
    -- Generated, not stored independently: the two can never drift apart.
    is_active             BOOLEAN          GENERATED ALWAYS AS (end_year IS NULL) STORED,
    elevation_m           NUMERIC(8, 2),
    barometer_elevation_m NUMERIC(8, 2),
    wmo_id                INTEGER          UNIQUE,
    location_source       VARCHAR(20),
    ingested_at           TIMESTAMPTZ      NOT NULL DEFAULT now(),

    CONSTRAINT stations_id_format     CHECK (station_id ~ '^[0-9]{6}$'),
    CONSTRAINT stations_year_order    CHECK (end_year IS NULL OR end_year >= start_year),
    CONSTRAINT stations_latitude      CHECK (latitude  BETWEEN  -90 AND  90),
    CONSTRAINT stations_longitude     CHECK (longitude BETWEEN -180 AND 180),
    CONSTRAINT stations_state_values  CHECK (
        state IS NULL OR state IN
        ('WA', 'NT', 'SA', 'QLD', 'NSW', 'VIC', 'TAS', 'ANT', 'ISL')
    )
);

CREATE INDEX IF NOT EXISTS idx_stations_state      ON bombastic.stations (state);
CREATE INDEX IF NOT EXISTS idx_stations_active     ON bombastic.stations (is_active);
CREATE INDEX IF NOT EXISTS idx_stations_name_lower ON bombastic.stations (LOWER(name));


-- ===========================================================================
-- variables -- docs/data-contract.md section 3
-- The front end reads unit and default_chart from here, so neither is hardcoded
-- in the client (FR-02, FR-07).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS bombastic.variables (
    variable_code         TEXT    PRIMARY KEY,
    label                 TEXT    NOT NULL,
    unit                  TEXT    NOT NULL,
    semantic_type         TEXT    NOT NULL,
    default_chart         TEXT    NOT NULL,
    interpolation_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    bom_product_code      TEXT,
    bom_obs_code          TEXT,

    CONSTRAINT variables_semantic_type CHECK (
        semantic_type IN ('accumulation', 'instantaneous', 'extreme')
    ),
    CONSTRAINT variables_default_chart CHECK (
        default_chart IN ('line', 'bar', 'scatter')
    )
);

INSERT INTO bombastic.variables
    (variable_code, label, unit, semantic_type, default_chart,
     interpolation_allowed, bom_product_code, bom_obs_code)
VALUES
    ('rainfall', 'Rainfall',            'mm', 'accumulation', 'bar',  FALSE, 'IDCJAC0009', '136'),
    ('tmax',     'Maximum temperature', 'C',  'extreme',      'line', FALSE, 'IDCJAC0010', NULL),
    ('tmin',     'Minimum temperature', 'C',  'extreme',      'line', FALSE, 'IDCJAC0011', NULL)
ON CONFLICT (variable_code) DO UPDATE SET
    label                 = EXCLUDED.label,
    unit                  = EXCLUDED.unit,
    semantic_type         = EXCLUDED.semantic_type,
    default_chart         = EXCLUDED.default_chart,
    interpolation_allowed = EXCLUDED.interpolation_allowed,
    bom_product_code      = EXCLUDED.bom_product_code,
    bom_obs_code          = EXCLUDED.bom_obs_code;
-- bom_obs_code for temperature is deliberately NULL: read it off the CDO URL
-- when the temperature scrape is set up, do not copy a number from elsewhere.


-- ===========================================================================
-- ingestion_runs -- docs/data-contract.md section 6
-- ===========================================================================
CREATE TABLE IF NOT EXISTS bombastic.ingestion_runs (
    run_id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at         TIMESTAMPTZ,
    source               TEXT        NOT NULL,
    variable_code        TEXT        REFERENCES bombastic.variables (variable_code),
    status               TEXT        NOT NULL DEFAULT 'running',
    stations_attempted   INTEGER,
    stations_loaded      INTEGER,
    stations_no_product  INTEGER,
    rows_read            INTEGER,
    rows_loaded          INTEGER,
    rows_rejected        INTEGER,
    notes                TEXT,

    CONSTRAINT runs_status CHECK (status IN ('running', 'success', 'partial', 'failed'))
);


-- ===========================================================================
-- observations -- docs/data-contract.md sections 4 and 5
-- One row per station x date x variable.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS bombastic.observations (
    station_id        CHAR(6)  NOT NULL REFERENCES bombastic.stations (station_id)
                               ON UPDATE CASCADE ON DELETE RESTRICT,
    observed_date     DATE     NOT NULL,
    variable_code     TEXT     NOT NULL REFERENCES bombastic.variables (variable_code)
                               ON UPDATE CASCADE ON DELETE RESTRICT,
    value             NUMERIC(8, 2),
    quality_state     TEXT     NOT NULL,
    -- BOM's "period over which rainfall was measured": greater than 1 means the
    -- figure is a multi-day total reported against its final day.
    accumulation_days SMALLINT,
    source_product    TEXT,
    ingestion_run_id  BIGINT   REFERENCES bombastic.ingestion_runs (run_id),

    -- Makes re-ingestion idempotent (DR-02).
    PRIMARY KEY (station_id, observed_date, variable_code),

    CONSTRAINT observations_quality_state CHECK (
        quality_state IN ('observed', 'unverified', 'interpolated', 'missing')
    ),
    -- The invariant the whole product rests on: a missing day carries no value,
    -- and a day that carries a value is not missing. An observed 0.0 is a
    -- measurement and stays one.
    CONSTRAINT observations_missing_has_no_value CHECK (
        (quality_state = 'missing' AND value IS NULL)
        OR (quality_state <> 'missing' AND value IS NOT NULL)
    ),
    CONSTRAINT observations_accumulation CHECK (
        accumulation_days IS NULL OR accumulation_days >= 1
    )
);

CREATE INDEX IF NOT EXISTS idx_observations_query
    ON bombastic.observations (station_id, variable_code, observed_date);
CREATE INDEX IF NOT EXISTS idx_observations_date
    ON bombastic.observations (observed_date);


-- ===========================================================================
-- Station import
-- Every field lands as text first so a malformed row is counted, not fatal.
-- ===========================================================================
DROP TABLE IF EXISTS bombastic.stations_import;

CREATE UNLOGGED TABLE bombastic.stations_import (
    station_id            TEXT,
    name                  TEXT,
    district              TEXT,
    state                 TEXT,
    latitude              TEXT,
    longitude             TEXT,
    start_year            TEXT,
    end_year              TEXT,
    is_active             TEXT,
    elevation_m           TEXT,
    barometer_elevation_m TEXT,
    wmo_id                TEXT,
    location_source       TEXT
);

-- Produced by BOM-Scraper/station_parser.py. Column order is the contract's.
-- is_active is read but not inserted: the target column is generated.
\copy bombastic.stations_import FROM 'BOM-Scraper/data/stations.csv' WITH (FORMAT csv, HEADER true, NULL '', ENCODING 'UTF8');

INSERT INTO bombastic.stations (
    station_id, name, district, state, latitude, longitude,
    start_year, end_year, elevation_m, barometer_elevation_m,
    wmo_id, location_source
)
SELECT
    BTRIM(station_id),
    BTRIM(name),
    NULLIF(BTRIM(district), ''),
    NULLIF(BTRIM(state), ''),
    latitude::DOUBLE PRECISION,
    longitude::DOUBLE PRECISION,
    start_year::SMALLINT,
    NULLIF(BTRIM(end_year), '')::SMALLINT,
    NULLIF(BTRIM(elevation_m), '')::NUMERIC(8, 2),
    NULLIF(BTRIM(barometer_elevation_m), '')::NUMERIC(8, 2),
    NULLIF(BTRIM(wmo_id), '')::INTEGER,
    NULLIF(BTRIM(location_source), '')
FROM bombastic.stations_import
WHERE BTRIM(station_id) ~ '^[0-9]{6}$'
ON CONFLICT (station_id) DO UPDATE SET
    name                  = EXCLUDED.name,
    district              = EXCLUDED.district,
    state                 = EXCLUDED.state,
    latitude              = EXCLUDED.latitude,
    longitude             = EXCLUDED.longitude,
    start_year            = EXCLUDED.start_year,
    end_year              = EXCLUDED.end_year,
    elevation_m           = EXCLUDED.elevation_m,
    barometer_elevation_m = EXCLUDED.barometer_elevation_m,
    wmo_id                = EXCLUDED.wmo_id,
    location_source       = EXCLUDED.location_source,
    ingested_at           = now();

COMMIT;


-- ===========================================================================
-- Validation. Expected for the current register:
--   rows_in_staging = 19509, rejected_rows = 0, stations_loaded = 19509,
--   still_recording = 6316, variables_defined = 3, observations = 0
-- ===========================================================================
SELECT COUNT(*) AS rows_in_staging FROM bombastic.stations_import;

SELECT COUNT(*) AS rejected_rows
FROM bombastic.stations_import
WHERE COALESCE(BTRIM(station_id), '') !~ '^[0-9]{6}$';

SELECT COUNT(*) AS stations_loaded FROM bombastic.stations;

SELECT COUNT(*) FILTER (WHERE is_active) AS still_recording FROM bombastic.stations;

SELECT COUNT(*) AS variables_defined FROM bombastic.variables;

SELECT COUNT(*) AS observations FROM bombastic.observations;

-- Leading zeros must survive: these are the filenames the rainfall data uses.
SELECT station_id, name, state
FROM bombastic.stations
WHERE station_id IN ('001006', '074128', '094029', '300000')
ORDER BY station_id;

SELECT state, COUNT(*) AS station_count
FROM bombastic.stations
GROUP BY state
ORDER BY station_count DESC;
