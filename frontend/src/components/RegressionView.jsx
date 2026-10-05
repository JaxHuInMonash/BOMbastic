/**
 * RegressionView - FR-05 (linear regression and analysis).
 *
 * Pick two variables recorded at this station. Days where both have a single-day
 * reading become a scatterplot; an ordinary least squares line is fitted, with
 * optional equation and residual plot. A missing day or multi-day total is never
 * paired, so it can't pull the line.
 *
 * Regression here describes a relationship in past data. It is not a forecast
 * and it does not show cause (risk R-05), and the panel says so.
 */

import { useId, useMemo, useState } from "react";
import { useObservations } from "../api/hooks";
import { seriesColor } from "../utils/chartTheme";
import { equationText, linearRegression, overlapOf, pairByDate, predictY } from "../utils/analysis";
import { formatDate } from "../utils/dates";
import { resolveRange } from "../utils/ranges";
import { useColorScheme } from "../utils/useColorScheme";
import PlotlyChart from "./PlotlyChart";
import QueryControls from "./QueryControls";

/** The scatterplot, line and optional equation. A child component so traces are memoised on plain props. */
function ScatterChart({ paired, model, xName, xUnit, yName, yUnit, showEquation, colorA, colorB, colorGrid, colorAxis, colorFit, ariaLabel }) {
  const traces = useMemo(() => {
    const points = {
      type: "scatter", mode: "markers", name: "Days with both readings",
      x: paired.pairs.map((p) => p.x), y: paired.pairs.map((p) => p.y),
      text: paired.pairs.map((p) => `${p.date}<br>${xName}: ${p.x} ${xUnit}<br>${yName}: ${p.y} ${yUnit}`),
      hoverinfo: "text", marker: { color: colorA, size: 5, opacity: 0.45 },
    };
    const line = {
      type: "scatter", mode: "lines", name: "Regression line",
      x: [model.xMin, model.xMax], y: [predictY(model, model.xMin), predictY(model, model.xMax)],
      hoverinfo: "skip", line: { color: colorB, width: 2.5 },
    };
    return [points, line];
  }, [paired, model, xName, xUnit, yName, yUnit, colorA, colorB]);

  const layout = useMemo(
    () => ({
      legend: { orientation: "h", y: -0.3 },
      xaxis: { title: { text: `${xName} (${xUnit})` }, zeroline: false },
      yaxis: { title: { text: `${yName} (${yUnit})` }, zeroline: false },
      annotations: showEquation ? [{
        xref: "paper", yref: "paper", x: 0.02, y: 0.98, xanchor: "left", yanchor: "top", showarrow: false, align: "left",
        text: `${equationText(model, xName, yName)}<br>R² = ${model.r2.toFixed(3)}  ·  n = ${model.n.toLocaleString()}`,
        bgcolor: colorGrid, bordercolor: colorAxis, borderpad: 6, font: { color: colorFit, size: 12 },
      }] : [],
    }),
    [xName, xUnit, yName, yUnit, showEquation, model, colorGrid, colorAxis, colorFit],
  );
  return <PlotlyChart traces={traces} layout={layout} ariaLabel={ariaLabel} />;
}

/** Residual against fitted value: what the line gets wrong, day by day. */
function ResidualChart({ paired, model, yName, yUnit, colorA, colorMuted, ariaLabel }) {
  const traces = useMemo(
    () => [{
      type: "scatter", mode: "markers", name: "Residual", x: model.fitted, y: model.residuals,
      text: paired.pairs.map((p, i) => `${p.date}<br>Fitted: ${num(model.fitted[i])} ${yUnit}<br>Residual: ${num(model.residuals[i])} ${yUnit}`),
      hoverinfo: "text", marker: { color: colorA, size: 5, opacity: 0.45 },
    }],
    [paired, model, yUnit, colorA],
  );
  const layout = useMemo(
    () => ({
      xaxis: { title: { text: `Fitted ${yName.toLowerCase()} (${yUnit})` }, zeroline: false },
      yaxis: { title: { text: `Residual (${yUnit})` }, zeroline: true },
      shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: 0, y1: 0, line: { color: colorMuted, width: 1, dash: "dot" } }],
    }),
    [yName, yUnit, colorMuted],
  );
  return <PlotlyChart traces={traces} layout={layout} height={280} ariaLabel={ariaLabel} />;
}

const num = (v) => Number(v.toPrecision(4)).toLocaleString();

