/**
 * RegressionView - the Relationship tab: two variables at one station (FR-05;
 * report §6.3, journey "Analyse a relationship").
 *
 * Pick X (predictor) and Y (response) from what the station records, a period
 * within the dates both were recorded, and whether readings BOM hasn't checked
 * yet take part. The API pairs the days, fits the line and returns everything
 * shown here: scatterplot, fitted line, equation, R², n, residuals and the
 * days left out with the reason. With too few paired days (under 20) or no
 * spread in X, it explains instead of drawing a misleading line.
 *
 * Which stations: the station list and the map offer only stations where two
 * variables could give at least 20 paired days (utils/regression.js
 * canRelate). If the station chosen in another tab can't, this says why in
 * one line and offers the nearest one that can.
 *
 * A response is shown only when it answers exactly this station, pair, period
 * and policy, so switching station never shows the previous station's figures
 * under the new name.
 */

import { useId, useState } from "react";
import { useRegression } from "../api/hooks";
import { overlapOf } from "../utils/compare";
import { formatDate } from "../utils/dates";
import { resolveRange } from "../utils/ranges";
import { MIN_PAIRS, equationText, nearestStation, regressionStations, resolvePair, sig, stationVariables } from "../utils/regression";
import QueryControls from "./QueryControls";
import RegressionChart from "./RegressionChart";
import RegressionTable from "./RegressionTable";

const ERROR_TITLE = {
  unreachable: "The API isn't responding",
  unavailable: "The database isn't available",
  invalid: "That request isn't valid",
  not_found: "Not found",
  server: "Something went wrong",
};

function excludedText(excluded) {
  const parts = [];
  if (excluded.no_reading) parts.push(`${excluded.no_reading.toLocaleString()} with no reading for one or both`);
  if (excluded.multi_day) parts.push(`${excluded.multi_day.toLocaleString()} with a multi-day value`);
  if (excluded.not_checked) parts.push(`${excluded.not_checked.toLocaleString()} not yet quality-checked`);
  return parts.length ? `Days left out: ${parts.join(", ")}.` : "Every day in the period was paired.";
}

function answers(data, q) {
  return Boolean(data)
    && data.query.station.station_id === q.stationId
    && data.query.x.variable_code === q.x
    && data.query.y.variable_code === q.y
    && data.query.start === q.start
    && data.query.end === q.end
    && data.query.quality_policy === q.qualityPolicy;
}

