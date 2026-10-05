BOMbastic (FIT3164_DS_14) - Week 10 team sign-off

Draft prepared 5 Oct 2026. Items marked [CONFIRM] need the team to check before it goes in the Week 10 Drive folder.

==================================================
1. The 5 RTM items we will demonstrate
==================================================

Same five as the Week 9 list and the proposal presentation: FR-01, FR-02, FR-03, FR-04, FR-05.

FR-01  Data selection and query         RTM owner: Ani       Status: working
  What it does: pick a station, variable and date range; get a table and chart. Bad input gives a clear message.
  Where: backend/api_v1.py (GET /api/v1/observations), frontend QueryControls, DataTable.
  Evidence: 120 backend tests pass (7 database tests skipped, see section 4). Invalid range returns 422 with a reason.

FR-02  Visualisations from selected data  RTM owner: Raedan    Status: working (chart added 5 Oct)
  What it does: bar chart for rainfall, line chart for temperature, with title, axis labels, units and legend. Same records as the table.
  Where: frontend TimeSeriesChart, PlotlyChart, utils/series.js.
  Evidence: 20 frontend unit tests (npm test); checked in a browser on Melbourne Olympic Park and Deniliquin data.

FR-03  Map selection                     RTM owner: Rithik    Status: working
  What it does: markers for every station with data; click selects it, highlights the pin, refreshes chart and table.
  Where: frontend StationMap, Dashboard.
  Evidence: select-to-chart took 0.58 s in a timed browser run (stand-in API, see section 4). RTM target is 2 s.

FR-04  Compare two locations             RTM owner: Jax       Status: working (added 5 Oct)
  What it does: second station picker; same variable and same dates overlaid on one chart, each station named in legend and hover; summary difference cards (mean of each, mean difference, biggest gap).
  Where: frontend CompareView, utils/analysis.js (compareStats, overlapOf).
  Evidence: unit tests; browser run Melbourne vs Perth max temperature, 5 years: 1,817 shared days, mean difference -4.99 C.

FR-05  Linear regression and analysis    RTM owner: Haotian   Status: working (added 5 Oct)
  What it does: choose two variables at one station; scatterplot of days with both readings; fitted line; optional equation and residual plot; estimate for a typed x value; plain warning that this is not a forecast or proof of cause.
  Where: frontend RegressionView, utils/analysis.js (linearRegression).
  Evidence: unit tests including a hand-worked example. Melbourne Olympic Park, 5 years, min vs max temperature: n=1,823, slope 0.953, intercept 9.299, R2 0.457. An independent numpy calculation from the raw CSVs gave identical figures.

Why we are confident these can be demonstrated on time: all five run end to end today on real BOM data. What is left is rehearsal and loading the database on the demo laptop.

==================================================
2. Remaining RTM items (state for the Week 9 / 10 list)
==================================================

FR-06  Interactive controls      Working. Hover tooltip (date, station, value, unit), zoom, pan, reset and legend toggle come from the chart library. [CONFIRM zoom/pan on the demo laptop]
FR-07  Variable switching        Partly met. Switching rainfall, max and min temperature updates unit, axis and title without a page reload. Wind and humidity are not in the database, so the RTM wording "wind speed, humidity" is not met. [CONFIRM: either descope in the RTM with a reason, or state it as a known gap]
FR-08  CSV export (Could)        Working. "Download CSV" exports exactly the records on screen with unit in the column name, quality and days covered. Missing days are empty cells, never 0.
NFR-01 Performance               Not yet evidenced on the real database. See section 4.
NFR-02 Reliability               Working. Empty, failed and invalid responses show a message and a retry button.
NFR-03 Testing coverage          Partly met. Tests exist but the RTM asks for results recorded against requirement IDs. [CONFIRM owner: Ani] Section 5 has a starting table.
NFR-04 Usability                 Not yet evidenced. Needs a short walkthrough with someone outside the team. [CONFIRM owner: Raedan]
NFR-05 Data quality handling     Working. Missing days are gaps and ticks, never zero. Multi-day totals are drawn as one wide bar over the days they cover. Not-yet-checked readings are striped or dashed.

