-- BOMbastic rainfall import for PostgreSQL
--
-- Prerequisites:
--   1. Run stations_database.sql first.
--   2. Combine the station CSV files into rainfall_all.csv in the project root.
--   3. Run this file from the project root with psql.

\set ON_ERROR_STOP on

BEGIN;

-- Add the rainfall fields to the existing daily weather table.
ALTER TABLE bombastic.weather_observations
    ADD COLUMN IF NOT EXISTS rainfall_period_days SMALLINT,
    ADD COLUMN IF NOT EXISTS rainfall_quality VARCHAR(5);

-- Load the eight original BOM CSV columns as text first.
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
-- Stop if a valid rainfall row references a station missing from stations.
DO $$
DECLARE
    orphan_count BIGINT;
BEGIN
    SELECT COUNT(DISTINCT r.station_id)
    INTO orphan_count
    FROM bombastic.rainfall_import r
    LEFT JOIN bombastic.stations s
        ON s.site = BTRIM(r.station_id)::INTEGER
    WHERE BTRIM(r.station_id) ~ '^[0-9]{1,6}$'
      AND NULLIF(BTRIM(r.rainfall_mm), '') IS NOT NULL
      AND s.site IS NULL;

    IF orphan_count > 0 THEN
        RAISE EXCEPTION
            'Rainfall data contains % station IDs not found in bombastic.stations',
            orphan_count;
    END IF;
END
$$;

-- Convert the BOM year/month/day columns into one PostgreSQL DATE.
-- Empty or non-numeric rainfall values are skipped.
WITH valid_rainfall AS (
    SELECT
        BTRIM(station_id)::INTEGER AS site,
        make_date(
            observation_year::INTEGER,
            observation_month::INTEGER,
            observation_day::INTEGER
        ) AS observation_date,
        rainfall_mm::NUMERIC(8, 2) AS rainfall_mm,
        CASE
            WHEN BTRIM(COALESCE(rainfall_period_days, '')) ~ '^[0-9]+$'
            THEN rainfall_period_days::SMALLINT
            ELSE NULL
        END AS rainfall_period_days,
        NULLIF(BTRIM(rainfall_quality), '') AS rainfall_quality
    FROM bombastic.rainfall_import
    WHERE BTRIM(station_id) ~ '^[0-9]{1,6}$'
      AND observation_year ~ '^[0-9]{4}$'
      AND observation_month ~ '^[0-9]{1,2}$'
      AND observation_month::INTEGER BETWEEN 1 AND 12
      AND observation_day ~ '^[0-9]{1,2}$'
      AND observation_day::INTEGER BETWEEN 1 AND 31
      AND BTRIM(COALESCE(rainfall_mm, '')) ~ '^[0-9]+(\.[0-9]+)?$'
),
deduplicated_rainfall AS (
    SELECT DISTINCT ON (site, observation_date)
        site,
        observation_date,
        rainfall_mm,
        rainfall_period_days,
        rainfall_quality
    FROM valid_rainfall
    ORDER BY site, observation_date
)
INSERT INTO bombastic.weather_observations (
    site,
    observation_date,
    rainfall_mm,
    rainfall_period_days,
    rainfall_quality
)
SELECT
    site,
    observation_date,
    rainfall_mm,
    rainfall_period_days,
    rainfall_quality
FROM deduplicated_rainfall
ON CONFLICT (site, observation_date)
DO UPDATE SET
    rainfall_mm = EXCLUDED.rainfall_mm,
    rainfall_period_days = EXCLUDED.rainfall_period_days,
    rainfall_quality = EXCLUDED.rainfall_quality;

COMMIT;

ANALYZE bombastic.weather_observations;

-- Validation results shown after a successful import.
SELECT COUNT(*) AS rainfall_observation_count
FROM bombastic.weather_observations
WHERE rainfall_mm IS NOT NULL;

SELECT
    COUNT(DISTINCT site) AS stations_with_rainfall,
    MIN(observation_date) AS first_observation_date,
    MAX(observation_date) AS last_observation_date
FROM bombastic.weather_observations
WHERE rainfall_mm IS NOT NULL;

SELECT
    s.site,
    s.site_name,
    COUNT(*) AS rainfall_records,
    MIN(w.observation_date) AS first_date,
    MAX(w.observation_date) AS last_date
FROM bombastic.weather_observations w
JOIN bombastic.stations s
    ON s.site = w.site
WHERE w.rainfall_mm IS NOT NULL
GROUP BY s.site, s.site_name
ORDER BY rainfall_records DESC
LIMIT 10;
