-- BOMbastic PostgreSQL database schema and station CSV import

\set ON_ERROR_STOP on
BEGIN;


CREATE SCHEMA IF NOT EXISTS bombastic;

-- Final station metadata table used by the dashboard and API.
CREATE TABLE IF NOT EXISTS bombastic.stations (
    station_id     CHAR(6) NOT NULL UNIQUE,
    site            INTEGER PRIMARY KEY,
    dist            SMALLINT,
    site_name       VARCHAR(150) NOT NULL,
    start_year      SMALLINT NOT NULL,
    end_year        SMALLINT,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    location_source VARCHAR(30),
    state           VARCHAR(3),
    height_m        NUMERIC(8, 2),
    barometer_height_m NUMERIC(8, 2),
    wmo             INTEGER UNIQUE,
    is_active       BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT stations_site_positive CHECK (site > 0),
    CONSTRAINT stations_year_order CHECK (
        end_year IS NULL OR end_year >= start_year
    ),
    CONSTRAINT stations_latitude_range CHECK (latitude BETWEEN -90 AND 90),
    CONSTRAINT stations_longitude_range CHECK (longitude BETWEEN -180 AND 180),
    CONSTRAINT stations_state_values CHECK (
        state IS NULL OR state IN
        ('WA', 'NT', 'SA', 'QLD', 'NSW', 'VIC', 'TAS', 'ANT', 'ISL')
    ),
    CONSTRAINT stations_active_end_year CHECK (
        (is_active = TRUE AND end_year IS NULL)
        OR (is_active = FALSE AND end_year IS NOT NULL)
    )
);

-- Future daily observations link to stations through the site foreign key.
-- The weather columns can be extended after the cleaned observation CSV is ready.
CREATE TABLE IF NOT EXISTS bombastic.weather_observations (
    observation_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    site            INTEGER NOT NULL,
    observation_date DATE NOT NULL,
    min_temp_c      NUMERIC(5, 2),
    max_temp_c      NUMERIC(5, 2),
    rainfall_mm     NUMERIC(8, 2),
    humidity_percent NUMERIC(5, 2),
    wind_speed_kmh  NUMERIC(6, 2),
    CONSTRAINT weather_station_fk
        FOREIGN KEY (site)
        REFERENCES bombastic.stations(site)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT weather_site_date_unique UNIQUE (site, observation_date),
    CONSTRAINT weather_temperature_order CHECK (
        min_temp_c IS NULL OR max_temp_c IS NULL OR min_temp_c <= max_temp_c
    ),
    CONSTRAINT weather_rainfall_nonnegative CHECK (
        rainfall_mm IS NULL OR rainfall_mm >= 0
    ),
    CONSTRAINT weather_humidity_range CHECK (
        humidity_percent IS NULL OR humidity_percent BETWEEN 0 AND 100
    ),
    CONSTRAINT weather_wind_nonnegative CHECK (
        wind_speed_kmh IS NULL OR wind_speed_kmh >= 0
    )
);

CREATE INDEX IF NOT EXISTS idx_stations_state
    ON bombastic.stations(state);

CREATE INDEX IF NOT EXISTS idx_stations_active
    ON bombastic.stations(is_active);

CREATE INDEX IF NOT EXISTS idx_stations_name_lower
    ON bombastic.stations(LOWER(site_name));

CREATE INDEX IF NOT EXISTS idx_weather_date
    ON bombastic.weather_observations(observation_date);

-- Import every CSV field as text first. This prevents invalid footer rows from
-- stopping the whole import and gives the team an auditable validation stage.
DROP TABLE IF EXISTS bombastic.stations_import;

CREATE UNLOGGED TABLE bombastic.stations_import (
    station_id  TEXT,
    site        TEXT,
    dist        TEXT,
    site_name   TEXT,
    start_year  TEXT,
    end_year    TEXT,
    lat         TEXT,
    lon         TEXT,
    source      TEXT,
    state       TEXT,
    height_m    TEXT,
    bar_ht_m    TEXT,
    wmo         TEXT,
    is_active   TEXT
);

-- psql command: the CSV must be in the same folder from which psql is run.
\copy bombastic.stations_import ( station_id,site, dist, site_name, start_year, end_year, lat, lon, source, state, height_m, bar_ht_m, wmo, is_active) FROM 'cleaned_stations.csv' WITH (FORMAT csv, HEADER true, NULL '', ENCODING 'UTF8');

-- Keep only real station rows. The supplied CSV contains three non-station
-- footer rows with an empty site value; these are retained in the staging table
-- for validation but are not inserted into the final table.
INSERT INTO bombastic.stations (
    station_id,
    site,
    dist,
    site_name,
    start_year,
    end_year,
    latitude,
    longitude,
    location_source,
    state,
    height_m,
    barometer_height_m,
    wmo,
    is_active
)
SELECT
    LPAD(BTRIM(station_id), 6, '0'),
    site::INTEGER,
    NULLIF(BTRIM(dist), '')::SMALLINT,
    BTRIM(site_name),
    start_year::SMALLINT,
    NULLIF(BTRIM(end_year), '')::SMALLINT,
    lat::DOUBLE PRECISION,
    lon::DOUBLE PRECISION,
    NULLIF(BTRIM(source), ''),
    NULLIF(BTRIM(state), ''),
    NULLIF(BTRIM(height_m), '')::NUMERIC(8, 2),
    NULLIF(BTRIM(bar_ht_m), '')::NUMERIC(8, 2),
    NULLIF(BTRIM(wmo), '')::INTEGER,
    is_active::BOOLEAN
FROM bombastic.stations_import
WHERE BTRIM(site) ~ '^[0-9]+$'
ON CONFLICT (site) DO UPDATE SET
    station_id = EXCLUDED.station_id,
    dist = EXCLUDED.dist,
    site_name = EXCLUDED.site_name,
    start_year = EXCLUDED.start_year,
    end_year = EXCLUDED.end_year,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    location_source = EXCLUDED.location_source,
    state = EXCLUDED.state,
    height_m = EXCLUDED.height_m,
    barometer_height_m = EXCLUDED.barometer_height_m,
    wmo = EXCLUDED.wmo,
    is_active = EXCLUDED.is_active;

COMMIT;

-- Validation results expected for the supplied CSV:
-- imported_rows = 19512, invalid_footer_rows = 3, valid_station_rows = 19509.
SELECT COUNT(*) AS imported_rows
FROM bombastic.stations_import;

SELECT COUNT(*) AS invalid_footer_rows
FROM bombastic.stations_import
WHERE COALESCE(BTRIM(site), '') !~ '^[0-9]+$';

SELECT COUNT(*) AS valid_station_rows
FROM bombastic.stations;

SELECT state, COUNT(*) AS station_count
FROM bombastic.stations
GROUP BY state
ORDER BY state;

SELECT site, site_name, state, latitude, longitude
FROM bombastic.stations
WHERE is_active = TRUE
ORDER BY site
LIMIT 10;
