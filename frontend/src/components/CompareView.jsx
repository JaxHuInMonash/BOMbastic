/**
 * CompareView - two stations, same variable, same dates (FR-04).
 *
 * The variable picker offers only what both stations record; the period is
 * resolved against the dates both recorded, so the two series always share one
 * unit and one time scale. Under the chart: difference indicators and a table
 * of both stations' daily values side by side (DR-05).
 *
 * Both responses must answer exactly these stations, variable and dates before
 * anything is drawn; until then the frame says it is loading. A late answer for
 * a previous B can never be drawn under the new B's name.
 */

import { useMemo } from "react";
import { useObservations } from "../api/hooks";
import { compareTemperature, compareVariable, overlapOf, rainDays, sharedVariables } from "../utils/compare";
import { formatDate } from "../utils/dates";
import { classifyDays } from "../utils/rainfall";
import { resolveRange } from "../utils/ranges";
import CompareRainfallChart from "./CompareRainfallChart";
import CompareTable from "./CompareTable";
import CompareTemperatureChart from "./CompareTemperatureChart";
import QueryControls from "./QueryControls";

const ERROR_TITLE = {
  unreachable: "The API isn't responding",
  unavailable: "The database isn't available",
  invalid: "That request isn't valid",
  not_found: "Not found",
  server: "Something went wrong",
};