export default function RegressionView({ station, stations, variables, onSelectStation, range, onRangeChange }) {
  const id = useId();
  const offered = stationVariables(variables, station);
  const codes = offered.map((v) => v.variable_code);
  const [chosen, setChosen] = useState({ x: "tmin", y: "tmax" });
  const [checkedOnly, setCheckedOnly] = useState(false);
  const { x, y } = resolvePair(chosen, codes);

  const availX = station.variables.find((v) => v.variable_code === x);
  const availY = station.variables.find((v) => v.variable_code === y);
  const overlap = x && y ? overlapOf(availX, availY) : null;
  const resolved = overlap ? resolveRange(range, overlap) : {};
  const query = { stationId: station.station_id, x, y, start: resolved.start, end: resolved.end, qualityPolicy: checkedOnly ? "checked" : "all" };
  const result = useRegression(overlap ? query : {});
  const data = answers(result.data, query) ? result.data : null;

  if (codes.length < 2) {
    const near = nearestStation(station, regressionStations(stations));
    const only = station.variables.length === 1
      ? `It records only ${variables.find((v) => v.variable_code === station.variables[0].variable_code)?.label.toLowerCase() ?? "one variable"}.`
      : `No two of its variables overlap for at least ${MIN_PAIRS} days.`;
    return (
      <div className="chart-frame chart-message" role="status">
        <p className="chart-message-title">No relationship can be fitted at {station.name}</p>
        <p>
          {only} {near ? "Choose a station from the list above, or a solid pin on the map." : "No station in the database has two variables yet."}
        </p>
        {near && (
          <button type="button" onClick={() => onSelectStation(near.station.station_id)}>
            Use the nearest: {near.station.name} ({near.station.state}), {Math.round(near.km).toLocaleString()} km away
          </button>
        )}
      </div>
    );
  }

  const option = (v) => <option key={v.variable_code} value={v.variable_code}>{v.label} ({v.unit})</option>;
  const xVar = offered.find((v) => v.variable_code === x);
  const yVar = offered.find((v) => v.variable_code === y);

  return (
    <>
      <QueryControls
        station={station}
        variables={variables}
        variable={x}
        range={range}
        resolved={resolved}
        available={overlap ?? {}}
        onRangeChange={onRangeChange}
        note={overlap ? `Both recorded ${formatDate(overlap.first_date)} – ${formatDate(overlap.last_date)}` : "These two were never recorded over the same dates"}
      >
        <div className="control">
          <label htmlFor={`${id}-x`}>X</label>
          <select id={`${id}-x`} value={x} onChange={(e) => setChosen({ x: e.target.value, y: e.target.value === y ? x : y })}>
            {offered.map(option)}
          </select>
          <button type="button" onClick={() => setChosen({ x: y, y: x })} aria-label="Swap X and Y">⇄</button>
          <label htmlFor={`${id}-y`}>Y</label>
          <select id={`${id}-y`} value={y} onChange={(e) => setChosen({ x: e.target.value === x ? y : x, y: e.target.value })}>
            {offered.map(option)}
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={checkedOnly} onChange={(e) => setCheckedOnly(e.target.checked)} />
          Only quality-checked readings
        </label>
      </QueryControls>

      {result.error && !result.loading ? (
        <div className="chart-frame chart-message" role="alert">
          <p className="chart-message-title">{ERROR_TITLE[result.error.kind] ?? ERROR_TITLE.server}</p>
          <p>{result.error.message}</p>
          <button type="button" onClick={result.retry}>Try again</button>
        </div>
      ) : !overlap ? (
        <div className="chart-frame chart-message" role="status">
          <p className="chart-message-title">No dates in common</p>
          <p>{station.name} never recorded {xVar.label.toLowerCase()} and {yVar.label.toLowerCase()} over the same period.</p>
        </div>
      ) : !data ? (
        <div className="chart-frame chart-message" aria-busy="true"><p>Fitting…</p></div>
      ) : data.status !== "ok" ? (
        <div className="chart-frame chart-message" role="status">
          <p className="chart-message-title">{data.status === "insufficient" ? "No line is shown" : "No data"}</p>
          <p>{data.message}</p>
          <p className="control-note">{excludedText(data.excluded)}</p>
        </div>
      ) : (
        <>
          <figure className="chart-frame">
            <figcaption className="chart-title">
              {yVar.label} against {xVar.label.toLowerCase()} · {station.name}
            </figcaption>
            <RegressionChart data={data} />
          </figure>
          <section className="quality-summary" aria-label="Regression results">
            <p className="regression-equation">{equationText(data.model, xVar, yVar)}</p>
            <dl className="stat-row">
              <div className="stat"><dt>Slope</dt><dd>{sig(data.model.slope)}</dd><p className="stat-note">{yVar.unit} of Y per {xVar.unit} of X</p></div>
              <div className="stat"><dt>Intercept</dt><dd>{sig(data.model.intercept)} {yVar.unit}</dd><p className="stat-note">Y where X is 0</p></div>
              <div className="stat"><dt>R²</dt><dd>{data.model.r_squared === null ? "—" : data.model.r_squared.toFixed(3)}</dd><p className="stat-note">share of Y&apos;s variation the line accounts for</p></div>
              <div className="stat"><dt>Days used (n)</dt><dd>{data.model.n.toLocaleString()}</dd><p className="stat-note">of {data.days_in_range.toLocaleString()} in the period; at least {data.query.min_pairs} needed</p></div>
            </dl>
            <p className="control-note">{excludedText(data.excluded)} {data.warnings.join(" ")}</p>
          </section>
          <RegressionTable data={data} />
        </>
      )}

      <p className="caveat" role="note">
        This describes how the two moved together at this station in past BOM data. It is not a forecast,
        and it does not show that one causes the other.
      </p>
    </>
  );
}
