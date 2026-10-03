# BOMbastic Data Sources

**Status:** DRAFT — awaiting sign-off
**Branch:** `contract/station-schema`
**Related:** `docs/data-contract.md` (the shape of the data once it is ours)

This document records where BOMbastic's data comes from, under what terms we use it, and
which alternatives were considered and rejected. It exists so the provenance section of
the final report can be written from a record rather than from memory, and so that
"where did this number come from" always has an answer.

---

## 1 · The source

All observational data comes from **Climate Data Online (CDO)**, the Australian Bureau of
Meteorology's public interface to its historical climate archive.

CDO *is* BOM — it is a service on `bom.gov.au`, not a third party, mirror or reseller.
This is worth stating plainly because the distinction comes up: there is no "more direct"
BOM route available to us. **BOM publishes no public REST API for historical daily
observations.** CDO's web interface, which serves a zipped CSV per station per variable,
is the intended public access path.

**Station register.** `stations_list.txt` — BOM product `IDCJMC0014`, the full register of
19,509 stations. Fixed-width text, not CSV.

**Observations.** One zipped CSV per station per variable, retrieved from
`bom.gov.au/jsp/ncc/cdio/weatherData/av` with `p_nccObsCode` selecting the variable.

---

## 2 · Why the data arrives one variable at a time

This is BOM's design, not an artefact of our scraper, and it is the reason our
observations table is narrow.

CDO is organised by **element**, each with its own product code:

| Product | Contents |
|---|---|
| `IDCJAC0009` | Daily rainfall — rainfall only |
| `IDCJAC0010` | Daily maximum temperature |
| `IDCJAC0011` | Daily minimum temperature |

BOM's own documentation is explicit that these are separate products covering single
elements. All 933 files we currently hold carry `IDCJAC0009`.

The reason is that **each element has its own period of record at a given station.**

| Station | Rainfall record | Observed days |
|---|---|---|
| Adelaide (023000) | 1839 – 2026 | 54,465 |
| Deniliquin (074128) | 1858 – 2026 | 59,493 |
| Wyndham Aero (001006) | 1951 – 2026 | 15,203 |
| Bedout Island (004100) | 2012 only | 8 |

Adelaide has measured rain since 1839. It was certainly not recording 9am humidity then.
A combined "all variables per station-day" file would be mostly empty, and — worse — would
imply a station was observing and recorded nothing on days when the instrument did not yet
exist. Each element also carries its own quality-control lineage, which is why `Quality`
is a column in the file rather than a property of the station.

This is the standard shape for climate archives generally. NOAA's GHCN-Daily, the global
reference dataset, stores `(station, date, element, value, flags)` for the same reason.

### What a file looks like

```
Product code, Bureau of Meteorology station number, Year, Month, Day,
Rainfall amount (millimetres), Period over which rainfall was measured (days), Quality
```

Three fields matter beyond the value itself, and all three are currently discarded by
`rainfall_data.py`:

- **`Quality`** — `Y` (quality-controlled), `N` (not yet), or blank (no observation).
  In station 074128: 58,400 `Y`, 1,093 `N`, 2,094 blank.
- **`Period over which rainfall was measured (days)`** — a value greater than 1 means the
  figure is a multi-day accumulation reported against the final day. 19 such rows in
  station 074128, up to six days each.
- **An empty value field** — no observation. Distinct from an observed `0.0`, of which
  station 074128 has 46,980.

See `docs/data-contract.md` §5 for how these map onto our quality states.

---

## 3 · Licence and attribution

BOM material on `bom.gov.au` is published under the Bureau's copyright notice, which
should be read and cited directly in the final report rather than paraphrased here.
**Action before submission:** confirm the current licence terms at
<http://www.bom.gov.au/other/copyright.shtml> and include the required attribution
wording in the report and in the application's about/footer.

Attribution should name the Bureau as the source of the observations and identify the
product codes used (`IDCJMC0014`, `IDCJAC0009`, and any temperature products added later),
so a reader can retrieve the same data.

---

## 4 · Automated retrieval — our position

**BOM's `robots.txt` disallows `/jsp/`**, which is the path CDO's download endpoint sits
under. There is no `Crawl-delay` directive. We should record our position on this
deliberately rather than be asked about it unprepared.

**What we do, and why we consider it reasonable:**

- The retrieval is a **one-off bounded research download**, not ongoing crawling or
  indexing. 933 files, fetched once, for a non-commercial university project.
- It is **rate-limited** to roughly five requests per second (`time.sleep(0.2)`), which is
  gentler than a human clicking through the same pages.
- Files are **cached locally** and re-used. The resume logic exists specifically so that a
  re-run does not re-request anything already held.
- We request **only the specific station-variable files we need**, chosen by a documented
  selection strategy, rather than sweeping the archive.
- The data is **publicly published for public use**; we are not circumventing
  authentication, paywalls or access controls.

**What we acknowledge:** `robots.txt` is a convention addressed to automated agents, and
this endpoint is within a disallowed path. A reviewer may reasonably raise it. If the
team prefers to avoid the question entirely, §5 sets out the alternative.

**Whoever adds the temperature scrape should keep the existing rate limiting**, and should
not increase concurrency to speed it up.

---

## 5 · Alternatives considered

### SILO — considered, not adopted

