# BOMbastic Data Contract

**Status:** DRAFT — awaiting sign-off
**Branch:** `contract/station-schema`
**Supersedes:** the ad-hoc conventions in `stations_list.py`, `clean_bom_stations.py` and `stations_database.sql`
**Related:** `docs/data-sources.md` (where the data comes from and under what licence)

---

## Why this document exists

Between 5 and 25 August, two people independently wrote two parsers for the same BOM
station file, with incompatible conventions for types, column names and missing values.
Neither author knew the other was doing it. On 1 September a PostgreSQL schema was written
against one of them while the pipeline ran on the other.

That is not a failure of either implementation — both are defensible. It is a failure to
write down what a station record *is* before two people started producing one. This
document is that missing agreement.

Once signed off, this file is the single source of truth for the shape of our data. Code
follows this document; if the code and this document disagree, the code is wrong.

---

## Scope

**In scope.** The structure, types and semantics of station metadata and daily weather
observations, from the cleaned CSV through to the PostgreSQL tables the API reads.

**Out of scope.** Station *selection* strategy (the 2° grid, candidate ranking,
coverage thresholds) — that is a separate concern documented alongside the pipeline.
API response shapes, which are derived from this contract but specified separately.

---

## Principles

1. **Parse once, use twice.** One function turns the BOM register into a typed table.
   Selection, export and database loading all consume that one output. No module
   re-parses the source file.

2. **Missing means missing.** Absence is represented by SQL `NULL` and by an empty CSV
   field. Never by `"N/A"`, `"Present"`, `".."`, `"-"` or any other string. See
   *The sentinel ban* below for why this is non-negotiable.

3. **Observed zero is not missing.** `0.0` mm of rain is a measurement. A day with no
   reading is not. These must remain distinguishable at every layer, including in the
   database, the API payload, the chart and the CSV export.

4. **Quality travels with the value.** BOM tells us whether each observation passed
   quality control. That flag is carried through to the user interface, not dropped at
   ingest.

5. **One row per fact.** Observations are stored narrow — one row per
   station × date × variable — because that is the shape BOM publishes and the shape that
   lets us add a variable without a migration.

---

## 1 · Station identity

**The primary key is `station_id`: the BOM site number as a six-character, zero-padded
string.** Not an integer.

```
001006   ✓   the form BOM uses in filenames, URLs and its own products
  1006   ✗   the leading zeros are data, not formatting
```

This is settled by evidence, not preference. Every rainfall file on disk is named
`{station_id}.csv`; the CDO download URL takes the padded form; and all 19,509 rows of
`stations_list.csv` carry a six-character `STN`. An integer key forces every join back to
the file layer through `LPAD(site::text, 6, '0')`, and one forgotten `LPAD` is a silent
wrong answer.

> Historical note, so this is not relitigated: `clean_bom_stations.py` originally cast the
> site number to `Int64` and lost the padding; commit `9f5a3e7` restored it as a separate
> `station_id` column. `stations_list.py` never lost it, because it reads with
> `dtype=str`. The contract adopts the string form for both.

---

## 2 · `stations`

One row per station in the BOM register. 19,509 rows at time of writing.

| Column | Type | Null | Source | Notes |
|---|---|---|---|---|
| `station_id` | `CHAR(6)` | no | `STN` / `site` | **Primary key.** `CHECK (station_id ~ '^[0-9]{6}$')` |
| `name` | `VARCHAR(60)` | no | `Name` / `site_name` | Longest observed is 40 chars; 60 gives headroom. Internal whitespace collapsed to single spaces. |
| `district` | `VARCHAR(4)` | yes | `Dist` | **Text, not a number.** 1,895 values have a leading zero; observed lengths are 0–4. |
| `state` | `VARCHAR(3)` | yes | `State` | `CHECK` in `('WA','NT','SA','QLD','NSW','VIC','TAS','ANT','ISL')`. `ISL` is real — two stations use it. |
| `latitude` | `DOUBLE PRECISION` | no | `Lat` | `CHECK BETWEEN -90 AND 90` |
| `longitude` | `DOUBLE PRECISION` | no | `Lon` | `CHECK BETWEEN -180 AND 180` |
| `start_year` | `SMALLINT` | no | `Start` | Earliest observed 1799. |
| `end_year` | `SMALLINT` | yes | `End` | **`NULL` means still operating.** Never the string `Present`. `CHECK (end_year IS NULL OR end_year >= start_year)` |
| `is_active` | `BOOLEAN` | no | derived | `GENERATED ALWAYS AS (end_year IS NULL) STORED`. Generated, not stored independently, so the two can never disagree. |
| `elevation_m` | `NUMERIC(8,2)` | yes | `Height (m)` | |
| `barometer_elevation_m` | `NUMERIC(8,2)` | yes | `Bar_ht` | |
| `wmo_id` | `INTEGER` | yes | `WMO` | `UNIQUE`. 1,020 non-null values, all distinct. |
| `location_source` | `VARCHAR(20)` | yes | `Source` | How the coordinates were determined, e.g. `GPS`, `MAP 1:250 000`. **Contains spaces** — 359 rows. |
| `ingested_at` | `TIMESTAMPTZ` | no | pipeline | Defaults to `now()`. |

