-- BOMbastic rainfall import for PostgreSQL
--
-- Kept so the command the team already uses still works. The import itself now
-- lives in observations_database.sql, which loads any daily BOM variable
-- (rainfall, tmax, tmin) through the same checks; this file only selects
-- rainfall and its default input file.
--
-- Run from the repository root, after stations_database.sql:
--     python BOM-Scraper/combine_csvs.py rainfall
--     psql -v ON_ERROR_STOP=1 -f rainfall_database.sql
--
-- Equivalent to:
--     psql -v ON_ERROR_STOP=1 -v variable=rainfall -f observations_database.sql

\set variable rainfall
\if :{?csv}
\else
\set csv rainfall_all.csv
\endif
\ir observations_database.sql