const signed = (v, unit) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`;

/** The pair of responses, if both answer exactly this query; otherwise null. */
function answering(a, b, query) {
  const ok = (r, stationId) => r.data?.status === "ok"
    && r.data.query.station.station_id === stationId
    && r.data.query.variable.variable_code === query.variable
    && r.data.query.start === query.start
    && r.data.query.end === query.end;
  return ok(a, query.a) && ok(b, query.b) ? { a: a.data, b: b.data } : null;
}

const classify = (data) => (data?.status === "ok" ? classifyDays(data.records, data.query.start, data.query.end) : null);

function Indicators({ pair, daysA, daysB }) {
  const { a, b } = pair;
  const unit = a.query.variable.unit;
  const nameA = a.query.station.name;
  const nameB = b.query.station.name;

  if (a.query.variable.semantic_type === "accumulation") {
    const totalA = a.summary.aggregate_value;
    const totalB = b.summary.aggregate_value;
    return (
      <dl className="stat-row compare-stats">
        <div className="stat stat--a"><dt>A · {nameA}</dt><dd>{totalA === null ? "—" : `${totalA.toLocaleString()} ${unit}`}</dd><p className="stat-note">{totalA === null ? a.summary.aggregate_withheld_reason : "total"}</p></div>
        <div className="stat stat--b"><dt>B · {nameB}</dt><dd>{totalB === null ? "—" : `${totalB.toLocaleString()} ${unit}`}</dd><p className="stat-note">{totalB === null ? b.summary.aggregate_withheld_reason : "total"}</p></div>
        <div className="stat"><dt>A − B</dt><dd>{totalA === null || totalB === null ? "—" : signed(Math.round((totalA - totalB) * 10) / 10, unit)}</dd><p className="stat-note">{totalA === null || totalB === null ? "needs both totals" : "difference in totals"}</p></div>
        <div className="stat"><dt>Rain days (1 mm or more)</dt><dd>A {rainDays(daysA)} · B {rainDays(daysB)}</dd><p className="stat-note">days with a single-day reading</p></div>
      </dl>
    );
  }

  const s = compareTemperature(daysA, daysB);
  if (!s) return <p className="empty-hint">The two stations have no single-day readings on the same dates in this period, so they can&apos;t be compared day by day.</p>;
  return (
    <>
      <dl className="stat-row compare-stats">
        <div className="stat stat--a"><dt>A · {nameA}</dt><dd>{s.meanA.toFixed(1)} {unit}</dd><p className="stat-note">mean on shared days</p></div>
        <div className="stat stat--b"><dt>B · {nameB}</dt><dd>{s.meanB.toFixed(1)} {unit}</dd><p className="stat-note">mean on shared days</p></div>
        <div className="stat"><dt>A − B on average</dt><dd>{signed(s.meanDifference, unit)}</dd><p className="stat-note">A higher on {s.aHigher.toLocaleString()} days, B on {s.bHigher.toLocaleString()}</p></div>
        <div className="stat"><dt>Largest difference</dt><dd>{signed(s.largest.difference, unit)}</dd><p className="stat-note">{formatDate(s.largest.date)}: A {s.largest.a}, B {s.largest.b}</p></div>
      </dl>
      <p className="control-note">Based on the {s.days.toLocaleString()} days both stations have a single-day reading; days with no reading or a multi-day value at either station are left out.</p>
    </>
  );
}

export default function CompareView({ stationA, stationB, variables, chosenVariable, onVariableChange, range, onRangeChange }) {
  const shared = useMemo(() => (stationB ? sharedVariables(variables, stationA, stationB) : []), [variables, stationA, stationB]);
  const variable = compareVariable(shared, chosenVariable);
  const availA = stationA.variables.find((v) => v.variable_code === variable);
  const availB = stationB?.variables.find((v) => v.variable_code === variable);
  const overlap = overlapOf(availA, availB);
  const resolved = overlap ? resolveRange(range, overlap) : {};
  const query = { a: stationA.station_id, b: stationB?.station_id, variable, start: resolved.start, end: resolved.end };

  const ra = useObservations({ stationId: overlap ? query.a : null, variable, start: query.start, end: query.end });
  const rb = useObservations({ stationId: overlap ? query.b : null, variable, start: query.start, end: query.end });
  const pair = answering(ra, rb, query);
  const loading = ra.loading || rb.loading;
  const error = ra.error ?? rb.error;

  const classifiedA = useMemo(() => classify(ra.data), [ra.data]);
  const classifiedB = useMemo(() => classify(rb.data), [rb.data]);
  const days = pair ? { a: classifiedA, b: classifiedB } : null;

  if (!stationB) {
    return (
      <p className="empty-hint">
        Click another pin on the map, or choose B from the list above, to compare it with {stationA.name}.
      </p>
    );
  }

  return (
    <>
      <QueryControls
        station={{ variables: shared }}
        variables={shared}
        variable={variable}
        onVariableChange={onVariableChange}
        range={range}
        resolved={resolved}
        available={overlap ?? {}}
        onRangeChange={onRangeChange}
        note={overlap ? `Both recorded ${formatDate(overlap.first_date)} – ${formatDate(overlap.last_date)}` : "Never recorded over the same dates"}
      />

      {error ? (
        <div className="chart-frame chart-message" role="alert">
          <p className="chart-message-title">{ERROR_TITLE[error.kind] ?? ERROR_TITLE.server}</p>
          <p>{error.message}</p>
          <button type="button" onClick={() => { ra.retry(); rb.retry(); }}>Try again</button>
        </div>
      ) : !overlap ? (
        <div className="chart-frame chart-message" role="status">
          <p className="chart-message-title">No dates in common</p>
          <p>{stationA.name} and {stationB.name} never recorded this variable over the same period, so they can&apos;t be compared. Try another variable or station.</p>
        </div>
      ) : !pair || !days ? (
        <div className="chart-frame chart-message" aria-busy={loading}><p>{loading ? "Loading both stations…" : ""}</p></div>
      ) : (
        <>
          <figure className={`chart-frame${loading ? " is-refreshing" : ""}`} aria-busy={loading}>
            <figcaption className="chart-title">
              {pair.a.query.variable.label} ({pair.a.query.variable.unit}) · <span className="key-a">A</span> {pair.a.query.station.name} vs <span className="key-b">B</span> {pair.b.query.station.name}
            </figcaption>
            {pair.a.query.variable.semantic_type === "accumulation"
              ? <CompareRainfallChart a={pair.a} b={pair.b} daysA={days.a} daysB={days.b} />
              : <CompareTemperatureChart a={pair.a} b={pair.b} daysA={days.a} daysB={days.b} />}
          </figure>
          <section className="quality-summary" aria-label="Difference between the two stations">
            <Indicators pair={pair} daysA={days.a} daysB={days.b} />
          </section>
          <CompareTable pair={pair} daysA={days.a} daysB={days.b} />
        </>
      )}
    </>
  );
}
