/**
 * ChartPanel - the chart for the active query, with its loading, empty and
 * error states (report §5.2; NFR-02: empty, partial, invalid and failed
 * responses never crash the dashboard, and each says what happened).
 *
 * Temperature is a line chart (step 2, TemperatureChart). Rainfall bars arrive
 * in step 3; until then rainfall keeps the placeholder.
 *
 * The companion series (the other temperature) is extra context: it is drawn
 * only when its response is for the same station and the same dates as the
 * main one, so a late or stale answer can never be drawn under the wrong name,
 * and if it fails the main chart still shows.
 */

import TemperatureChart from "./TemperatureChart";

const ERROR_TITLE = {
  unreachable: "The API isn't responding",
  unavailable: "The database isn't available",
  invalid: "That request isn't valid",
  not_found: "Not found",
  server: "Something went wrong",
};

/** The companion's data, if it answers the same station and dates as `data`. */
function matchingCompanion(companion, data) {
  const c = companion?.data;
  if (!c || c.status !== "ok" || c.records.length === 0) return null;
  const same = c.query.station.station_id === data.query.station.station_id
    && c.query.start === data.query.start
    && c.query.end === data.query.end
    && c.query.variable.variable_code !== data.query.variable.variable_code;
  return same ? c : null;
}

export default function ChartPanel({ result, companion = null }) {
  const { data, error, loading, retry } = result;

  if (error) {
    return (
      <div className="chart-frame chart-message" role="alert">
        <p className="chart-message-title">{ERROR_TITLE[error.kind] ?? ERROR_TITLE.server}</p>
        <p>{error.message}</p>
        {(error.kind === "unreachable" || error.kind === "unavailable" || error.kind === "server") && (
          <button type="button" onClick={retry}>Try again</button>
        )}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="chart-frame chart-message" aria-busy={loading}>
        <p>{loading ? "Loading…" : ""}</p>
      </div>
    );
  }

  if (data.status === "no_data") {
    return (
      <div className={`chart-frame chart-message${loading ? " is-refreshing" : ""}`} aria-busy={loading}>
        <p className="chart-message-title">No values in this period</p>
        <p>{data.message}</p>
      </div>
    );
  }

  const { variable, station } = data.query;
  const busy = loading || Boolean(companion?.loading);

  if (variable.default_chart === "line") {
    const other = matchingCompanion(companion, data);
    return (
      <figure className={`chart-frame${loading ? " is-refreshing" : ""}`} aria-busy={busy}>
        <figcaption className="chart-title">
          {variable.label} ({variable.unit}) · {station.name}
        </figcaption>
        <TemperatureChart data={data} companion={other} />
        {companion?.error && !loading && (
          <p className="chart-note" role="status">
            Couldn&apos;t load the other temperature for comparison. The chart shows {variable.label.toLowerCase()} only.
          </p>
        )}
      </figure>
    );
  }

  return (
    <figure className={`chart-frame${loading ? " is-refreshing" : ""}`} aria-busy={loading}>
      <figcaption className="chart-title">
        {variable.label} ({variable.unit}) · {station.name}
      </figcaption>
      <div className="chart-placeholder">
        <p>
          Bar chart of {data.records.length.toLocaleString()} daily values goes here in step 3.
        </p>
        <p>The table below already shows exactly what it will plot.</p>
      </div>
    </figure>
  );
}
