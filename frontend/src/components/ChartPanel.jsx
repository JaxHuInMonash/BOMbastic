/**
 * ChartPanel - the chart for the active query, with its loading, empty and
 * error states (report §5.2; NFR-02: empty, partial, invalid and failed
 * responses never crash the dashboard, and each says what happened).
 *
 * Step 1 of 4: the frame and every state are real; the plot itself arrives in
 * step 2 (temperature lines) and step 3 (rainfall bars).
 */

const ERROR_TITLE = {
  unreachable: "The API isn't responding",
  unavailable: "The database isn't available",
  invalid: "That request isn't valid",
  not_found: "Not found",
  server: "Something went wrong",
};

export default function ChartPanel({ result }) {
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
  return (
    <figure className={`chart-frame${loading ? " is-refreshing" : ""}`} aria-busy={loading}>
      <figcaption className="chart-title">
        {variable.label} ({variable.unit}) · {station.name}
      </figcaption>
      <div className="chart-placeholder">
        <p>
          {variable.default_chart === "bar" ? "Bar chart" : "Line chart"} of{" "}
          {data.records.length.toLocaleString()} daily values goes here in step{" "}
          {variable.default_chart === "bar" ? "3" : "2"}.
        </p>
        <p>The table below already shows exactly what it will plot.</p>
      </div>
    </figure>
  );
}
