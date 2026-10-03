-- BOMbastic rainfall import for PostgreSQL
--
-- Loads daily rainfall into bombastic.observations, the narrow table defined in
-- docs/data-contract.md section 4. Every BOM row becomes one row: a day with no
-- reading is kept as quality_state = 'missing' rather than dropped, so the
-- database can tell "no reading that day" apart from "no row at all".
--
-- Built on HW240823's original import (e1b6b4f). The staging table, the
-- text-first load and the idempotent upsert are his and are kept. What changed:
--   * targets bombastic.observations (station_id CHAR(6)) instead of the wide
--     weather_observations table (site INTEGER), which the contract replaces
--   * keeps missing days, mapped to quality_state = 'missing' (contract section 5)
--   * reads the accumulation period correctly. rainfall_data.py writes it as
--     '3.0', which the old '^[0-9]+$' test rejected, so every period became NULL
--   * unknown stations and unparseable rows are counted and skipped, not fatal,
--     and the counts are recorded in bombastic.ingestion_runs (contract section 6)
--
-- Quality mapping (contract section 5):
--   value empty                  -> 'missing',    value NULL
--   value present, Quality = 'Y' -> 'observed'
--   value present, Quality = 'N' -> 'unverified'
--   value present, Quality empty -> 'unverified'   (BOM has not confirmed QC;
--                                                   72 rows in the selected set)
-- accumulation_days is BOM's "Period over which rainfall was measured". A period
-- of 0 (31 rows in the selected set) is stored as NULL: the contract requires
-- accumulation_days >= 1 and BOM does not document what 0 means.
--
-- Prerequisites:
--   1. Run stations_database.sql first.
--   2. Build rainfall_all.csv in the repository root: one header line, then the
--      data rows of every file in BOM-Scraper/data/rainfall/selected/
--      (repeated header lines are also tolerated and skipped).
--   3. Run from the repository root:
--          psql -v ON_ERROR_STOP=1 -f rainfall_database.sql

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO bombastic.ingestion_runs (source, variable_code, status)
VALUES ('BOM CDO IDCJAC0009 (rainfall_all.csv)', 'rainfall', 'running')
RETURNING run_id AS run_id \gset


-- ---------------------------------------------------------------------------
-- 1. Stage the eight BOM columns as text
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS bombastic.rainfall_import;

CREATE UNLOGGED TABLE bombastic.rainfall_import (
    product_code          TEXT,
    station_id            TEXT,
    observation_year      TEXT,
    observation_month     TEXT,
    observation_day       TEXT,
    rainfall_mm           TEXT,
    rainfall_period_days  TEXT,
    rainfall_quality      TEXT
);

-- Keep this complete \copy command on one physical line.
\copy bombastic.rainfall_import (product_code, station_id, observation_year, observation_month, observation_day, rainfall_mm, rainfall_period_days, rainfall_quality) FROM 'rainfall_all.csv' WITH (FORMAT csv, HEADER true, NULL '', ENCODING 'UTF8')


-- ---------------------------------------------------------------------------
-- 2. Type every row. Nested CASE guarantees each cast runs only after its
--    format check has passed, so a malformed row becomes NULL, never an error.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE rainfall_typed ON COMMIT DROP AS
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

    NULLIF(BTRIM(rainfall_mm), '') IS NOT NULL AS has_value,

    CASE WHEN BTRIM(rainfall_mm) ~ '^[0-9]+(\.[0-9]+)?$'
         THEN BTRIM(rainfall_mm)::NUMERIC(8, 2)
    END AS value,

    -- '3.0' and '3' are both accepted; pandas writes the former.
    CASE WHEN BTRIM(rainfall_period_days) ~ '^[0-9]+(\.0+)?$'
         THEN BTRIM(rainfall_period_days)::NUMERIC::INTEGER
    END AS period_days,

    NULLIF(BTRIM(rainfall_quality), '') AS quality,
    NULLIF(BTRIM(product_code), '') AS source_product