**Indexes:** `state`, `is_active`, `LOWER(name)`.

**Deliberately not stored:** a separate integer site number. Anything needing one can
compute `station_id::INTEGER`.

---

## 3 · `variables`

The catalogue of what we measure. Small, hand-maintained, and read by the front end to
decide units and chart types — so FR-02 and FR-07 never hardcode either.

| Column | Type | Notes |
|---|---|---|
| `variable_code` | `TEXT` | **Primary key.** Our name, not BOM's. |
| `label` | `TEXT` | Shown to users. |
| `unit` | `TEXT` | Shown on every axis, tooltip and export row. |
| `semantic_type` | `TEXT` | `accumulation` \| `instantaneous` \| `extreme`. Drives chart choice. |
| `default_chart` | `TEXT` | `bar` \| `line` \| `scatter`. |
| `interpolation_allowed` | `BOOLEAN` | Rainfall is **always** `false`. |
| `bom_product_code` | `TEXT` | e.g. `IDCJAC0009`. Provenance. |
| `bom_obs_code` | `TEXT` | The CDO `p_nccObsCode` used to fetch it. |

**Seed rows:**

| code | label | unit | semantic_type | default_chart | interp | product |
|---|---|---|---|---|---|---|
| `rainfall` | Rainfall | mm | accumulation | bar | false | IDCJAC0009 |
| `tmax` | Maximum temperature | °C | extreme | line | *TBD* | IDCJAC0010 |
| `tmin` | Minimum temperature | °C | extreme | line | *TBD* | IDCJAC0011 |

> `bom_obs_code` for temperature must be read off the CDO URL when the scrape is set up —
> do not copy a number from a blog post. Confirm on the first download whether maximum and
> minimum arrive in one file or two; that decides whether one fetch yields one
> `variable_code` or two.

---

## 4 · `observations`

One row per station × date × variable. Narrow, not wide.

| Column | Type | Null | Notes |
|---|---|---|---|
| `station_id` | `CHAR(6)` | no | FK → `stations` |
| `observed_date` | `DATE` | no | ISO 8601. Built from BOM's separate `Year`/`Month`/`Day`. |
| `variable_code` | `TEXT` | no | FK → `variables` |
| `value` | `NUMERIC(8,2)` | **yes** | `NULL` **if and only if** `quality_state = 'missing'`. |
| `quality_state` | `TEXT` | no | See §5. |
| `accumulation_days` | `SMALLINT` | yes | BOM's *period over which rainfall was measured*. `NULL` or `1` = a single day. |
| `source_product` | `TEXT` | no | e.g. `IDCJAC0009`. |
| `ingestion_run_id` | `BIGINT` | no | FK → `ingestion_runs` |

**Primary key:** `(station_id, observed_date, variable_code)` — this is what makes
re-ingestion idempotent (DR-02).
**Query index:** `(station_id, variable_code, observed_date)`.

### Why narrow rather than wide

The alternative — one row per station-day with `rainfall_mm`, `max_temp_c`,
`min_temp_c`, … as columns — was in the 1 September draft schema. Rejected, for four
reasons:

1. **It is not the shape of the source.** Each BOM file is already one
   (station, variable) pair with one row per date. Narrow requires no pivot; wide does.
2. **`NULL` becomes ambiguous.** In a wide table, `rainfall_mm IS NULL` means both "the
   gauge failed that day" and "this station has never measured rainfall". Those are
   different facts and NFR-05 requires telling them apart.
3. **There is nowhere to put the quality flag.** One `quality_state` per row works only
   when a row is one measurement. Wide would need five quality columns and five
   accumulation columns.
4. **Record periods are ragged.** Adelaide has rainfall from 1839; its temperature record
   starts much later. A wide table asserts a row exists for a station-day when only one
   instrument was present.

Adding a sixth variable to a narrow table is an `INSERT` into `variables`. To a wide
table it is a migration.

---

## 5 · Quality states

BOM ships the quality information. We keep it.

| `quality_state` | Meaning | BOM source | `value` |
|---|---|---|---|
| `observed` | Measured and quality-controlled | `Quality = 'Y'`, value present | the measurement |
| `unverified` | Measured, not yet quality-controlled | `Quality = 'N'`, value present | the measurement |
| `interpolated` | Generated by an approved rule, not measured | never from BOM | the generated value |
| `missing` | No usable measurement for a date we expect one | value field empty | `NULL` |

A fifth outcome, **`invalid_excluded`**, is not a row. Rows that fail validation at ingest
(unparseable date, impossible value, unknown station) are counted in `ingestion_runs` and
not inserted. They must never be silently dropped without a count.