[SILO](https://www.longpaddock.qld.gov.au/silo/) is a climate database delivered by
Queensland Treasury's Climate Projections and Services team, established in 1996 as a
collaboration with BOM. It serves observational data sourced from BOM across more than
18,700 stations from 1889 to yesterday, through a **documented API**, free, under
**CC BY 4.0**.

On paper it is attractive: a sanctioned programmatic interface rather than scraping, a
clean licence, and rainfall plus maximum and minimum temperature plus humidity and solar
radiation available from one place.

**Rejected for two reasons:**

1. **Interpolation risk.** SILO offers *patched point* datasets in which gaps are filled
   by interpolation from surrounding stations. Our entire data-quality position — NFR-05,
   the quality states in the data contract, and the visualisation rules that follow from
   them — rests on never presenting a generated value as an observation. Using SILO safely
   would require carefully selecting observed-only data and verifying its data codes.
   That is achievable but it is additional risk on the one thing the project must not get
   wrong. CDO hands us observations with a quality flag and nothing else.

2. **Pre-1889 records.** SILO begins in 1889. **93 of our 219 selected stations — 42% —
   started recording before then**, reaching back to Adelaide in 1839, Scotsburn in 1856,
   and Deniliquin and Beechworth in 1858. For those stations CDO offers materially more
   history, which matters for a product whose stated purpose is exploring long-term
   trends.

Note for accuracy: SILO's 1889 floor is *not* generally shorter than CDO's coverage — for
the 126 stations in our set that begin in 1889 or later, the two are comparable. The
advantage is specific to the older half of the working set, and should be stated that way.

### Other options not pursued

- **ACORN-SAT** — BOM's homogenised temperature dataset. High quality, but adjusted for
  station moves and instrument changes, which makes it unsuitable for a product that
  shows raw observations with quality flags. Worth mentioning in the report as a known
  alternative for climate-trend work.
- **BOM registered data services** — for bulk or ongoing access. Out of scope and
  unnecessary for a one-off download of this size.

---

## 6 · Reproducibility

Anyone should be able to reconstruct our dataset from this document plus the code.
Currently they cannot, for three reasons.

### 6.1 The candidate selection was not deterministic

This was found while merging the parsers and is the more serious of the two.

Step 4 of the selection takes the five longest-running stations in each grid cell. It
ranked on `years_active` alone, with no tiebreak. **29 of the 233 populated cells have a
tie at the fifth/sixth place**, with 80 stations competing on those ties. Which of them
makes the cut is therefore decided by NumPy's sort implementation — and `sort_values`
defaults to quicksort, which is not stable and whose ordering is not guaranteed across
versions.

The consequence is not theoretical. Re-running the committed selection code against the
committed register on pandas 3.0.2 / NumPy 2.4.4 produces **17 stations that differ from
the committed `candidate_stations.csv`**. No sort variant reproduces that file exactly.
The committed candidate list cannot be regenerated by the code that generated it.

**Fix:** `stations_list.py` now sorts on `["years_active", "station_id"]`. Station id is
unique, so the order is total and the result is identical on any version.

**Cost of adopting it:** 18 of the 959 candidates change — 18 added, 18 dropped, every one
of them a tie. None of the 219 stations in `data/rainfall/selected/` is affected; all 36
sit in `others/`. 8 of the 18 additions are already downloaded, so adopting the fix costs
**10 new downloads** and leaves 18 existing files outside the candidate list.

Because that is a change to the data the project holds and not to the parser, the script
does **not** overwrite an existing candidate list. Run it to see the diff; pass
`--refresh-candidates` to accept it. The decision is the team's, and should be recorded
below when it is made.

| Decision | Status |
|---|---|
| Adopt the deterministic tiebreak and refresh the candidate list | ☐ pending team sign-off |

### 6.2 Untracked leftovers

`data/rainfall/` contains files that are not in the current candidate list, left over from
an earlier run, and there is no record of when anything was fetched.

### 6.3 No record of retrieval

`docs/data-contract.md` §6 specifies an `ingestion_runs` table to close this. Until it
exists, the following must be recorded manually in the report:

- The date the station register was downloaded, and its product code.
- The date range of the observation download.
- The candidate selection parameters in force at the time (grid size, candidates per cell,
  minimum years active).
- Counts: stations attempted, retrieved, and returning no product for the variable.

---

## 7 · Known gaps in the current retrieval

Recorded here so they are not rediscovered. Fixes belong with the pipeline, not this
document.

- **Quality and Period columns are discarded** at ingest. Cheapest to fix before any
  observation data is loaded.
- **52 candidate stations returned no rainfall product** — they are river-height gauges,
  tide gauges, radar sites, ship logs and Antarctic bases rather than rain gauges. The
  candidate ranking promotes them because it sorts on the station's opening year, and
  river gauges are among the oldest things BOM registers. The list of 52 records *which*
  stations, but not *why*, so the finding is rediscovered on every run.
- **No failure reasons are recorded.** A network error and a station that genuinely has no
  rainfall product are currently indistinguishable in the output.

---

## Sign-off

| Role | Name | Approved | Date |
|---|---|---|---|
| Station parsing and selection | Raedan | ☐ | |
| Station cleaning and typing | Rithik | ☐ | |
| Database schema and import | HW240823 | ☐ | |
| Author | Huankang Hu | ☑ | 2026-09-17 |

---

## References

- [Climate Data Online](https://www.bom.gov.au/climate/data/) — Bureau of Meteorology
- [About IDCJAC0009 — Daily Rainfall](http://www.bom.gov.au/climate/cdo/about/about-IDCJAC0009.shtml)
- [About IDCJAC0010 — Daily Temperature](https://www.bom.gov.au/climate/cdo/about/about-IDCJAC0010.shtml)
- [BOM Copyright Notice](http://www.bom.gov.au/other/copyright.shtml)
- [bom.gov.au/robots.txt](http://www.bom.gov.au/robots.txt)
- [SILO — Australian climate data](https://www.longpaddock.qld.gov.au/silo/)
- [SILO climate variables](https://www.longpaddock.qld.gov.au/silo/about/climate-variables/)