FROM bombastic.rainfall_import
-- Header lines repeated by a naive concatenation are not data rows.
WHERE BTRIM(COALESCE(product_code, '')) <> 'Product code';


-- ---------------------------------------------------------------------------
-- 3. Separate loadable rows from rejects (the contract's invalid_excluded)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE rainfall_valid ON COMMIT DROP AS
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
FROM rainfall_typed t
JOIN bombastic.stations s ON s.station_id = t.station_id
WHERE t.observed_date IS NOT NULL
  AND (NOT t.has_value OR t.value IS NOT NULL);

SELECT
    (SELECT COUNT(*) FROM rainfall_typed)                                  AS rows_read,
    (SELECT COUNT(*) FROM rainfall_typed) - (SELECT COUNT(*) FROM rainfall_valid) AS rows_rejected,
    (SELECT COUNT(DISTINCT station_id) FROM rainfall_typed)                AS stations_attempted,
    (SELECT COUNT(*) FROM rainfall_typed t
       WHERE t.station_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM bombastic.stations s WHERE s.station_id = t.station_id)) AS rows_unknown_station,
    (SELECT COUNT(*) FROM rainfall_valid WHERE has_value AND period_days = 0) AS rows_period_zero,
    (SELECT COUNT(*) FROM rainfall_valid WHERE has_value AND quality IS NULL)  AS rows_quality_blank
\gset

SELECT CASE WHEN :rows_unknown_station > 0
            THEN format('%s rows reference stations not in bombastic.stations; skipped', :rows_unknown_station)
            ELSE 'every row references a known station'
       END AS station_check;


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
    FROM rainfall_valid
    ORDER BY station_id, observed_date, (value IS NULL), (quality_state <> 'observed'), accumulation_days NULLS FIRST
)
INSERT INTO bombastic.observations (
    station_id, observed_date, variable_code, value,
    quality_state, accumulation_days, source_product, ingestion_run_id
)
SELECT
    station_id, observed_date, 'rainfall', value,
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
        '%s duplicate station-dates collapsed',
        :rows_quality_blank, :rows_period_zero,
        :rows_read - :rows_rejected - :rows_loaded)
WHERE run_id = :run_id;

DROP TABLE bombastic.rainfall_import;

COMMIT;

ANALYZE bombastic.observations;


-- ===========================================================================
-- Validation. For the 219 selected stations, expected:
--   rows_read 9,351,204 · rows_loaded 9,351,204 · rows_rejected 0
--   missing 910,073 · observed 7,968,480 (Y) · unverified 472,651 (N or blank)
--   accumulation_days > 1: 21,326 rows (two more rows carry a period but no
--   value; they load as missing, with accumulation_days NULL)
-- Station 074128 should match docs/data-contract.md section 5:
--   58,400 observed, 1,093 unverified, 2,094 missing, 19 multi-day totals,
--   and 46,980 zero readings (46,048 observed + 932 unverified).
-- ===========================================================================
SELECT run_id, status, rows_read, rows_loaded, rows_rejected,
       stations_attempted, stations_loaded, notes
FROM bombastic.ingestion_runs
WHERE run_id = :run_id;

SELECT quality_state, COUNT(*) AS rows
FROM bombastic.observations
WHERE variable_code = 'rainfall'
GROUP BY quality_state
ORDER BY quality_state;

SELECT COUNT(*) AS multi_day_totals
FROM bombastic.observations
WHERE variable_code = 'rainfall' AND accumulation_days > 1;

SELECT
    COUNT(*) FILTER (WHERE quality_state = 'observed' AND value = 0) AS observed_zeros,
    COUNT(*) FILTER (WHERE quality_state = 'missing')                AS missing_days,
    COUNT(*) FILTER (WHERE accumulation_days > 1)                    AS multi_day_totals,
    MIN(observed_date) AS first_date,
    MAX(observed_date) AS last_date
FROM bombastic.observations
WHERE station_id = '074128' AND variable_code = 'rainfall';
