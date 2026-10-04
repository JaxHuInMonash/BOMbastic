-- BOMbastic daily observation import for PostgreSQL
--
-- Loads one variable's daily BOM data into bombastic.observations, the narrow
-- table defined in docs/data-contract.md section 4. Every BOM row becomes one
-- row: a day with no reading is kept as quality_state = 'missing' rather than
-- dropped, so the database can tell "no reading that day" apart from "no row".
--
-- One script for every variable, because BOM's daily products share a layout:
--   Product code, station number, Year, Month, Day, <value>,
--   <days the value covers>, Quality
-- Rainfall (IDCJAC0009), maximum (IDCJAC0010) and minimum temperature
-- (IDCJAC0011) all fit it. The variable decides only three things, all read
-- from bombastic.variables rather than written here:
--   * which product code a row must carry (bom_product_code)
--   * whether negative values are valid (not for 'accumulation' variables)
--   * which variable_code the rows are stored under
--
-- Built on HW240823's rainfall import (e1b6b4f): the staging table, text-first
-- load and idempotent upsert are his.
--
-- Quality mapping (contract section 5):
--   value empty                  -> 'missing',    value NULL
--   value present, Quality = 'Y' -> 'observed'
--   value present, Quality = 'N' -> 'unverified'
--   value present, Quality empty -> 'unverified'  (BOM has not confirmed QC)
-- accumulation_days is BOM's "Period over which rainfall was measured" or "Days
-- of accumulation of ... temperature". A value spanning several days is reported
-- against the last of them and must never be drawn as one day's reading. A
-- period of 0 is stored as NULL: the contract requires accumulation_days >= 1.
--
-- Rows are rejected (counted in ingestion_runs, not inserted) for: an unknown
-- station, an impossible date, an unparseable value, a negative value for an
-- accumulation variable, or a product code that does not belong to the variable.
--
-- Usage, from the repository root, after stations_database.sql:
--     python BOM-Scraper/combine_csvs.py tmax
--     psql -v ON_ERROR_STOP=1 -v variable=tmax -f observations_database.sql
-- variable defaults to rainfall; csv defaults to <variable>_all.csv and can be
-- given explicitly with -v csv=path/to/file.csv

\set ON_ERROR_STOP on

\if :{?variable}
\else
\set variable rainfall
\endif
\if :{?csv}
\else
\set csv :variable '_all.csv'
\endif

-- Fail early, with a readable message, on a variable the database does not know.
SELECT COUNT(*) = 1 AS variable_known
FROM bombastic.variables WHERE variable_code = :'variable' \gset
\if :variable_known
\else
-- Stops the script with the reason in the error text (ON_ERROR_STOP).
SELECT CAST('unknown variable ' || :'variable' || '; expected a code in bombastic.variables' AS INTEGER);
\endif

SELECT bom_product_code AS expected_product,
       (semantic_type = 'accumulation') AS non_negative
FROM bombastic.variables WHERE variable_code = :'variable' \gset

\echo Loading :variable '/' :expected_product from :csv

BEGIN;

INSERT INTO bombastic.ingestion_runs (source, variable_code, status)
VALUES ('BOM CDO ' || :'expected_product' || ' (' || :'csv' || ')', :'variable', 'running')
RETURNING run_id AS run_id \gset


-- ---------------------------------------------------------------------------
-- 1. Stage the eight BOM columns as text
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS bombastic.observation_import;

CREATE UNLOGGED TABLE bombastic.observation_import (
    product_code       TEXT,
    station_id         TEXT,
    observation_year   TEXT,
    observation_month  TEXT,
    observation_day    TEXT,
    raw_value          TEXT,
    raw_period_days    TEXT,
    raw_quality        TEXT
);