export default function RegressionView({ station, variables, range, onRangeChange }) {
  const id = useId();
  const scheme = useColorScheme();
  const colorA = seriesColor(scheme, "a");
  const colorB = seriesColor(scheme, "b");
  const colorGrid = seriesColor(scheme, "grid");
  const colorAxis = seriesColor(scheme, "axis");
  const colorFit = seriesColor(scheme, "fit");
  const colorMuted = seriesColor(scheme, "muted");

  const offered = variables.filter((v) => station.variables.some((sv) => sv.variable_code === v.variable_code));
  const codes = offered.map((v) => v.variable_code);
  const defaultX = codes.includes("tmin") ? "tmin" : codes[0];
  const defaultY = codes.includes("tmax") ? "tmax" : codes.find((c) => c !== defaultX);
  const [chosen, setChosen] = useState({ x: defaultX, y: defaultY });
  const [showEquation, setShowEquation] = useState(true);
  const [showResiduals, setShowResiduals] = useState(false);
  const [predictAt, setPredictAt] = useState("");

  // A station can change under us; fall back to something it records.
  const xCode = codes.includes(chosen.x) ? chosen.x : defaultX;
  const yCode = codes.includes(chosen.y) && chosen.y !== xCode ? chosen.y : codes.find((c) => c !== xCode);
  const xVar = offered.find((v) => v.variable_code === xCode);
  const yVar = offered.find((v) => v.variable_code === yCode);

  const availX = station.variables.find((v) => v.variable_code === xCode);
  const availY = station.variables.find((v) => v.variable_code === yCode);
  const overlap = xVar && yVar ? overlapOf(availX, availY) : null;
  const resolved = overlap ? resolveRange(range, overlap) : {};

  const xr = useObservations({ stationId: station.station_id, variable: overlap ? xCode : null, start: resolved.start, end: resolved.end });
  const yr = useObservations({ stationId: station.station_id, variable: overlap ? yCode : null, start: resolved.start, end: resolved.end });
  const ready = Boolean(xr.data && yr.data) && xr.data.query.variable.variable_code === xCode && yr.data.query.variable.variable_code === yCode
    && xr.data.query.start === resolved.start && xr.data.query.end === resolved.end
    && yr.data.query.start === resolved.start && yr.data.query.end === resolved.end;

  const recordsX = ready ? xr.data.records : null;
  const recordsY = ready ? yr.data.records : null;
  const paired = useMemo(() => (recordsX && recordsY ? pairByDate(recordsX, recordsY) : null), [recordsX, recordsY]);
  const model = useMemo(
    () => (paired ? linearRegression(paired.pairs.map((p) => p.x), paired.pairs.map((p) => p.y)) : null),
    [paired],
  );

  const xName = xVar?.label ?? "";
  const xUnit = xVar?.unit ?? "";
  const yName = yVar?.label ?? "";
  const yUnit = yVar?.unit ?? "";
  const xLabel = xVar ? `${xName} (${xUnit})` : "";
  const yLabel = yVar ? `${yName} (${yUnit})` : "";
  const fitOk = model && !model.error;

  const asNumber = predictAt.trim() === "" ? null : Number(predictAt);
  const prediction = fitOk && asNumber !== null && Number.isFinite(asNumber) ? predictY(model, asNumber) : null;
  const outside = prediction !== null && (asNumber < model.xMin || asNumber > model.xMax);
  const error = xr.error ?? yr.error;

  if (offered.length < 2) {
    return <p className="empty-hint">{station.name} records only one variable, so there is nothing to compare it with. Pick a station that records temperature as well as rainfall.</p>;
  }

  return (
    <div className="regression-view">
      <div className="query-controls" role="group" aria-label="Regression variables">
        <div className="control">
          <label htmlFor={`${id}-x`}>X (predictor)</label>
          <select id={`${id}-x`} value={xCode} onChange={(e) => setChosen({ x: e.target.value, y: yCode })}>
            {offered.filter((v) => v.variable_code !== yCode).map((v) => <option key={v.variable_code} value={v.variable_code}>{v.label} ({v.unit})</option>)}
          </select>
        </div>
        <div className="control">
          <label htmlFor={`${id}-y`}>Y (response)</label>
          <select id={`${id}-y`} value={yCode} onChange={(e) => setChosen({ x: xCode, y: e.target.value })}>
            {offered.filter((v) => v.variable_code !== xCode).map((v) => <option key={v.variable_code} value={v.variable_code}>{v.label} ({v.unit})</option>)}
          </select>
        </div>
        <label className="check"><input type="checkbox" checked={showEquation} onChange={(e) => setShowEquation(e.target.checked)} /> Show equation</label>
        <label className="check"><input type="checkbox" checked={showResiduals} onChange={(e) => setShowResiduals(e.target.checked)} /> Show residual plot</label>
      </div>

      <QueryControls
        station={station}
        variables={variables}
        variable={xCode}
        showVariable={false}
        range={range}
        resolved={resolved}
        available={overlap ?? {}}
        onRangeChange={onRangeChange}
        note={overlap ? `Both recorded ${formatDate(overlap.first_date)} – ${formatDate(overlap.last_date)}` : "These two variables were never recorded over the same dates"}
      />

      {error && (
        <div className="chart-frame chart-message" role="alert">
          <p className="chart-message-title">Couldn't load the data</p>
          <p>{error.message}</p>
          <button type="button" onClick={() => { xr.retry(); yr.retry(); }}>Try again</button>
        </div>
      )}

      {!error && overlap && (
        <figure className={`chart-frame${ready ? "" : " is-refreshing"}`} aria-busy={!ready}>
          <figcaption className="chart-title">{yLabel} against {xLabel} · {station.name}</figcaption>
          {!ready && <p className="chart-message">Loading…</p>}
          {ready && model?.error && (
            <div className="chart-message" role="status">
              <p className="chart-message-title">No line can be fitted</p>
              <p>{model.error}</p>
            </div>
          )}
          {ready && !model?.error && (
            <ScatterChart
              paired={paired}
              model={model}
              xName={xName}
              xUnit={xUnit}
              yName={yName}
              yUnit={yUnit}
              showEquation={showEquation}
              colorA={colorA}
              colorB={colorB}
              colorGrid={colorGrid}
              colorAxis={colorAxis}
              colorFit={colorFit}
              ariaLabel={`Scatterplot of ${yLabel} against ${xLabel} with a fitted regression line, ${paired.pairs.length} days.`}
            />
          )}
        </figure>
      )}

      {fitOk && (
        <>
          <section className="quality-summary" aria-label="Regression results">
            <dl className="stat-row">
              <div className="stat"><dt>Slope</dt><dd>{num(model.slope)}</dd><p className="stat-note">{yVar.unit} per {xVar.unit}</p></div>
              <div className="stat"><dt>Intercept</dt><dd>{num(model.intercept)} {yVar.unit}</dd></div>
              <div className="stat"><dt>R²</dt><dd>{model.r2.toFixed(3)}</dd><p className="stat-note">share of the variation the line explains</p></div>
              <div className="stat"><dt>Days used</dt><dd>{model.n.toLocaleString()}</dd><p className="stat-note">{paired.dropped > 0 ? `${paired.dropped.toLocaleString()} left out (no reading or multi-day total)` : "every day had both readings"}</p></div>
            </dl>
          </section>

          {showResiduals && (
            <figure className="chart-frame">
              <figcaption className="chart-title">Residuals · what the line gets wrong, day by day</figcaption>
              <ResidualChart paired={paired} model={model} yName={yName} yUnit={yUnit} colorA={colorA} colorMuted={colorMuted} ariaLabel={`Residual plot for the regression of ${yLabel} on ${xLabel}.`} />
              <p className="control-note compare-note">A healthy fit scatters evenly around zero. A curve or a fan shape means a straight line is not describing this data well.</p>
            </figure>
          )}

          <section className="predict" aria-label="Estimate from the fitted line">
            <div className="control">
              <label htmlFor={`${id}-predict`}>Estimate {yVar.label.toLowerCase()} when {xVar.label.toLowerCase()} is</label>
              <input id={`${id}-predict`} type="number" step="any" value={predictAt} onChange={(e) => setPredictAt(e.target.value)} placeholder={xVar.unit} />
              {prediction !== null && <strong className="predict-out">≈ {num(prediction)} {yVar.unit}</strong>}
            </div>
            {outside && <p className="control-note compare-note">That is outside the {num(model.xMin)} to {num(model.xMax)} {xVar.unit} this fit was built on, so treat the estimate with extra caution.</p>}
          </section>
        </>
      )}

      <p className="caveat" role="note">
        Regression describes how these two variables moved together in past BOM data. It is not a weather forecast, and it does not show that one causes the other.
      </p>
    </div>
  );
}