==================================================
3. Fully integrated, live start-to-end demo plan
==================================================

Flow the system follows: BOM CSVs -> combine_csvs.py -> PostgreSQL (stations, variables, observations) -> FastAPI /api/v1 -> React dashboard.

Before the session (do on the demo laptop, once):
  1. git checkout feature; git pull
  2. python -m pip install -r requirements.txt
  3. python BOM-Scraper/combine_csvs.py rainfall   (then tmax, then tmin)
  4. psql -U postgres -c "CREATE DATABASE bombastic"
  5. psql -U postgres -d bombastic -v ON_ERROR_STOP=1 -f stations_database.sql
  6. psql ... -f rainfall_database.sql   (takes a few minutes)
  7. psql ... -v variable=tmax -f observations_database.sql, then variable=tmin
  8. cd frontend; npm install   (picks up the new chart dependency)

At the demo (two terminals):
  Terminal 1: $env:PGPASSWORD = Read-Host "Postgres password"; cd backend; uvicorn main:app --reload --port 8000
  Terminal 2: cd frontend; npm run dev
  Check first: http://localhost:8000/health returns {"status":"ok","database":"ok"}

Live script (about 3 minutes):
  FR-03  Click a marker (Melbourne Olympic Park). Pin highlights, chart and table refresh.
  FR-01 / FR-02  Switch variable rainfall -> max temperature, change period to 5 years. Point at units, axis, legend.
  NFR-05  On rainfall, show striped "not yet checked" bars and the "No reading" ticks. Say: a missing day is never drawn as zero.
  FR-04  Compare tab, pick Perth Metro, show overlay and the difference cards.
  FR-05  Relationship tab, min vs max temperature, show equation, tick residual plot, type 12 in the estimate box. Say the caveat out loud.
  FR-08  Download CSV, open it.
Fallback if the database will not start: tell the supervisor which step failed; do not hide it.

==================================================
4. Known limits we should say out loud
==================================================

- Timings above (0.58 s select to chart, 0.36 s variable switch, 1.08 s compare) were measured against a stand-in API that reads the same CSVs, not PostgreSQL. NFR-01 must be re-timed on the real database: 10 runs, record them, claim 90% under 3 s initial and 2 s update. [CONFIRM]
- The SQL import scripts were not run in the checking environment (no psql). The 7 database tests are skipped unless BOMBASTIC_TEST_DATABASE_URL is set. Run them once on a laptop with the database loaded.
- Temperature is loaded for 10 stations; rainfall for far more. Regression and compare only offer stations with the variables they need.
- Wind and humidity are not available (see FR-07).
- docs/data-contract.md is still marked DRAFT; the Raedan, Rithik and HW240823 approval boxes are unticked. [CONFIRM sign-off before the session]
- The proposal report mentions Recharts and the pitch mentions TypeScript and Plotly. The app uses Plotly (basic bundle) with plain JavaScript React. Be ready to explain.

==================================================
5. Starting table for NFR-03 (tests linked to requirement IDs)
==================================================

FR-01   valid query, invalid date range (422), unknown station (404)       backend tests/test_api_v1.py
FR-02   chart type per variable, title/axes/units                          frontend analysis.test.js, manual
FR-03   marker select, highlight                                           manual, 5 stations [CONFIRM tick]
FR-04   overlap, shared-day statistics, no shared days                     frontend analysis.test.js
FR-05   known-answer regression, too few points, constant x, pairing       frontend analysis.test.js
FR-08   CSV header, empty cell for missing, quoting                        frontend analysis.test.js
NFR-02  empty, failed, invalid responses                                   tests/test_api_v1.py, manual fault test [CONFIRM]
NFR-05  missing not zero, multi-day totals, unverified styling             tests/test_nfr05_*.py, frontend analysis.test.js