-- \copy does not expand psql variables, so the command is assembled first.
\set copy_command '\\copy bombastic.observation_import (product_code, station_id, observation_year, observation_month, observation_day, raw_value, raw_period_days, raw_quality) FROM ' :'csv' ' WITH (FORMAT csv, HEADER true, NULL '''', ENCODING ''UTF8'')'
:copy_command


-- ---------------------------------------------------------------------------
-- 2. Type every row. Nested CASE guarantees each cast runs only after its
--    format check has passed, so a malformed row becomes NULL, never an error.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE observation_typed ON COMMIT DROP AS
SELECT
    CASE WHEN BTRIM(station_id) ~ '^[0-9]{1,6}$'
         THEN LPAD(BTRIM(station_id), 6, '0')
    END AS station_id,

    CASE WHEN BTRIM(observation_year) ~ '^[1-9][0-9]{3}$'
          AND BTRIM(observation_month) ~ '^[0-9]{1,2}$'
          AND BTRIM(observation_day) ~ '^[0-9]{1,2}$'
         THEN CASE WHEN BTRIM(observation_month)::INTEGER BETWEEN 1 AND 12
                   THEN CASE WHEN BTRIM(observation_day)::INTEGER BETWEEN 1 AND EXTRACT(DAY FROM
                                  make_date(BTRIM(observation_year)::INTEGER, BTRIM(observation_month)::INTEGER, 1)
                                  + INTERVAL '1 month - 1 day')::INTEGER
                             THEN make_date(BTRIM(observation_year)::INTEGER,
                                            BTRIM(observation_month)::INTEGER,
                                            BTRIM(observation_day)::INTEGER)
                        END
              END
    END AS observed_date,

    NULLIF(BTRIM(raw_value), '') IS NOT NULL AS has_value,

    -- Temperatures can be negative; whether that is allowed is decided in step 3.
    CASE WHEN BTRIM(raw_value) ~ '^-?[0-9]+(\.[0-9]+)?$'
         THEN BTRIM(raw_value)::NUMERIC(8, 2)
    END AS value,

    -- '3.0' and '3' are both accepted; pandas writes the former.
    CASE WHEN BTRIM(raw_period_days) ~ '^[0-9]+(\.0+)?$'
         THEN BTRIM(raw_period_days)::NUMERIC::INTEGER
    END AS period_days,

    NULLIF(BTRIM(raw_quality), '') AS quality,
    NULLIF(BTRIM(product_code), '') AS source_product
FROM bombastic.observation_import
-- Header lines repeated by a naive concatenation are not data rows.
WHERE BTRIM(COALESCE(product_code, '')) <> 'Product code';


-- ---------------------------------------------------------------------------
-- 3. Separate loadable rows from rejects (the contract's invalid_excluded)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE observation_valid ON COMMIT DROP AS
SELECT
    t.station_id,
    t.observed_date,
    t.value,
    CASE
        WHEN NOT t.has_value THEN 'missing'
        WHEN t.quality = 'Y' THEN 'observed'
        ELSE 'unverified'
    END AS quality_state,
    CASE WHEN t.has_value AND t.period_days >= 1 THEN t.period_days::SMALLINT END AS accumulation_days,
    t.source_product,
    t.period_days,
    t.quality,
    t.has_value
FROM observation_typed t
JOIN bombastic.stations s ON s.station_id = t.station_id
WHERE t.observed_date IS NOT NULL
  AND t.source_product = :'expected_product'
  AND (NOT t.has_value OR t.value IS NOT NULL)
  -- A missing day has no value to be negative; without the IS NULL test the
  -- comparison is NULL and every missing rainfall day would be rejected.
  AND (t.value IS NULL OR t.value >= 0 OR NOT :'non_negative'::BOOLEAN);

SELECT
    (SELECT COUNT(*) FROM observation_typed)                                     AS rows_read,
    (SELECT COUNT(*) FROM observation_typed) - (SELECT COUNT(*) FROM observation_valid) AS rows_rejected,
    (SELECT COUNT(DISTINCT station_id) FROM observation_typed)                   AS stations_attempted,
    (SELECT COUNT(*) FROM observation_typed t
       WHERE t.station_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM bombastic.stations s WHERE s.station_id = t.station_id)) AS rows_unknown_station,
    (SELECT COUNT(*) FROM observation_typed
       WHERE source_product IS DISTINCT FROM :'expected_product')                AS rows_wrong_product,
    (SELECT COUNT(*) FROM observation_valid WHERE has_value AND period_days = 0) AS rows_period_zero,
    (SELECT COUNT(*) FROM observation_valid WHERE has_value AND quality IS NULL) AS rows_quality_blank
\gset

SELECT CASE
    WHEN :rows_wrong_product > 0
        THEN format('%s rows carry a product code other than %s; skipped. Is this the right CSV for %s?',
                    :rows_wrong_product, :'expected_product', :'variable')
    WHEN :rows_unknown_station > 0
        THEN format('%s rows reference stations not in bombastic.stations; skipped', :rows_unknown_station)
    ELSE 'every row has the expected product and a known station'
END AS input_check;


-- ---------------------------------------------------------------------------
-- 4. Upsert. The primary key (station_id, observed_date, variable_code) makes
--    a re-run update in place rather than duplicate (DR-02).
-- ---------------------------------------------------------------------------
WITH deduplicated AS (
    -- A station-date should appear once. If it ever appears twice, prefer the
    -- row that carries a value, then the quality-controlled one, so the choice
    -- is deterministic rather than left to scan order.
    SELECT DISTINCT ON (station_id, observed_date)
        station_id, observed_date, value, quality_state, accumulation_days, source_product
    FROM observation_valid
    ORDER BY station_id, observed_date, (value IS NULL), (quality_state <> 'observed'), accumulation_days NULLS FIRST
)
INSERT INTO bombastic.observations (
    station_id, observed_date, variable_code, value,
    quality_state, accumulation_days, source_product, ingestion_run_id
)
SELECT
    station_id, observed_date, :'variable', value,
    quality_state, accumulation_days, source_product, :run_id
FROM deduplicated
ON CONFLICT (station_id, observed_date, variable_code)
DO UPDATE SET
    value             = EXCLUDED.value,
    quality_state     = EXCLUDED.quality_state,
    accumulation_days = EXCLUDED.accumulation_days,
    source_product    = EXCLUDED.source_product,
    ingestion_run_id  = EXCLUDED.ingestion_run_id;

SELECT COUNT(*) AS rows_loaded, COUNT(DISTINCT station_id) AS stations_loaded
FROM bombastic.observations
WHERE ingestion_run_id = :run_id
\gset

UPDATE bombastic.ingestion_runs
SET completed_at       = now(),
    status             = CASE WHEN :rows_rejected > 0 THEN 'partial' ELSE 'success' END,
    stations_attempted = :stations_attempted,
    stations_loaded    = :stations_loaded,
    rows_read          = :rows_read,
    rows_loaded        = :rows_loaded,
    rows_rejected      = :rows_rejected,
    notes              = format(
        '%s rows had a value but no Quality flag (loaded as unverified); '
        '%s rows had period 0 (accumulation_days stored as NULL); '
        '%s rows had another product code; '
        '%s duplicate station-dates collapsed',
        :rows_quality_blank, :rows_period_zero, :rows_wrong_product,
        :rows_read - :rows_rejected - :rows_loaded)
WHERE run_id = :run_id;

DROP TABLE bombastic.observation_import;

COMMIT;

ANALYZE bombastic.observations;

-- Keep the per-station summary behind GET /api/v1/stations in step with the data.
REFRESH MATERIALIZED VIEW bombastic.station_coverage;


-- ===========================================================================
-- Validation: this run, and the variable's totals across all runs.
-- ===========================================================================
SELECT run_id, variable_code, status, rows_read, rows_loaded, rows_rejected,
       stations_attempted, stations_loaded, notes
FROM bombastic.ingestion_runs
WHERE run_id = :run_id;

SELECT quality_state, COUNT(*) AS rows,
       MIN(value) AS min_value, MAX(value) AS max_value
FROM bombastic.observations
WHERE variable_code = :'variable'
GROUP BY quality_state
ORDER BY quality_state;

SELECT COUNT(*) AS multi_day_values
FROM bombastic.observations
WHERE variable_code = :'variable' AND accumulation_days > 1;
