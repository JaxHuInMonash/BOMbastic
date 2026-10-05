/**
 * CompareView - FR-04 (compare two locations).
 *
 * The same variable over the same dates for two stations, overlaid on one chart
 * with each station named in the legend and on hover. The dates are the period
 * both stations recorded, so the two series share one unit and one time scale.
 * Summary difference indicators use only days both stations measured: a missing
 * day or multi-day total on either side is left out, never counted as zero.
 */

import { useId, useMemo, useState } from "react";
import { useObservations } from "../api/hooks";
import { seriesColor } from "../utils/chartTheme";
import { compareStats, overlapOf } from "../utils/analysis";
import { formatDate } from "../utils/dates";
import { resolveRange } from "../utils/ranges";
import { stationTraces } from "../utils/series";
import { useColorScheme } from "../utils/useColorScheme";
import PlotlyChart from "./PlotlyChart";
import QueryControls from "./QueryControls";

/** The overlay plot. A child component so its traces are memoised on plain props. */
function CompareChart({ recordsA, recordsB, kind, unit, label, nameA, nameB, colorA, colorB, ariaLabel }) {
  const traces = useMemo(
    () => [
      ...stationTraces(recordsA, kind, { unit, name: nameA, color: colorA }),
      ...stationTraces(recordsB, kind, { unit, name: nameB, color: colorB }),
    ],
    [recordsA, recordsB, kind, unit, nameA, nameB, colorA, colorB],
  );
  const layout = useMemo(
    () => ({
      barmode: "overlay",
      yaxis: { title: { text: `${label} (${unit})` }, rangemode: kind === "bar" ? "tozero" : "normal" },
      yaxis2: { overlaying: "y", range: [0, 1], visible: false, fixedrange: true },
    }),
    [label, unit, kind],
  );
  return <PlotlyChart traces={traces} layout={layout} ariaLabel={ariaLabel} />;
}

const fmt = (v, unit) => `${Number(v.toFixed(2)).toLocaleString()} ${unit}`;
const signed = (v, unit) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Number(Math.abs(v).toFixed(2)).toLocaleString()} ${unit}`;

export default function CompareView({ station, stations, variables, variable, onVariableChange, range, onRangeChange }) {
  const id = useId();
  const scheme = useColorScheme();
  const colorA = seriesColor(scheme, "a");
  const colorB = seriesColor(scheme, "b");
  const [otherId, setOtherId] = useState("");

  const has = (s) => s.variables.some((v) => v.variable_code === variable);
  const candidates = stations.filter((s) => s.station_id !== station.station_id && has(s));
  const other = candidates.find((s) => s.station_id === otherId) ?? null;

  const availA = station.variables.find((v) => v.variable_code === variable);
  const availB = other?.variables.find((v) => v.variable_code === variable);
  const overlap = other ? overlapOf(availA, availB) : null;
  const resolved = overlap ? resolveRange(range, overlap) : {};

  const a = useObservations({ stationId: station.station_id, variable, start: resolved.start, end: resolved.end });
  const b = useObservations({ stationId: other?.station_id, variable: overlap ? variable : null, start: resolved.start, end: resolved.end });

  const meta = a.data?.query.variable ?? variables.find((v) => v.variable_code === variable);
  const unit = meta?.unit ?? "";
  const kind = meta?.default_chart === "bar" ? "bar" : "line";
  const ready = Boolean(a.data && b.data && a.data.query.start === b.data.query.start && a.data.query.end === b.data.query.end);

  const stats = ready ? compareStats(a.data.records, b.data.records) : null;

  const error = a.error ?? b.error;

  return (
    <div className="compare-view">
      <div className="control compare-picker">
        <label htmlFor={`${id}-other`}>Compare {station.name} with</label>
        <select id={`${id}-other`} value={otherId} onChange={(e) => setOtherId(e.target.value)}>
          <option value="">{candidates.length ? "Choose a second station…" : "No other station records this variable"}</option>
          {candidates.map((s) => (
            <option key={s.station_id} value={s.station_id}>{s.name} ({s.state}) · {s.station_id}</option>
          ))}
        </select>
      </div>

      <QueryControls
        station={station}
        variables={variables}
        variable={variable}
        onVariableChange={onVariableChange}
        range={range}
        resolved={resolved}
        available={overlap ?? availA ?? {}}
        onRangeChange={onRangeChange}
        note={overlap ? `Both recorded ${formatDate(overlap.first_date)} – ${formatDate(overlap.last_date)}` : null}
      />

      {!other && <p className="empty-hint">Pick a second station to overlay it on {station.name}. Both are drawn on the same axis, in the same unit.</p>}

      {other && !overlap && (
        <div className="chart-frame chart-message" role="alert">
          <p className="chart-message-title">No dates in common</p>
          <p>{station.name} and {other.name} never recorded this variable over the same period, so they can't be compared.</p>
        </div>
      )}

      {error && (
        <div className="chart-frame chart-message" role="alert">
          <p className="chart-message-title">Couldn't load the comparison</p>
          <p>{error.message}</p>
          <button type="button" onClick={() => { a.retry(); b.retry(); }}>Try again</button>
        </div>
      )}

      {other && overlap && !error && (
        <figure className={`chart-frame${ready ? "" : " is-refreshing"}`} aria-busy={!ready}>
          <figcaption className="chart-title">
            {meta?.label} ({unit}) · {station.name} vs {other.name}
          </figcaption>
          {ready ? (
            <CompareChart
              recordsA={a.data.records}
              recordsB={b.data.records}
              kind={kind}
              unit={unit}
              label={meta.label}
              nameA={station.name}
              nameB={other.name}
              colorA={colorA}
              colorB={colorB}
              ariaLabel={`Comparison chart of ${meta.label.toLowerCase()} in ${unit} for ${station.name} and ${other.name}, ${formatDate(a.data.query.start)} to ${formatDate(a.data.query.end)}.`}
            />
          ) : (
            <p className="chart-message">Loading…</p>
          )}
        </figure>
      )}

      {ready && (
        <section className="quality-summary" aria-label="Difference between the two stations">
          {stats ? (
            <>
              <dl className="stat-row">
                <div className="stat"><dt>{station.name}</dt><dd>{fmt(stats.meanA, unit)}</dd><p className="stat-note">mean on shared days</p></div>
                <div className="stat"><dt>{other.name}</dt><dd>{fmt(stats.meanB, unit)}</dd><p className="stat-note">mean on shared days</p></div>
                <div className="stat"><dt>Mean difference</dt><dd>{signed(stats.meanDifference, unit)}</dd><p className="stat-note">first minus second</p></div>
                <div className="stat">
                  <dt>Biggest gap</dt>
                  <dd>{signed(stats.largest.difference, unit)}</dd>
                  <p className="stat-note">{formatDate(stats.largest.date)}</p>
                </div>
              </dl>
              <p className="control-note compare-note">
                Based on the {stats.days.toLocaleString()} days both stations have a single-day reading. Days with no reading, or a multi-day total, on either side are left out.
              </p>
            </>
          ) : (
            <p className="empty-hint">The two stations have no single-day readings on the same dates in this period.</p>
          )}
        </section>
      )}
    </div>
  );
}