> This refines rather than contradicts the four states in §6.2 of the requirements report.
> That document's single `observed` is split into `observed` and `unverified`, because BOM
> distinguishes them and collapsing the two throws away information we are given for free.
> In station 074128 alone that is 58,400 `Y` against 1,093 `N`.

### `accumulation_days` is orthogonal

A multi-day total can still be quality-controlled, so accumulation is **not** a quality
state — it is a separate column. The rule that matters:

> **A row with `accumulation_days > 1` must never be rendered as a single day's value.**
> It is a total spanning several days reported against the last of them. In station 074128
> there are 19 such rows, up to six days each.

Presentation options are the chart owner's call — omit, distinguish visually, or
distribute across the period with an explicit label — but silently plotting it as one
day's rain is wrong.

### Observed zero

`0.0` with `quality_state = 'observed'` is a measurement and renders as zero. Station
074128 contains **46,980 observed zeroes against 2,094 missing days**. If those ever
become indistinguishable, something in the chain is broken.

---

## 6 · `ingestion_runs`

Every pipeline run writes one row. This is what makes a load auditable and reproducible,
and it is the evidence DR-02 and DR-07 ask for.

| Column | Type | Notes |
|---|---|---|
| `run_id` | `BIGINT` | Identity, primary key |
| `started_at` / `completed_at` | `TIMESTAMPTZ` | |
| `source` | `TEXT` | e.g. `BOM CDO` |
| `variable_code` | `TEXT` | Which variable this run fetched |
| `status` | `TEXT` | `success` \| `partial` \| `failed` |
| `stations_attempted` | `INTEGER` | |
| `stations_loaded` | `INTEGER` | |
| `stations_no_product` | `INTEGER` | Station exists but does not measure this variable |
| `rows_read` | `INTEGER` | |
| `rows_loaded` | `INTEGER` | |
| `rows_rejected` | `INTEGER` | The `invalid_excluded` count |
| `notes` | `TEXT` | |

The current `no_rainfall_data.txt` (52 stations) and `empty_bins.csv` (14 cells) are early
versions of this idea and should fold into it — with a *reason* per station, not just an ID.

---

## 7 · The sentinel ban

**No module writes `"N/A"`, `"Present"`, `".."`, `"....."`, `"-"` or `"Unknown"` into any
CSV column or database field.** Missing is an empty CSV field and a SQL `NULL`.

This is stricter than it may look, and it is because of a concrete failure mode. The
current `stations_list.csv` contains:

| Column | Sentinel | Rows |
|---|---|---|
| `End` | `Present` | 6,316 |
| `Bar_ht` | `N/A` | 18,555 |
| `WMO` | `..` | 18,489 |
| `Height (m)` | `N/A` | 4,256 |

Each one fails a typed SQL cast. Worse: `N/A` is in pandas' default NA list, so reading
that file back with `pd.read_csv` turns it into `NaN`, while reading it with
`keep_default_na=False` leaves it a string. **The same file means two different things
depending on the reader's options.** That is not a bug we can test our way out of; the
only fix is not to write the sentinel.

BOM's own markers (`..`, `.....`) are recognised on **input** and converted to `NULL`
immediately. They never survive into anything we write.

---

## 8 · Derived values

Any value we compute rather than observe — a monthly mean, an anomaly, a running total,
a percentile — must:

1. **Declare its input coverage.** How many of the expected observations contributed.
2. **Be suppressed below a configured coverage threshold** rather than displayed with
   unknown confidence.
3. **Never be presented with the same visual weight as an observation.**

This exists because the quality-state model above covers observations only, and four of
the six proposed chart forms produce derived values. A monthly mean computed from nine
days is not a monthly mean.

---

## 9 · Decisions still required at sign-off

| # | Decision | Owner | Blocks |
|---|---|---|---|
| D-A | Minimum coverage threshold for a derived value to display. *Proposed: 90% of expected days.* | Data + analytics | Anomaly and cumulative charts |
| D-B | Is interpolation ever enabled, and for which variables? *Proposed: off by default; never for rainfall.* | Data + testing | `variables.interpolation_allowed` |
| D-C | Climatological baseline period. *Proposed: 1991–2020.* | Analytics | Anomaly chart |
| D-D | How `accumulation_days > 1` is presented. | Charts | Rainfall rendering |
| D-E | Do we keep an integer site number alongside `station_id`? *Proposed: no.* | Database | Schema finalisation |
| D-F | Minimum coverage floor for station *selection* (separate from D-A). | Data | Candidate ranking |

---

## Sign-off

This contract takes effect when all three data-layer owners have approved it. Approval
means: you have read it, you agree the code you own will conform, and you will raise a
change here rather than diverging in code.

| Role | Name | Approved | Date |
|---|---|---|---|
| Station parsing and selection | Raedan | ☐ | |
| Station cleaning and typing | Rithik | ☐ | |
| Database schema and import | HW240823 | ☐ | |
| Author | Huankang Hu | ☑ | 2026-09-17 |

**Changes after sign-off** are made by pull request against this file, reviewed by at
least one other data-layer owner. The version merged to `feature` is authoritative.
